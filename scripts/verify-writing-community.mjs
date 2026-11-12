import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openLocalBindings} from '../modules/speaking/scripts/local-bindings.mjs';
import {speakingApi} from './speaking-api.mjs';
import {ensureWritingEngine} from '../modules/writing-engine/api.mjs';
import {hashScoringReport} from '../modules/writing-engine/scoring/src/scoring.mjs';
const env=openLocalBindings(mkdtempSync(path.join(tmpdir(),'writing-community-')),{campus:true}),origin='https://community.test',users=new Map();
async function api(who,url,body){const u=users.get(who)||{};const response=await speakingApi(new Request(origin+url,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Speaking-Scope':who,Cookie:u.cookie||''},body:body?JSON.stringify(body):undefined}),env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));if(response.headers.has('set-cookie'))users.set(who,{cookie:response.headers.get('set-cookie').split(';')[0],owner:data.participant});return data;}
try{
 for(const name of ['alice','bob']){await api(name,'/api/campus/session',{nickname:name});await api(name,'/api/social/profile',{nickname:name,level:5.5,target:7,strong:['reading'],need:['writing'],slots:['周三晚间']});}
 await ensureWritingEngine(env);
 const root=new URL('../modules/writing-engine/',import.meta.url);
 for(const [task,sub] of [['task1','task1/examples/'],['task2','task2/examples/task2/']]){
  const req=JSON.parse(readFileSync(new URL(sub+'request.sample.json',root),'utf8')),report=JSON.parse(readFileSync(new URL(sub+'report.sample.json',root),'utf8')),owner=users.get('alice').owner;
  await env.DB.prepare('INSERT INTO writing_engine_attempts(owner,id,task,question,mode,text,text_hash,first_id,attempt_no,origin,created,report,locked_hash,stored) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(owner,req.submissionId,task,req.questionId,'essay',req.text,'test-hash',req.submissionId,1,'learner',Date.now(),JSON.stringify(report),hashScoringReport(report),Date.now()).run();
 }
 await api('alice','/api/social/plaza',{action:'publish',nickname:'alice',subject:'writing',subjects:['writing'],gift:'reading',message:'每周一起完成首稿互评',slot:'周三晚间',target:7,summary:''});
 const data=await api('bob','/api/social/plaza'),card=data.cards.find(row=>row.profile.nickname==='alice');
 assert(card);assert.equal(card.profile.writingAssessment.status,'complete');assert.deepEqual({task1:card.profile.writingAssessment.task1,task2:card.profile.writingAssessment.task2},{task1:1,task2:1});
 assert.deepEqual(Object.keys(card.profile.writingAssessment).sort(),['band','source','status','task1','task2']);
 const body=JSON.stringify(data);assert(!body.includes('lockedReportHash'));assert(!body.includes('firstSubmissionId'));assert(!body.includes('The charts compare'));assert.equal(data.profile.writingAssessment.status,'unavailable');
 console.log('PASS community uses only server all-first-draft summary; empty profile works; no report, original essay or private record IDs exposed');
}finally{env.close();}
