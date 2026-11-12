import catalog from './data/catalog.json' with {type:'json'};
import practices from './data/practices.json' with {type:'json'};
import {toPublicCatalog,toPublicPractice,assertNoAnswers} from './api/contract.js';
import {runAttempt,prepareReview,runReview,runSetTag} from './api/gradeService.js';
import {TAGS} from './core/text.js';
import {participant,fail} from '../campus-social/identity.mjs';
import {typeDrill} from './drills.mjs';

const directory=toPublicCatalog(catalog);
function getPractice(id) {
  if (!Object.hasOwn(practices,id)) fail('找不到这段听力练习。',404);
  return practices[id];
}
function json(value,status=200) {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}
async function readBody(request) {
  const text=await request.text();
  if(text.length>32768) fail('提交内容过长。',413);
  let value;
  try {value=JSON.parse(text||'{}');} catch {fail('请提交有效的作答。');}
  if(!value||typeof value!=='object'||Array.isArray(value)) fail('作答格式有误。');
  return value;
}
async function prepareShowcase(db, owner) {
  const sections = [
    {id:'prac_lsn_s1',daysAgo:8,answers:['round','10','4','green','reasonable','75 cm','lock']},
    {id:'prac_lsn_s2',daysAgo:2,answers:['F','B','G','G','D']},
  ];
  for (const {id,daysAgo,answers} of sections) {
    await db.prepare('INSERT OR IGNORE INTO listening_sections(owner,practice) VALUES(?,?)').bind(owner,id).run();
    const practice = getPractice(id);
    const now = new Date(Date.now()-daysAgo*86400000);
    const result = runAttempt({practice, transcripts:practice.transcripts, userId:owner, durationSec:225, now,
      answers:Object.fromEntries(practice.items.map((item,i)=>[item.id,answers[i]]))});
    result.report.previous_attempt_id = null;
    result.report.first_try_correct = result.attempt.correct;
    result.response.practice = toPublicPractice(practice);
    result.wrongbook.forEach(item=>{item.created_at=now.toISOString();item.updated_at=item.created_at;});
    // Revision zero is consumed exactly once, even with concurrent tabs or subsequent resets.
    await db.prepare('UPDATE listening_sections SET version=1,wrongbook=?,latest=?,receipt=? WHERE owner=? AND practice=? AND version=0')
      .bind(JSON.stringify(result.wrongbook),result.attempt.attempt_id,JSON.stringify({response:result.response,attempt:result.attempt}),owner,id).run();
  }
  return {ok:true};
}
async function dispatch(request,env) {
  const db=env.DB, owner=await participant(request,env);
  const url=new URL(request.url), [resource,id,operation,...rest]=url.pathname.slice('/api/listening/'.length).split('/').map(decodeURIComponent);
  if(rest.length) fail('接口不存在。',404);
  const method=request.method;
  if (resource === 'showcase' && !id && method === 'POST') {
    if (!request.headers.get('X-Speaking-Scope')?.startsWith('showcase_')) fail('此操作仅在演示空间可用。',403);
    return prepareShowcase(db,owner);
  }
  if (resource === 'drills' && !operation) {
    return typeDrill(db, owner, id, method, method === 'POST' ? await readBody(request) : null);
  }
  const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
  const rows=async(sql,...args)=>(await stmt(sql,...args).all()).results;
  const getSection=pid=>stmt('SELECT version,latest,wrongbook FROM listening_sections WHERE owner=? AND practice=?',owner,pid).first();
  const readSnapshot=async(attemptId)=>{
    const row=await stmt('SELECT snapshot FROM listening_attempts WHERE owner=? AND id=?',owner,attemptId).first();
    if(!row) fail('找不到这次作答。',404);
    return JSON.parse(row.snapshot);
  };
  if(method==='GET') {
    if(resource==='config'&&!id) return {mode:'http',skill:'listening',answer_policy:'server_graded',default_practice_id:directory[0].practice_id,practices:directory};
    if(resource==='practices'){
      if(!id) return {items:directory,default_practice_id:directory[0].practice_id};
      const practice=getPractice(id);
      if(!operation){const pub=toPublicPractice(practice);assertNoAnswers(pub);return pub;}
      const section=await getSection(id);
      if(operation==='result') return section?.latest ? readSnapshot(section.latest) : {submitted:false};
      if(operation==='transcript'){
        if(!section?.latest) fail('本段交卷后可查看原文。',403);
        return {practice_id:id,transcripts:practice.transcripts};
      }
    }
    if(resource==='attempts'&&!operation){
      if(id) return readSnapshot(id);
      const pid=url.searchParams.get('practice_id');
      const items=pid ? await rows('SELECT summary FROM listening_attempts WHERE owner=? AND practice=? ORDER BY rowid',owner,pid)
        : await rows('SELECT summary FROM listening_attempts WHERE owner=? ORDER BY rowid',owner);
      return {items:items.map(x=>JSON.parse(x.summary))};
    }
    if(resource==='progress'&&!id){
      const counts=await rows("SELECT practice,COUNT(*) attempts,MAX(json_extract(summary,'$.correct')) best FROM listening_attempts WHERE owner=? GROUP BY practice",owner);
      const states=await rows('SELECT s.practice,s.latest,s.wrongbook,a.summary FROM listening_sections s LEFT JOIN listening_attempts a ON a.owner=s.owner AND a.id=s.latest WHERE s.owner=?',owner);
      return {items:directory.map(({practice_id})=>{
        const state=states.find(s=>s.practice===practice_id), count=counts.find(s=>s.practice===practice_id);
        const last=state?.summary && JSON.parse(state.summary);
        return {practice_id,submitted:Boolean(state?.latest),attempts:count?.attempts||0,best_correct:count?.best||0,
          latest_correct:last?.correct??null,latest_total:last?.total??null,wrong_count:JSON.parse(state?.wrongbook||'[]').filter(e=>e.status!=='mastered').length};
      })};
    }
  }
  if(!['POST','GET'].includes(method)) fail('不支持该操作。',405);
  const body=method==='POST'?await readBody(request):{};
  const pid=body.practice_id || url.searchParams.get('practice_id') || (resource==='sections'?id:null);
  if(method==='GET'&&resource==='wrongbook'&&!id&&!pid){
    return {items:(await rows('SELECT wrongbook FROM listening_sections WHERE owner=?',owner)).flatMap(r=>JSON.parse(r.wrongbook))};
  }
  const practice=getPractice(pid);
  if(method==='POST'){
    await stmt('INSERT OR IGNORE INTO listening_sections(owner,practice) VALUES(?,?)',owner,pid).run();
  }
  for(let tries=0;tries<6;tries++){
    const state=await getSection(pid);
    const wrongbook=JSON.parse(state?.wrongbook||'[]');
    let nextBook=wrongbook, latest=state?.latest, receipt=null, result;
    if(resource==='attempts'&&!id&&method==='POST'){
      if(latest) return readSnapshot(latest);
      if(!Array.isArray(body.answers)||body.answers.length>practice.items.length) fail('请提交本段的作答。');
      const answers=Object.create(null);
      for(const entry of body.answers){
        if(!entry||!practice.items.some(i=>i.id===entry.item_id)||typeof entry.answer!=='string'||entry.answer.length>512) fail('答案格式有误或过长。');
        answers[entry.item_id]=entry.answer;
      }
      const output=runAttempt({practice,transcripts:practice.transcripts,answers,userId:owner,wrongbook,
        durationSec:Math.max(0,Math.min(86400,Number(body.duration_sec)||0)),replayBySegment:body.replay_by_segment||{}});
      const history=await stmt(`SELECT
        (SELECT id FROM listening_attempts WHERE owner=?1 AND practice=?2 ORDER BY rowid DESC LIMIT 1) AS previous,
        (SELECT json_extract(summary,'$.correct') FROM listening_attempts WHERE owner=?1 AND practice=?2 ORDER BY rowid LIMIT 1) AS first_score`,owner,pid).first();
      output.report.previous_attempt_id=history.previous;
      output.report.first_try_correct=history.first_score??output.attempt.correct;
      output.response.practice=toPublicPractice(practice);
      latest=output.attempt.attempt_id;nextBook=output.wrongbook;result=output.response;
      receipt=JSON.stringify({attempt:output.attempt,response:result});
    }else if(resource==='sections'&&id===pid&&operation==='reset'&&method==='POST'){
      latest=null;nextBook=[];result={practice_id:pid,submitted:false,wrong_count:0};
    }else if(resource==='wrongbook'){
      if(!id&&method==='GET') return {practice_id:pid,items:wrongbook};
      const entry=wrongbook.find(e=>e.id===id);
      if(!entry) fail('本段错题不存在。',404);
      if(operation==='review-item'&&method==='GET'){
        return prepareReview({practice,wrongbook,entryId:id,mode:url.searchParams.get('mode')}) || fail('没有可用的同类题。',404);
      }
      if(operation==='tag'&&method==='POST'){
        if(!Object.hasOwn(TAGS,body.error_tag)) fail('请选择有效的错因。');
        nextBook=runSetTag({wrongbook,entryId:id,tag:body.error_tag});result={practice_id:pid,items:nextBook};
      }else if(operation==='review'&&method==='POST'){
        const item=practice.items.find(i=>i.id===body.item_id);
        if(!['redo','new'].includes(body.mode)||!item||item.type!==entry.question_type||
          (item.id===entry.item_id)!==(body.mode==='redo')||typeof body.answer!=='string'||!body.answer.trim()||body.answer.length>512) fail('复练题目或答案有误。');
        const requestId=body.request_id;
        if(requestId && entry.lastReviewId===requestId) return {...entry.lastReview,entry,wrongbook};
        result=runReview({practice,wrongbook,entryId:id,itemId:item.id,mode:body.mode,answer:body.answer});
        nextBook=result.wrongbook;
        if(typeof requestId==='string'&&requestId.length<=80){
          const {wrongbook:ignore,entry:updated,...response}=result;
          updated.lastReviewId=requestId;updated.lastReview=response;
        }
      }else fail('接口不存在。',404);
    }else fail('接口不存在。',404);
    const commit=await stmt('UPDATE listening_sections SET wrongbook=?,latest=?,receipt=?,version=version+1 WHERE owner=? AND practice=? AND version=?',
      JSON.stringify(nextBook),latest,receipt,owner,pid,state.version).run();
    if(commit.meta.changes) return result;
  }
  fail('这一段刚在另一页面更新，请刷新后再试。',409);
}
export async function handleListening(request,env){
  try{return json(await dispatch(request,env));}
  catch(err){return json({error:err.status?err.message:'听力服务暂时不可用，请重试。'},err.status||500);}
}
