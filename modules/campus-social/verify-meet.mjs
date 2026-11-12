import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs')));
const {openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));
const env=openLocalBindings(mkdtempSync(path.join(tmpdir(),'ielts-meet-')),{campus:true});
const origin='https://meet.test';
async function call(who,path,body,method='POST'){
 const r=await speakingApi(new Request(origin+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'X-Speaking-Scope':who.scope,'Content-Type':'application/json',Cookie:who.cookie||''},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 const data=await r.json();return {r,data};
}
async function member(scope){const who={scope};const {r,data}=await call(who,'/api/campus/session',{nickname:scope});who.cookie=r.headers.get('Set-Cookie').split(';')[0];who.id=data.participant;assert.equal((await call(who,'/api/social/profile',{nickname:scope})).r.status,200);return who}
try{
 const a=await member('a'),b=await member('b');
 await call(a,'/api/social/invite',{action:'send',other:b.id});await call(b,'/api/social/invite',{action:'accept',other:a.id});
 let id=crypto.randomUUID();
 assert.equal((await call(a,'/api/social/meet',{id,action:'propose',other:b.id,task:'reading-p1',start:Date.now()})).r.status,200);
 await call(b,'/api/social/meet',{id,action:'confirm',other:a.id});
 assert.equal((await call(a,'/api/social/meet',{id,action:'reflect',other:b.id,note:'before submit'})).r.status,409);
 assert.equal((await call(a,'/api/reading/submit',{id:'s_a',passageId:'p1',startedAt:Date.now(),answers:{'p1-q1':'TRUE'}})).r.status,200);
 const done=await call(a,'/api/social/meet',{id,action:'reflect',other:b.id,note:'我核对了原文中的范围词。'});assert.equal(done.r.status,200);assert.equal(done.data.meet.practiceDone,true);
 assert.equal((await call(b,'/api/social/meet',{id,action:'reflect',other:a.id,note:'before submit'})).r.status,409);
 await call(b,'/api/reading/submit',{id:'s_b',passageId:'p1',startedAt:Date.now(),answers:{'p1-q1':'FALSE'}});
 assert.equal((await call(b,'/api/social/meet',{id,action:'reflect',other:a.id,note:'我发现题干比原文范围更广。'})).data.meet.state,'done');
 id=crypto.randomUUID();await call(a,'/api/social/meet',{id,action:'propose',other:b.id,task:'writing-transport',start:Date.now()});await call(b,'/api/social/meet',{id,action:'confirm',other:a.id});
 assert.equal((await call(a,'/api/social/meet',{id,action:'reflect',other:b.id,note:'before submit'})).r.status,409);
 const submission={id:'sub_m',topicId:'transport',text:'Free transport can help students attend classes regularly.',status:'done',isExample:false,createdAt:new Date().toISOString(),report:{score:6.5}};
 const ws=await call(a,'/api/writing/workspace',{workspace:JSON.stringify({schemaVersion:1,entries:[submission]})},'PUT');assert.equal(ws.r.status,200);
 const after=await call(a,'/api/social/meet',{id,action:'reflect',other:b.id,note:'我增加了连接例子与观点的解释。'});assert.equal(after.r.status,200);assert.equal(after.data.meet.practiceDone,true);
 const growth=await call(a,'/api/social/growth');assert.equal(growth.data.pet.questionsDone,2);
 const again=await call(a,'/api/social/growth');assert.equal(again.data.pet.questionsDone,2);
 console.log('PASS real two participants: new reading/writing shared tasks, premature reflections blocked, matching own immutable submit required, both peers complete and exchange, growth gives 2 valid units and no duplicate');
}finally{env.close()}
