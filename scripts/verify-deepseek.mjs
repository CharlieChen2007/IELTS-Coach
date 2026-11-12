/** Mock the provider only; use real SQLite/auth/quota and never spend API credits. */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {getDeepSeekConfig,callDeepSeekJson,callDeepSeekCompletion,DeepSeekError} from '../modules/ai/deepseek.mjs';
import {aiConfig} from './writing-api.mjs';
import {speakingApi} from './speaking-api.mjs';
import {openLocalBindings} from '../modules/speaking/scripts/local-bindings.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=mkdtempSync(path.join(process.env.QA_OUTPUT_DIR || tmpdir(),'ielts-deepseek-test-'));
const savedFetch=globalThis.fetch;
const names=['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','AI_API_KEY','AI_BASE_URL','AI_MODEL','WRITING_AI_DAILY_LIMIT'];
const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
for(const name of names)delete process.env[name];
const db=openLocalBindings(path.join(out,'database'),{campus:true});
const bound={...db,DEEPSEEK_API_KEY:'test-only-bound-placeholder',DEEPSEEK_BASE_URL:'https://mock-deepseek.test/v1',DEEPSEEK_MODEL:'bound-vision-model',WRITING_AI_DAILY_LIMIT:'2'};
const result={checks:[],network:'provider fetch mocked; no paid calls',errors:[]};
const calls=[];
let mode='ok';
let bodyCancelled=false;
let content='{"task":"task2","sentences":[{"original":"Students learns quickly.","rewrite":"Students learn quickly."}],"modelAnswer":"A complete improved essay."}';
function completion(value=content,finish_reason='stop'){return Response.json({model:'upstream-private-alias',choices:[{message:{content:value},finish_reason}],usage:{prompt_tokens:120,completion_tokens:80,total_tokens:200}});}
globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),headers:new Headers(options.headers),body:JSON.parse(options.body),redirect:options.redirect});
  if(mode==='network')throw Error('upstream debug test-only-bound-placeholder');
  if(mode==='pending')return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('test-only-bound-placeholder','AbortError')),{once:true});});
  if(mode==='pending-body')return new Response(new ReadableStream({cancel(){bodyCancelled=true;}}));
  if(mode==='oversized')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4*1024*1024+1).fill(32));},cancel(){bodyCancelled=true;}}));
  if(mode==='outer-json')return new Response('<html>test-only-bound-placeholder</html>',{status:200});
  if(mode==='http401'||mode==='http429'||mode==='http500')return Response.json({error:{message:'test-only-bound-placeholder'}},{status:Number(mode.slice(4))});
  if(mode==='blank')return completion('   ');
  if(mode==='non-json')return completion('not JSON; test-only-bound-placeholder');
  if(mode==='array')return completion('[]');
  if(mode==='truncated')return completion(content,'length');
  if(mode==='incomplete')return completion(content,'insufficient_system_resource');
  if(mode==='missing')return Response.json({choices:[]});
  return completion();
};
function check(ok,label){assert(ok,label);result.checks.push(label);console.log('PASS '+label);}
async function rejects(action,code,label){let error;try{await action();}catch(cause){error=cause;}check(error instanceof DeepSeekError&&error.code===code,label);check(!String(error?.message).includes('test-only-'),label+' errors are secret-free');}
const origin='https://deepseek-writing.test',scope='usr_deepseek_test';
let cookie='';
async function api(route,body,env=bound,signal){
  const response=await speakingApi(new Request(origin+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'X-Speaking-Scope':scope,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal}),env);
  const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];
  return {status:response.status,body:await response.json()};
}
const textMessages=[{role:'system',content:'Return an IELTS writing feedback JSON object with sentence rewrites.'},{role:'user',content:'Students learns quickly.'}];
const chat={messages:textMessages,maxTokens:8192,temperature:0.2,jsonObject:true,model:'browser-cannot-select-provider'};
const used=async(env=bound)=>(await api('/api/writing/ai/status',undefined,env)).body.quota.used;
try{
  process.env.OPENAI_API_KEY='test-only-ignored-placeholder';process.env.AI_API_KEY='test-only-ignored-placeholder';
  check(getDeepSeekConfig({})===null,'OpenAI/AI aliases cannot enable DeepSeek');
  process.env.DEEPSEEK_API_KEY='test-only-node-placeholder';
  const defaults=getDeepSeekConfig({});
  check(defaults.model==='deepseek-flash'&&defaults.endpoint==='https://api.deepseek.com/chat/completions','Node defaults use official DeepSeek and deepseek-flash');
  process.env.DEEPSEEK_BASE_URL='https://node-fallback.test/v1';process.env.DEEPSEEK_MODEL='node-fallback-model';
  const config=getDeepSeekConfig(bound);
  check(config.model==='bound-vision-model'&&config.endpoint==='https://mock-deepseek.test/v1/chat/completions'&&config.key===bound.DEEPSEEK_API_KEY,'Worker bindings override all Node DeepSeek settings');
  check(getDeepSeekConfig({...bound,DEEPSEEK_API_KEY:''})===null,'Explicit empty Worker key disables Node key fallback');
  const reset=getDeepSeekConfig({...bound,DEEPSEEK_BASE_URL:'',DEEPSEEK_MODEL:''});
  check(reset.endpoint==='https://api.deepseek.com/chat/completions'&&reset.model==='deepseek-flash','Explicit empty Worker base/model reset to product defaults instead of Node settings');
  check(aiConfig(bound).limit===2,'Writing quota honors Worker binding');
  for(const url of ['http://unsafe.test','https://user:password@unsafe.test','https://unsafe.test/?key=bad'])check(getDeepSeekConfig({...bound,DEEPSEEK_BASE_URL:url})===null,'Reject unsafe provider base '+new URL(url).protocol);
  const data=await callDeepSeekJson(bound,textMessages,{maxTokens:2400});
  check(data.task==='task2'&&data.sentences[0].rewrite==='Students learn quickly.','JSON helper returns parsed Task 2 response');
  const sent=calls.at(-1);
  check(sent.body.model===config.model&&sent.body.max_tokens===2400&&sent.body.thinking.type==='disabled'&&sent.body.response_format.type==='json_object','Configured model, token budget and explicit JSON/non-thinking mode reach upstream');
  check(sent.headers.get('Authorization')==='Bearer '+bound.DEEPSEEK_API_KEY&&!JSON.stringify(sent.body).includes(bound.DEEPSEEK_API_KEY)&&sent.redirect==='error','Secret stays only in server Authorization header and redirects are refused');
  const image='data:image/png;base64,'+readFileSync(path.join(root,'public/writing/task1/T1-001.png')).toString('base64');
  const imageMessages=[{role:'system',content:'Return Task 1 JSON; use only visible chart facts, do not invent unreadable values.'},{role:'user',content:[{type:'text',text:'Review this Task 1 chart and essay.'},{type:'image_url',image_url:{url:image,detail:'high'}}]}];
  await callDeepSeekJson(bound,imageMessages,{thinking:true});
  check(calls.at(-1).body.messages[1].content[1].image_url.url===image&&calls.at(-1).body.messages[1].content[1].image_url.detail==='high','Full real Task 1 PNG and image detail survive proxy normalization');
  check(calls.at(-1).body.thinking.type==='enabled','Thinking option is explicit when requested');
  const workerSource=readFileSync(path.join(root,'modules/ai/deepseek.mjs'),'utf8').replace(/^export (?=(?:async )?function |class )/gm,'')+'\n;globalThis.workerAI={getDeepSeekConfig,callDeepSeekJson};';
  const sandbox={URL,Headers,Response,TextDecoder,TextEncoder,AbortController,DOMException,setTimeout,clearTimeout,fetch:globalThis.fetch};
  runInNewContext(workerSource,sandbox,{timeout:1000});
  const workerEnv={DEEPSEEK_API_KEY:'test-only-worker-placeholder'};
  check(!Object.hasOwn(sandbox,'process')&&sandbox.workerAI.getDeepSeekConfig(workerEnv).model==='deepseek-flash','Worker context config works without any process global');
  const workerResult=await sandbox.workerAI.callDeepSeekJson(workerEnv,textMessages,{maxTokens:2400});
  check(workerResult.task==='task2'&&calls.at(-1).headers.get('Authorization')==='Bearer '+workerEnv.DEEPSEEK_API_KEY,'Worker context executes a real mock completion using binding-only credentials');
  const beforeAudio=calls.length;
  await rejects(()=>callDeepSeekJson(bound,[{role:'user',content:[{type:'input_audio',input_audio:{data:'test-audio',format:'wav'}}]}]),'AI_INVALID_REQUEST','DeepSeek adapter rejects raw audio input');
  check(calls.length===beforeAudio,'Raw audio never reaches the text/image provider');
  await callDeepSeekCompletion(bound,[{role:'user',content:'Give feedback.'}],{jsonObject:true});
  check(calls.at(-1).body.messages[0].role==='system'&&/JSON/.test(calls.at(-1).body.messages[0].content),'JSON instruction is supplied when absent without replacing task messages');
  for(const [failure,code] of [['blank','AI_EMPTY_RESPONSE'],['non-json','AI_INVALID_JSON'],['array','AI_INVALID_JSON'],['truncated','AI_RESPONSE_TRUNCATED'],['incomplete','AI_RESPONSE_INCOMPLETE'],['missing','AI_RESPONSE_INCOMPLETE'],['outer-json','AI_UPSTREAM_INVALID_RESPONSE'],['http401','AI_UPSTREAM_AUTH_ERROR'],['http429','AI_UPSTREAM_RATE_LIMIT'],['http500','AI_UPSTREAM_ERROR'],['network','AI_UPSTREAM_UNAVAILABLE']]){mode=failure;await rejects(()=>callDeepSeekJson(bound,textMessages),code,failure+' response is rejected');}
  mode='oversized';bodyCancelled=false;
  await rejects(()=>callDeepSeekJson(bound,textMessages),'AI_UPSTREAM_INVALID_RESPONSE','Response stream is stopped at 4 MiB byte limit');
  check(bodyCancelled,'Oversized upstream stream is actively cancelled');
  mode='pending';
  await rejects(()=>callDeepSeekJson(bound,textMessages,{timeoutMs:5}),'AI_UPSTREAM_TIMEOUT','Provider timeout is bounded');
  mode='pending-body';bodyCancelled=false;
  await rejects(()=>callDeepSeekJson(bound,textMessages,{timeoutMs:5}),'AI_UPSTREAM_TIMEOUT','Timeout covers stalled response-body stream');
  check(bodyCancelled,'Timed-out response-body stream is actively cancelled');
  const abort=new AbortController();abort.abort();const beforeAbort=calls.length;
  await rejects(()=>callDeepSeekJson(bound,textMessages,{signal:abort.signal}),'AI_REQUEST_ABORTED','Cancelled caller request stops provider work');
  check(calls.length===beforeAbort,'Already-aborted call never reaches upstream');
  mode='ok';
  check((await api('/api/campus/session',{nickname:'DeepSeek测试'})).status===200,'Real database account identity established');
  const beforeDisabled=calls.length,disabled=await api('/api/ai/chat',chat,{...bound,DEEPSEEK_API_KEY:''});
  check(disabled.status===503&&disabled.body.error.code==='AI_NOT_CONFIGURED'&&calls.length===beforeDisabled,'Explicit empty Worker key disables writing even when Node key exists');
  const initial=await api('/api/writing/ai/status');
  check(initial.body.configured&&initial.body.model==='bound-vision-model'&&initial.body.provider==='mock-deepseek.test'&&initial.body.quota.used===0,'Writing status reports actual configured model and zero initial usage');
  const textReply=await api('/api/ai/chat',chat);
  check(textReply.status===200&&textReply.body.content===content&&textReply.body.model==='bound-vision-model'&&textReply.body.usage.total_tokens===200,'Writing response preserves native JSON text, configured model and usage fields');
  check(calls.at(-1).url===config.endpoint&&calls.at(-1).body.model===config.model&&calls.at(-1).body.max_tokens===8192,'Browser model hint cannot replace server provider/model/token policy');
  content='{"schemaVersion":"task1-ai-v1","questionId":"T1-001","sourceAnalysis":{"readability":"unreadable","facts":[],"uncertainties":["Cannot confirm chart values."]},"assessment":{"assessmentMode":"insufficient_source"},"sentences":[]}';
  const imageReply=await api('/api/ai/chat',{...chat,messages:imageMessages});
  check(imageReply.status===200&&imageReply.body.content===content&&calls.at(-1).body.messages[1].content[1].image_url.url===image,'Writing Task 1 image and insufficient-source JSON remain unchanged');
  check(await used()===2,'Exactly two successful writing calls consume two credits');
  const beforeQuota=calls.length,blocked=await api('/api/ai/chat',chat);
  check(blocked.status===429&&blocked.body.error.code==='AI_QUOTA_EXCEEDED'&&calls.length===beforeQuota,'Exhausted quota blocks paid provider call');
  const larger={...bound,WRITING_AI_DAILY_LIMIT:'20'};
  for(const failure of ['blank','non-json','truncated','outer-json','oversized','http401','http429','http500','network']){
    mode=failure;const response=await api('/api/ai/chat',chat,larger);
    check(response.status===502&&!JSON.stringify(response.body).includes('test-only-')&&await used(larger)===2,'Writing '+failure+' failure returns safe error and releases quota');
  }
  mode='pending';const cancellation=new AbortController();const cancelled=api('/api/ai/chat',chat,larger,cancellation.signal);setTimeout(()=>cancellation.abort(),10);
  check((await cancelled).status===499&&await used(larger)===2,'Cancelled writing request releases reserved quota');
  mode='ok';
  const invalid=await api('/api/ai/chat',{...chat,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'file:///private.png'}}]}]},larger);
  check(invalid.status===400&&await used(larger)===2,'Invalid Task 1 image format cannot consume quota');
  const concurrentEnv={...bound,WRITING_AI_DAILY_LIMIT:'3'},beforeConcurrent=calls.length;
  const concurrent=await Promise.all([api('/api/ai/chat',chat,concurrentEnv),api('/api/ai/chat',chat,concurrentEnv)]);
  check(concurrent.map(row=>row.status).sort().join(',')==='200,429'&&calls.length===beforeConcurrent+1&&await used(concurrentEnv)===3,'Atomic quota prevents concurrent final-credit overspend');
  const emptyConfig={...db};delete process.env.DEEPSEEK_API_KEY;
  const unconfigured=await api('/api/ai/chat',chat,emptyConfig);
  check(unconfigured.status===503&&unconfigured.body.error.code==='AI_NOT_CONFIGURED','No DeepSeek credential returns explicit unavailable response despite OpenAI aliases');
  result.passed=true;
}catch(error){result.passed=false;result.failure=error.stack;throw error;}
finally{
  globalThis.fetch=savedFetch;
  for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  db.close();writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT '+path.join(out,'result.json'));
}
