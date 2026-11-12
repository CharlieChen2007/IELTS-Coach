import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {speakingApi} from './speaking-api.mjs';
import {openLocalBindings} from '../modules/speaking/scripts/local-bindings.mjs';
import {saveSoeEvidence} from '../modules/speaking/server/speaking-evidence.mjs';

const directory=mkdtempSync(path.join(os.tmpdir(),'coach-oral-deepseek-'));
const env=openLocalBindings(directory,{campus:true});
Object.assign(env,{DEEPSEEK_API_KEY:'mock-deepseek-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com',DEEPSEEK_MODEL:'deepseek-flash',TENCENT_APP_ID:'1',TENCENT_SECRET_ID:'mock-id',TENCENT_SECRET_KEY:'mock-key',SOE_SITE_DAILY_LIMIT:'1000',SOE_VISITOR_DAILY_LIMIT:'1000'});
const originalFetch=globalThis.fetch,origin='https://oral.test',requests=[],owners=new Map();
let failTencent=false,failDeepSeek=false,holdModel,modelStarted;
env.openTencentSocket=()=>{
 const events=new EventTarget();return {
  addEventListener:(...args)=>events.addEventListener(...args),close(){},
  accept(){queueMicrotask(()=>events.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({code:0})})));},
  send(data){if(typeof data==='string')queueMicrotask(()=>events.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(failTencent?{code:4002}:{code:0,final:1,result:{SentenceId:-1,PronAccuracy:50,PronFluency:.75,Words:[{Word:'university',PronAccuracy:55,PronFluency:.7,PhoneInfos:[]}]}})})));}
 };
};
globalThis.fetch=async(url,options)=>{
 assert.equal(new URL(url).host,'api.deepseek.com');const body=JSON.parse(options.body);requests.push(body);
 assert.equal(body.model,'deepseek-flash');assert(body.messages.every(message=>typeof message.content==='string'));
 assert(!JSON.stringify(body).includes('LEGACY_AUDIO_MUST_NOT_LEAVE_SERVER'));
 if(failDeepSeek)return new Response('',{status:503});
 if(holdModel){modelStarted?.();await holdModel;}
 const context=JSON.parse(body.messages.at(-1).content);
 const result=context.turns?{summary:'用具体细节支持观点，并连接理由与经历。',language:['coherence','lexical','grammar'].map(key=>({key,band:key==='coherence'?6.5:6,questionId:context.turns[0].questionId,quote:context.turns[0].transcript.slice(0,35),evidence:'转写中给出了学习场景。',advice:'用一个具体经历说明这个理由。'})),pronunciation:{band:9}}:
  {feedback:'你的例子提到校园图书馆，可以补充一次具体经历。',nextQuestion:'What happened during your last visit to the campus library?'};
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],model:'deepseek-flash',usage:{prompt_tokens:10,completion_tokens:20}});
};
async function call(scope,cookie,route,body){
 const headers=new Headers({'X-Speaking-Scope':scope,'Origin':origin,'Sec-Fetch-Site':'same-origin'});
 if(owners.has(scope))headers.set('X-Speaking-Account',owners.get(scope));
 if(cookie)headers.set('Cookie',cookie);if(body!==undefined)headers.set('Content-Type','application/json');
 return speakingApi(new Request(origin+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
}
async function join(scope){const response=await call(scope,'','/api/campus/session',{nickname:scope});assert.equal(response.status,200);const body=await response.json();owners.set(scope,body.participant);return {scope,cookie:response.headers.get('set-cookie').split(';')[0],owner:body.participant};}
function pcm(seconds,seed=0){const bytes=new Uint8Array(seconds*32000),view=new DataView(bytes.buffer);for(let i=0;i<bytes.length/2;i++)view.setInt16(i*2,Math.round(9000*Math.sin(i/16000*Math.PI*(400+seed*20))),true);return bytes;}
const encode=bytes=>Buffer.from(bytes).toString('base64');
const turns=[1,2,3].map(part=>{const data=pcm(part===2?60:1,part);return {questionId:'q'+part,part,phase:part===2?'talk':part===1?'part1':'part3',prompt:'Describe your study routine.',durationMs:part===2?60000:1000,recordedAt:1,savedAt:70000,mimeType:'audio/wav',byteLength:data.length,transcript:('I study engineering at university because the campus library offers a quiet place where I can discuss useful ideas with my classmates and prepare detailed notes for the next lesson. ').repeat(2),transcriptStatus:'complete',transcriptSource:'browser',audio:{encoding:'base64',mimeType:'audio/wav',byteLength:data.length,data:encode(data)}};});
const handoff=id=>({schemaVersion:'speaking-a.handoff.v1',session:{id,mode:'full',status:'submitted',createdAt:1,endedAt:70000,submittedAt:71000,durationMs:70000,interrupted:false,assessmentEligible:true},turns});
try{
 const alice=await join('alice'),bob=await join('bob');
 assert.equal((await call(alice.scope,alice.cookie,'/api/me')).status,200,'公开版cookie身份接通');
 assert.equal((await call('alice','','/api/coach/status')).status,401,'scope不能代替cookie');
 const status=await (await call(alice.scope,alice.cookie,'/api/coach/status')).json();assert.equal(status.provider,'DeepSeek');assert.equal(status.audioInput,false);
 const reply=await (await call(alice.scope,alice.cookie,'/api/coach/reply',{topic:'campus',turns:[],question:'Where do you study?',answer:'I study in the campus library.'})).json();assert.equal(reply.source.kind,'deepseek_text');assert(reply.nextQuestion.includes('library'));
 assert.equal((await call(alice.scope,alice.cookie,'/api/sessions',handoff('exam-a'))).status,201);
 const legacy={sessionId:'exam-a',samples:[{data:'LEGACY_AUDIO_MUST_NOT_LEAVE_SERVER'}],scores:{pronunciation:9,fluency:9}};
 const missing=await (await call(alice.scope,alice.cookie,'/api/coach/report',legacy)).json();
 assert.equal(missing.band,null);assert.equal(missing.dimensions.find(item=>item.key==='pronunciation').band,null);assert.equal(missing.dimensions.find(item=>item.key==='fluency').band,null);assert.equal(missing.dimensions.find(item=>item.key==='grammar').band,6);
 assert.equal((await call(bob.scope,bob.cookie,'/api/coach/report',{sessionId:'exam-a'})).status,404,'异账号不能查看或评估别人的会话');
 const failedId=crypto.randomUUID();failTencent=true;
 assert.equal((await call(alice.scope,alice.cookie,'/api/soe/evaluate',{audio:encode(pcm(1)),requestId:failedId,context:{kind:'exam',sessionId:'exam-a',questionId:'q1',segmentIndex:0,segmentCount:1}})).status,502);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM speaking_soe_evidence').first()).n,0,'未成功腾讯回执不可成为证据');failTencent=false;
 const firstRequest=crypto.randomUUID();
 for(const [i,turn]of turns.entries()){
  const response=await call(alice.scope,alice.cookie,'/api/soe/evaluate',{audio:turn.audio.data,requestId:i===0?firstRequest:crypto.randomUUID(),context:{kind:'exam',sessionId:'exam-a',questionId:turn.questionId,segmentIndex:0,segmentCount:1},accuracy:100});
  assert.equal(response.status,200);assert.equal((await response.json()).accuracy,50);
 }
 const full=await (await call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'exam-a',accuracy:100})).json();
 assert.equal(full.dimensions.find(item=>item.key==='pronunciation').band,null,'不编造腾讯到雅思的换算');
 assert.equal(full.dimensions.find(item=>item.key==='pronunciation').metric.value,50,'只显示真实腾讯百分制，不采客户端或模型9分');
 assert.equal(full.voiceEvidence.length,3);assert.equal(full.band,null);assert.equal(full.source.audioSentToDeepSeek,false);assert.equal(full.source.official,false);assert(full.voiceEvidence.every(row=>row.activeMs>0&&row.receiptCount===1));
 const count=requests.length;await call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'exam-a'});assert.equal(requests.length,count,'相同权威证据命中缓存');
 const stored=(await env.DB.prepare('SELECT request_key FROM speaking_soe_evidence WHERE owner_id=? AND question_id=?').bind(alice.owner,'q1').first()).request_key;
 await saveSoeEvidence(env,bob.owner,{context:{kind:'exam',sessionId:'exam-a',questionId:'q1',segmentIndex:0,segmentCount:1}},stored,pcm(1),{accuracy:100});
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM speaking_soe_evidence WHERE owner_id=?').bind(bob.owner).first()).n,0,'其他账号不能绑定别人的回执');
 const quick=handoff('quick-a');quick.session.mode='quick';assert.equal((await call(alice.scope,alice.cookie,'/api/sessions',quick)).status,201);assert.equal((await call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'quick-a'})).status,400);
 const manual=handoff('manual-a');manual.turns=turns.map(turn=>({...turn,transcriptSource:'manual'}));assert.equal((await call(alice.scope,alice.cookie,'/api/sessions',manual)).status,201);assert.equal((await call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'manual-a'})).status,400);
 const wordMode=await call(alice.scope,alice.cookie,'/api/soe/evaluate',{audio:encode(pcm(1)),requestId:crypto.randomUUID(),word:'university',context:{kind:'exam',sessionId:'exam-a',questionId:'q1',segmentIndex:0,segmentCount:1}});assert.equal(wordMode.status,400,'单词回执不得混入模考');
 const pending=await call(alice.scope,alice.cookie,'/api/soe/evaluate',{audio:encode(pcm(1)),requestId:crypto.randomUUID(),context:{kind:'exam',sessionId:'not-uploaded',questionId:'q1',segmentIndex:0,segmentCount:1}});assert.equal((await pending.json()).code,'SOE_SESSION_PENDING','自动队列可等待封卷后重试');
 const usage=await env.DB.prepare('SELECT calls FROM speaking_model_usage WHERE owner_id=?').bind(alice.owner).first();failDeepSeek=true;
 assert.equal((await call(alice.scope,alice.cookie,'/api/coach/reply',{topic:'campus',turns:[],question:'Where?',answer:'I study in a library.'})).status,502);failDeepSeek=false;
 assert.equal((await env.DB.prepare('SELECT calls FROM speaking_model_usage WHERE owner_id=?').bind(alice.owner).first()).calls,usage.calls,'失败退款额度');
 assert.equal((await call(alice.scope,alice.cookie,'/api/sessions',handoff('concurrent-a'))).status,201);
 let release;holdModel=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{modelStarted=resolve;});
 const first=call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'concurrent-a'});await started;
 const duplicate=await call(alice.scope,alice.cookie,'/api/coach/report',{sessionId:'concurrent-a'});assert.equal(duplicate.status,409);release();holdModel=null;assert.equal((await first).status,200);
 await env.DB.prepare('UPDATE speaking_soe_receipts SET reserved_at=?').bind(Date.now()-9*86400000).run();
 await call(alice.scope,alice.cookie,'/api/soe/evaluate',{audio:encode(pcm(1)),requestId:crypto.randomUUID()});
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM speaking_soe_evidence e JOIN speaking_soe_receipts r ON e.request_key=r.request_key WHERE e.owner_id=?').bind(alice.owner).first()).n,3,'引用中的成功回执超过7天仍保留');
 assert(!readFileSync(new URL('../modules/speaking/server/coaching.mjs',import.meta.url),'utf8').includes('input_audio'));
 console.log('PASS public-cookie identity, DeepSeek text reply, own sealed session, missing-score null, fake-score ignored, failed receipt excluded, real Tencent/PCM evidence, source labels, account isolation, cache, quick/manual gates; all upstream mocked, no paid requests.');
}finally{globalThis.fetch=originalFetch;env.close();rmSync(directory,{recursive:true,force:true});}
