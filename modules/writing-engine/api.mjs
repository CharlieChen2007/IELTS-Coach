import {readFile} from 'node:fs/promises';
import {participant} from '../campus-social/identity.mjs';
import {getDeepSeekConfig,callDeepSeekCompletion} from '../ai/deepseek.mjs';
import {analyzeTask1Question,createReferenceArtifact,buildEvaluationMessages,buildTask1Result,PROMPT_VERSION} from './task1/src/task1.mjs';
import {anchorSentences,sha256,countWords} from './task1/src/text.mjs';
import {requestJson} from './task1/src/deepseek.mjs';
import {AlgorithmError} from './task1/src/errors.mjs';
import {repairTask1Feedback} from './task1-repair.mjs';
import {analyzeTask2Question,evaluateTask2,TASK2_PROMPT_VERSION} from './task2/src/task2.mjs';
import {task2Fingerprint} from './task2/src/task2-bank.mjs';
import {scoreWritingSet,hashScoringReport} from './scoring/src/scoring.mjs';

const t1=JSON.parse(await readFile(new URL('./task1/resources/task1-catalog.json',import.meta.url),'utf8')).items;
const t2=JSON.parse(await readFile(new URL('./task2/resources/task2-catalog.json',import.meta.url),'utf8')).items;
const curated=JSON.parse(await readFile(new URL('./curated-task2.json',import.meta.url),'utf8')).map(q=>({...q,fingerprint:task2Fingerprint(q)}));
const pending=new WeakMap();
const json=(data,status=200,trace)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...(trace?{'X-Trace-Id':trace}:{})}});
function failure(code,message,status=400){throw Object.assign(new Error(message),{code,status});}
export async function ensureWritingEngine(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS writing_engine_attempts(owner TEXT NOT NULL,id TEXT NOT NULL,task TEXT NOT NULL,question TEXT NOT NULL,mode TEXT NOT NULL,text TEXT NOT NULL,text_hash TEXT NOT NULL,first_id TEXT NOT NULL,attempt_no INTEGER NOT NULL,origin TEXT NOT NULL,created INTEGER NOT NULL,report TEXT,locked_hash TEXT,stored INTEGER,PRIMARY KEY(owner,id))`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS writing_engine_question ON writing_engine_attempts(owner,question,created)').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS writing_engine_sources(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL)`).run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS writing_ai_usage(owner_id TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(owner_id,day))').run();
}
const limit=env=>Math.max(1,Math.min(500,Number(env.WRITING_AI_DAILY_LIMIT??process.env.WRITING_AI_DAILY_LIMIT)||40));
async function question(task,id){
  if(task==='task2'){const q=[...t2,...curated].find(q=>q.questionId===id);if(!q)failure('UNKNOWN_QUESTION','请选择题库中的写作题。');return structuredClone(q);}
  const row=t1.find(q=>q.questionId===id);if(!row)failure('UNKNOWN_QUESTION','请选择题库中的图表题。');
  const bytes=await readFile(new URL('../../public/writing/task1/'+id+'.png',import.meta.url)),hash=sha256(bytes);
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')failure('IMAGE_INVALID','题图暂不可用。',503);
  const image={imageId:'image-1',mimeType:'image/png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:hash,dataUrl:'data:image/png;base64,'+bytes.toString('base64')};
  return {...row,images:[image],fingerprint:sha256(JSON.stringify([id,row.prompt,hash]))};
}
function reanchor(report,id){
  if(report.submissionId===id)return structuredClone(report);
  // IDs carry UTF-16 offsets; use each original anchor's exact suffix, not new segmentation.
  const ids=new Map(report.feedback.sentences.map(s=>[s.id,id+s.id.slice(report.submissionId.length)]));
  const visit=value=>Array.isArray(value)?value.map(visit):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)])):ids.get(value)||value;
  const copy=visit(report);copy.submissionId=id;copy.scoreRecord.submissionId=id;
  copy.hostCache={canonicalSubmissionId:report.submissionId,reused:true};return copy;
}
async function evaluate(request,env,owner,input,trace){
  if(!input||!['task1','task2'].includes(input.task)||!new RegExp(input.task==='task1'?'^T1-\\d{3}$':'^T2-\\d{3}$').test(input.questionId)||
    typeof input.submissionId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/.test(input.submissionId)||typeof input.text!=='string'||!input.text.trim()||input.text.length>(input.task==='task1'?14000:20000)||!['essay','language'].includes(input.mode)||Object.keys(input).some(k=>!['task','questionId','submissionId','text','mode'].includes(k)))failure('INVALID_INPUT','写作请求无效，请从编辑器重新提交。');
  if(countWords(input.text)>(input.task==='task1'?1200:1500)||anchorSentences(input.text,input.submissionId).length>100)failure('INVALID_INPUT','正文超过本版本处理上限，请分段练习。');
  const q=await question(input.task,input.questionId),hash=sha256(input.text),db=env.DB;
  let row=await db.prepare('SELECT * FROM writing_engine_attempts WHERE owner=? AND id=?').bind(owner,input.submissionId).first();
  if(row&&(row.text_hash!==hash||row.question!==q.questionId||row.mode!==input.mode))failure('DRAFT_CONFLICT','这个提交编号已经保存了另一份原稿，请新建一稿。',409);
  if(!row)row=await db.prepare('SELECT * FROM writing_engine_attempts WHERE owner=? AND question=? AND text_hash=? AND mode=? ORDER BY created LIMIT 1').bind(owner,q.questionId,hash,input.mode).first();
  if(row?.report)return {report:reanchor(JSON.parse(row.report),input.submissionId),cached:true};
  const config=getDeepSeekConfig(env);if(!config)failure('AI_NOT_CONFIGURED','AI 批改暂未配置，原稿已保留。',503);
  if(!row){
    const prev=await db.prepare('SELECT * FROM writing_engine_attempts WHERE owner=? AND question=? ORDER BY created,id LIMIT 1').bind(owner,q.questionId).first();
    const origin=request.headers.get('X-Speaking-Scope')?.startsWith('showcase_')?'sample':'learner';
    await db.prepare(`INSERT OR IGNORE INTO writing_engine_attempts(owner,id,task,question,mode,text,text_hash,first_id,attempt_no,origin,created)
      SELECT ?1,?2,?3,?4,?5,?6,?7,COALESCE((SELECT first_id FROM writing_engine_attempts WHERE owner=?1 AND question=?4 ORDER BY created,id LIMIT 1),?2),
        CASE WHEN EXISTS(SELECT 1 FROM writing_engine_attempts WHERE owner=?1 AND question=?4) THEN 2 ELSE 1 END,?8,?9`)
      .bind(owner,input.submissionId,input.task,q.questionId,input.mode,input.text,hash,origin,Date.now()).run();
    row=await db.prepare('SELECT * FROM writing_engine_attempts WHERE owner=? AND id=?').bind(owner,input.submissionId).first();
  }
  const native={questionId:q.questionId,submissionId:row.id,text:row.text,mode:row.mode};
  if(row.attempt_no>1){
    const first=await db.prepare('SELECT text FROM writing_engine_attempts WHERE owner=? AND id=?').bind(owner,row.first_id).first();
    const previous=await db.prepare('SELECT text,report FROM writing_engine_attempts WHERE owner=? AND question=? AND id<>? AND created<=? ORDER BY created DESC,id DESC LIMIT 1').bind(owner,q.questionId,row.id,row.created).first();
    native.revisionContext={initialText:first.text,previousText:previous?.text||first.text,previousFocus:[],round:2};
  }
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),reserved=await db.prepare('INSERT INTO writing_ai_usage(owner_id,day,count) VALUES(?,?,1) ON CONFLICT(owner_id,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(owner,day,limit(env)).first();
  if(!reserved)failure('AI_QUOTA_EXCEEDED','今日批改次数已用完，原稿和已完成报告仍可查看。',429);
  try{
    const bound={DEEPSEEK_API_KEY:config.key,DEEPSEEK_BASE_URL:'https://api.deepseek.com',DEEPSEEK_MODEL:config.model};
    const fetcher=async(_url,options)=>{
      const payload=JSON.parse(options.body);
      /* 保留 JSON 模式，但把解析交给 writing-engine 自身：它会解析并按契约重试，
         这一层提前 parse 会让格式问题直接变成不可重试的失败，白丢一次机会。 */
      try{const c=await callDeepSeekCompletion(env,payload.messages,{maxTokens:payload.max_tokens,jsonObject:true,raw:true,signal:options.signal});return Response.json({model:c.model,choices:[{finish_reason:'stop',message:{content:c.content}}],usage:c.usage});}
      catch(error){throw new AlgorithmError(error.code||'AI_UNAVAILABLE',error.message,{retryable:true});}
    };
    const sourceKey=[input.task,q.fingerprint,config.model,input.task==='task1'?PROMPT_VERSION:TASK2_PROMPT_VERSION].join(':'),prior=await db.prepare('SELECT payload FROM writing_engine_sources WHERE cache_key=?').bind(sourceKey).first();
    let artifact=prior?JSON.parse(prior.payload):null;
    if(!artifact){
      if(input.task==='task1'){
        let reference;try{reference=JSON.parse(await readFile(new URL('./task1/resources/references/'+q.questionId+'.json',import.meta.url),'utf8'));}catch{}
        artifact=reference?createReferenceArtifact(q,reference):await analyzeTask1Question(q,{env:bound,fetcher,signal:request.signal});
      }else artifact=await analyzeTask2Question(q,{env:bound,fetcher,signal:request.signal});
      await db.prepare('INSERT OR IGNORE INTO writing_engine_sources VALUES(?,?)').bind(sourceKey,JSON.stringify(artifact)).run();
    }
    const trustedAttempt={role:row.attempt_no===1?'first':'revision',recordId:row.id};let report;
    if(input.task==='task1'){
      const anchors=anchorSentences(native.text,native.submissionId);let policy;
      const response=await requestJson({config:{apiKey:config.key,endpoint:config.endpoint,model:config.model,timeoutMs:180000},messages:buildEvaluationMessages(native,q,artifact),maxTokens:16000,fetcher,signal:request.signal,
        validate:data=>{const repaired=repairTask1Feedback(data,{input:native,source:artifact.analysis,anchors});policy=repaired.policy;return repaired.feedback;}});
      report={...buildTask1Result(native,q,artifact,response.data,response.generation,trustedAttempt),deliveryPolicy:policy};
    }else report=await evaluateTask2(native,q,artifact,{env:bound,fetcher,signal:request.signal,trustedAttempt});
    const stored=Date.now(),locked=hashScoringReport(report);
    await db.prepare('UPDATE writing_engine_attempts SET report=?,locked_hash=?,stored=? WHERE owner=? AND id=? AND report IS NULL').bind(JSON.stringify(report),locked,stored,owner,row.id).run();
    const canonical=await db.prepare('SELECT report FROM writing_engine_attempts WHERE owner=? AND id=?').bind(owner,row.id).first();
    return {report:reanchor(JSON.parse(canonical.report),input.submissionId),cached:false};
  }catch(error){await db.prepare('UPDATE writing_ai_usage SET count=MAX(0,count-1) WHERE owner_id=? AND day=?').bind(owner,day).run();throw error;}
}
export async function readWritingProfile(env,owner){
  await ensureWritingEngine(env);const asOf=new Date().toISOString();
  const rows=(await env.DB.prepare('SELECT * FROM writing_engine_attempts WHERE owner=? AND report IS NOT NULL ORDER BY created,id').bind(owner).all()).results;
  const records=rows.map(row=>{const report=JSON.parse(row.report);return {submission:{recordId:row.id,userId:owner,assessmentSetId:'history',practiceId:'practice:'+row.question,task:row.task,questionId:row.question,submissionId:row.id,firstSubmissionId:row.first_id,attemptNumber:row.attempt_no,mode:row.mode,text:row.text,sourceFingerprint:report.scoreRecord.sourceFingerprint,submittedAt:new Date(row.created).toISOString(),reportStoredAt:new Date(Math.max(row.stored,Date.parse(report.generation.generatedAt))).toISOString(),lockedReportHash:row.locked_hash,origin:row.origin,assistance:'unassisted'},report};});
  const eligible={task1:[],task2:[]},excluded=[];
  for(const record of records){
    try{const evaluated=scoreWritingSet({userId:owner,assessmentSetId:'history',asOf,records:[record]});const task=evaluated.tasks[record.submission.task];if(task)eligible[record.submission.task].push({record,task});else excluded.push(...evaluated.excluded);}
    catch(error){excluded.push({recordId:record.submission.recordId,code:error.code||'INVALID_REPORT'});}
  }
  const means=Object.fromEntries(['task1','task2'].map(task=>{const list=eligible[task],criteria=list.length?Object.fromEntries(Object.keys(list[0].task.criteria).map(key=>[key,list.reduce((n,x)=>n+x.task.criteria[key],0)/list.length])):null;return [task,list.length?{sampleCount:list.length,recordIds:list.map(x=>x.record.submission.recordId),criteria,unroundedMean:list.reduce((n,x)=>n+x.task.unroundedMean,0)/list.length}:null];}));
  const raw=means.task1&&means.task2?(means.task1.unroundedMean+2*means.task2.unroundedMean)/3:null;
  const hostAggregate={algorithmVersion:'all-first-drafts-v1',status:raw!==null?'complete':means.task1||means.task2?'partial':'unavailable',writingRaw:raw,writingBand:raw===null?null:Math.round(raw*2)/2,
    tasks:means,sampleCounts:{task1:eligible.task1.length,task2:eligible.task2.length},excluded,asOf,officialResult:false,calibrationStatus:'not_calibrated_against_examiner_scores',note:'汇总全部合格首稿；同题复批、二稿、示例不参与。每类先求均值，再按 Task 1:Task 2=1:2 加权，尚未经考官校准。'};
  const latest=Object.values(eligible).map(list=>list.at(-1)?.record).filter(Boolean);
  const result=scoreWritingSet({userId:owner,assessmentSetId:'history',asOf,records:latest});
  return {hostAggregate,result,matchingSource:result.matchingSource};
}
export async function handleWritingEngine(request,env){
  const trace=crypto.randomUUID().slice(0,12);
  try{
    const url=new URL(request.url);const owner=await participant(request,env);await ensureWritingEngine(env);
    if(url.pathname==='/api/writing/profile')return request.method==='GET'?json(await readWritingProfile(env,owner)):json({error:'请使用 GET。'},405);
    if(request.method!=='POST')failure('INVALID_METHOD','请从编辑器提交。',405);
    if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')failure('FORBIDDEN','请从本站提交。',403);
    const body=await request.text();if(body.length>25000)failure('INPUT_TOO_LARGE','正文过长。',413);
    let input;try{input=JSON.parse(body);}catch{failure('INVALID_INPUT','请求格式无效。');}
    let jobs=pending.get(env.DB);if(!jobs){jobs=new Map();pending.set(env.DB,jobs);}
    const key=owner+':'+input?.task+':'+input?.questionId+':'+sha256(String(input?.text))+':'+input?.mode;
    if(!jobs.has(key))jobs.set(key,evaluate(request,env,owner,input,trace).finally(()=>jobs.delete(key)));
    const result=await jobs.get(key);return json({...result,report:reanchor(result.report,input.submissionId),traceId:trace},200,trace);
  }catch(error){const code=error.code||'WRITING_FAILED',status=error.status||(/NOT_CONFIGURED/.test(code)?503:/AI_|INVALID_OUTPUT/.test(code)?502:400);
    return json({error:{code,message:code==='INVALID_OUTPUT'?'本次反馈未通过证据核对，未扣批改次数。原稿已保留，请重试。':error.status?error.message:/AI_/.test(code)?'AI 暂未完成批改，原稿已保留，请稍后重试。':'写作材料暂时无法处理，请检查题目与原稿。',traceId:trace,...(code==='AI_NETWORK_ERROR'&&error.details?.[0]?.code?{networkCode:error.details[0].code}:{}),
      /* 只回传字段名/规则名这类结构信息，便于用户与我们定位失败点，不含正文内容。 */
      ...(code==='INVALID_OUTPUT'&&Array.isArray(error.details)&&error.details.length?{reason:error.details.slice(0,3).map(d=>typeof d==='string'?d:[String(d?.path||'')+':'+String(d?.rule||''),String(d?.instruction||'')].filter(Boolean).join(' ')).filter(Boolean).join(' / ').slice(0,300)}:{})}},status,trace);}
}
