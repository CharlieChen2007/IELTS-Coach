// Real temporary SQLite, actual authentication/marking, and a non-network provider stub.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openLocalBindings} from '../speaking/scripts/local-bindings.mjs';
import {speakingApi} from '../../scripts/speaking-api.mjs';
import {handleStudyCoach,isStudyCoachApi} from './api.mjs';

const directory=mkdtempSync(path.join(tmpdir(),'ielts-study-coach-'));
let bindings=openLocalBindings(directory,{campus:true}),env={...bindings,STUDY_COACH_DAILY_LIMIT:'2'};
const origin='https://coach.test',savedFetch=globalThis.fetch;
let providerCalls=0,mode='valid';
globalThis.fetch=async(url,init)=>{
  assert.equal(new URL(url).host,'api.deepseek.com');
  assert.equal(init.headers.Authorization,'Bearer unit-test-placeholder');
  providerCalls++;
  if(mode==='api')return new Response('upstream failure',{status:503});
  if(mode==='delayed')await new Promise(resolve=>setTimeout(resolve,15));
  const body=JSON.parse(init.body),proof=JSON.parse(body.messages.at(-1).content).evidence;
  assert.equal(body.response_format.type,'json_object');
  const source=proof.sources[0];
  const output={summary:'这份复盘只依据已保存的答卷，建议先核对关键定位信息，再按步骤重做。',
    insights:[{evidenceId:source.evidenceId,quote:source.quote.slice(0,100),possibleCause:proof.hasErrors?'可能没有区分关键信息与干扰项':'已体现正确的信息定位',
      explanation:'把你的作答与题库证据逐项对照，先核对信息范围和说话人的最终结论。',nextStep:'先不看答案，在原文里圈出决定答案的信息，再说明排除其他选项的依据。'}],
    practicePlan:[{evidenceId:source.evidenceId,instruction:'回到同一段材料，重新定位本题的依据。',successCheck:'能够指出支持答案的原句，并解释原作答哪里与证据不符。'}]};
  if(mode==='quote')output.insights[0].quote='This sentence is invented and is not in the stored evidence.';
  if(mode==='evidence')output.practicePlan[0].evidenceId='reading:someone-elses-question';
  if(mode==='extra')output.score=9;
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
};
async function call(who,pathname,body,extra={}) {
  const method=body===undefined?'GET':'POST';
  const request=new Request(origin+pathname,{method,headers:{Origin:origin,'Content-Type':'application/json',
    ...(who?{'X-Speaking-Scope':who.scope,Cookie:who.cookie||''}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=isStudyCoachApi(new URL(request.url).pathname)?await handleStudyCoach(request,env):await speakingApi(request,env);
  const data=await response.json();return {response,data};
}
async function member(scope){const who={scope};const {response,data}=await call(who,'/api/campus/session',{nickname:scope});
  assert.equal(response.status,200);who.cookie=response.headers.get('Set-Cookie').split(';')[0];who.id=data.participant;return who;}
async function reading(who,id) {
  const result=await call(who,'/api/reading/submit',{id,passageId:'p1',answers:{'p1-q1':'FALSE'},startedAt:Date.now()});
  assert.equal(result.response.status,200);return result.data.session;
}
const query=ref=>'/api/ai/study-coach?'+new URLSearchParams(ref);
try {
  assert.equal(isStudyCoachApi('/api/ai/study-coach'),true);
  assert.equal(isStudyCoachApi('/api/ai/other'),false);
  const a=await member('coach-a'),b=await member('coach-b'),session=await reading(a,'s_coach_a');
  const ref={subject:'reading',attemptId:session.id};
  assert.equal((await call(null,query(ref))).response.status,401);
  assert.equal((await call(b,query(ref))).response.status,404);
  assert.equal((await call(a,'/api/ai/study-coach',ref,{Origin:'https://other.test'})).response.status,403);
  let result=await call(a,query(ref));assert.equal(result.data.configured,false);assert.equal(result.data.result,null);
  assert.equal((await call(a,'/api/ai/study-coach',ref)).response.status,503);
  assert.equal((await call(a,query(ref))).data.quota.used,0);
  assert.equal(providerCalls,0);
  env.DEEPSEEK_API_KEY='unit-test-placeholder';
  assert.equal((await call(a,'/api/ai/study-coach',{...ref,report:{correct:99}})).response.status,400);
  result=await call(a,'/api/ai/study-coach',ref);assert.equal(result.response.status,200);
  assert.equal(result.data.result.provider,'DeepSeek');assert.equal(result.data.result.basis.correct,session.correct);
  assert.match(result.data.result.analysis.practicePlan[0].path,/^subject\/reading\?view=practice&passage=p1$/);
  assert.equal(result.data.quota.used,1);assert.equal(providerCalls,1);
  assert.equal((await call(a,'/api/ai/study-coach',ref)).data.result.cached,true);assert.equal(providerCalls,1);
  const listening=await call(a,'/api/listening/attempts',{practice_id:'prac_lsn_s1',answers:[]});
  assert.equal(listening.response.status,200);
  result=await call(a,'/api/ai/study-coach',{subject:'listening',attemptId:listening.data.attempt_id});
  assert.equal(result.response.status,200);assert.equal(result.data.result.basis.correct,listening.data.summary.correct);
  assert.match(result.data.result.analysis.practicePlan[0].path,/^subject\/listening\?view=wrongbook&section=prac_lsn_s1$/);
  assert.equal(result.data.quota.used,2);
  const more=await reading(a,'s_coach_limit');
  assert.equal((await call(a,'/api/ai/study-coach',{subject:'reading',attemptId:more.id})).response.status,429);
  assert.equal(providerCalls,2);
  env.STUDY_COACH_DAILY_LIMIT='10';
  for(const invalid of ['quote','evidence','extra','api']){
    mode=invalid;const record=await reading(b,'s_coach_'+invalid);
    const bad=await call(b,'/api/ai/study-coach',{subject:'reading',attemptId:record.id});assert.equal(bad.response.status,502,invalid);
    assert.equal((await call(b,query({subject:'reading',attemptId:record.id}))).data.quota.used,0,'failed analysis charged '+invalid);
  }
  mode='delayed';const concurrent=await reading(b,'s_coach_concurrent'),concurrentRef={subject:'reading',attemptId:concurrent.id};
  const before=providerCalls,responses=await Promise.all(Array.from({length:5},()=>call(b,'/api/ai/study-coach',concurrentRef)));
  assert(responses.every(result=>result.response.status===200));assert.equal(providerCalls,before+1);
  assert.equal(responses[0].data.quota.used,1);
  const stored=await call(a,'/api/reading/attempts/'+session.id);assert.equal(stored.data.session.correct,session.correct);
  assert.deepEqual(stored.data.session.results,session.results,'AI changed source grading');
  bindings.close();bindings=openLocalBindings(directory,{campus:true});env={...bindings,DEEPSEEK_API_KEY:'unit-test-placeholder',STUDY_COACH_DAILY_LIMIT:'10'};
  result=await call(b,query(concurrentRef));assert.equal(result.response.status,200);assert(result.data.result.analysis.insights.length);
  assert.equal(result.data.quota.used,1,'usage did not persist');
  console.log('PASS study coach: authenticated immutable SQLite evidence, ownership, cross-site and input rejection, unconfigured no calls, DeepSeek JSON/schema and exact-quote validation, safe next routes, reading/listening success, cache, quota, concurrent de-duplication, failures, restart persistence; no real provider calls.');
} finally {globalThis.fetch=savedFetch;bindings.close();}
