import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {speakingApi} from './speaking-api.mjs';
import {openLocalBindings} from '../modules/speaking/scripts/local-bindings.mjs';
import {task2Feedback} from '../modules/writing-engine/task2/tests/task2-fixtures.mjs';
const read=async name=>JSON.parse(await readFile(new URL('../modules/writing-engine/'+name,import.meta.url),'utf8'));
const request1=await read('task1/examples/request.sample.json'),report1=await read('task1/examples/report.sample.json');
const request2=await read('task2/examples/task2/request.sample.json'),report2=await read('task2/examples/task2/report.sample.json');
const dir=await mkdtemp(path.join(os.tmpdir(),'writing-engine-')),bindings=openLocalBindings(dir,{campus:true});
const env={...bindings,DEEPSEEK_API_KEY:'offline-provider-test',WRITING_AI_DAILY_LIMIT:'20'},origin='https://writing.test';
const savedFetch=globalThis.fetch;let calls=0,behavior='normal';
function replaceIds(value,oldId,newId){if(Array.isArray(value))return value.map(x=>replaceIds(x,oldId,newId));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replaceIds(v,oldId,newId)]));return typeof value==='string'&&value.startsWith(oldId+':')?newId+value.slice(oldId.length):value;}
globalThis.fetch=async(url,options)=>{
  calls++;const input=JSON.parse(options.body),text=input.messages.findLast(m=>m.role==='user').content;
  const payload=JSON.parse(Array.isArray(text)?text.find(x=>x.type==='text').text:text);
  let output;
  if(payload.essay){
    const template=payload.sourceAnalysis?report1:report2;
    const id=payload.sentences[0].id.split(':')[0];output=replaceIds(structuredClone(template.feedback),template.submissionId,id);
    output.sentences=output.sentences.map(({start,end,paragraph,index,text,...sentence})=>sentence);
    if(!payload.sourceAnalysis&&behavior==='low-task2')for(const value of Object.values(output.scores))value.band=5;
    if(!payload.sourceAnalysis&&behavior==='revision')output=task2Feedback({questionId:'T2-026',submissionId:id,text:payload.essay,mode:'essay'});
    if(payload.sourceAnalysis){
      if(behavior==='auxiliary'){output.checks[0].impact='minor';output.review.decision='ready';output.checks.at(-1).verdict='unverifiable';output.modelAnswer.text='A short reference.';}
      if(behavior==='invalid-quote')output.checks[0].quote='Invented quote not present in learner response.';
    }
  }else output=report2.source.analysis;
  return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:20,completion_tokens:30}});
};
const users=new Map();
async function call(name,route,body,extra={}){
 const u=users.get(name)||{},headers={Origin:origin,'Sec-Fetch-Site':'same-origin','X-Speaking-Scope':name,...(u.cookie?{Cookie:u.cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra};
 const response=await speakingApi(new Request(origin+route,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}),env);
 if(response.headers.has('set-cookie'))users.set(name,{cookie:response.headers.get('set-cookie').split(';')[0]});
 return {status:response.status,body:await response.json()};
}
try{
 for(const name of ['alice','bob','auxiliary','bad'])assert.equal((await call(name,'/api/campus/session',{nickname:name})).status,200);
 let result=await call('alice','/api/writing/evaluate',{task:'task1',...request1});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.report.assessment.displayBand,report1.assessment.displayBand);
 const before=calls;
 result=await call('alice','/api/writing/evaluate',{task:'task1',...request1,submissionId:'another-id'});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(calls,before);assert.equal(result.body.report.submissionId,'another-id');
 result=await call('alice','/api/writing/evaluate',{task:'task2',...request2});assert.equal(result.status,200,JSON.stringify(result.body));
 let profile=await call('alice','/api/writing/profile');assert.equal(profile.status,200,JSON.stringify(profile.body));assert.equal(profile.body.hostAggregate.status,'complete',JSON.stringify(profile.body));assert.deepEqual(profile.body.hostAggregate.sampleCounts,{task1:1,task2:1});
 behavior='low-task2';result=await call('alice','/api/writing/evaluate',{task:'task2',...request2,questionId:'T2-902',submissionId:'other-question'});assert.equal(result.status,200,JSON.stringify(result.body));
 profile=await call('alice','/api/writing/profile');assert.deepEqual(profile.body.hostAggregate.sampleCounts,{task1:1,task2:2});
 assert.equal(profile.body.hostAggregate.writingRaw,(report1.assessment.unroundedMean+2*(report2.assessment.unroundedMean+5)/2)/3,'all eligible first drafts enter the mean; no cherry-picking');
 behavior='revision';result=await call('alice','/api/writing/evaluate',{task:'task2',...request2,text:request2.text+' I will continue learning.',submissionId:'second-draft'});assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(result.body.report.scoreRecord.draftRole,'revision');profile=await call('alice','/api/writing/profile');assert.deepEqual(profile.body.hostAggregate.sampleCounts,{task1:1,task2:2},'revision is excluded');
 assert.equal((await call('bob','/api/writing/profile')).body.hostAggregate.status,'unavailable');
 behavior='auxiliary';result=await call('auxiliary','/api/writing/evaluate',{task:'task1',...request1});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.report.feedback.review.decision,'revise');assert.equal(result.body.report.feedback.modelAnswer.text,'');assert.equal(result.body.report.assessment.displayBand,report1.assessment.displayBand);assert(result.body.report.deliveryPolicy.changes.length>=2);
 behavior='invalid-quote';result=await call('bad','/api/writing/evaluate',{task:'task1',...request1});assert.equal(result.status,502);assert(result.body.error.traceId);
 const status=await call('bad','/api/writing/ai/status');assert.equal(status.body.quota.used,0);
 assert.equal((await call('alice','/api/writing/evaluate',{task:'task1',...request1},{Origin:'https://foreign.test'})).status,403);
 console.log('PASS Task1/Task2 server algorithms, trusted immutable report/first drafts, cached same text, all-first-drafts aggregate, owner isolation, conservative auxiliary recovery, invalid evidence rejection, trace and quota rollback; no paid requests');
}finally{globalThis.fetch=savedFetch;bindings.close();}
