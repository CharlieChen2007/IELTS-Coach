import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(path.join(tmpdir(),'writing-conflict-'));
const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs')));
const {openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));const db=openLocalBindings(dir,{campus:true});
const origin='https://writing-conflict.test',scope='usr_atomic_write';let cookie='';
const call=async(route,body)=>{
 const response=await speakingApi(new Request(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,'X-Speaking-Scope':scope,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),db);
 const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];return {status:response.status,body:await response.json()};
};
try{
 assert.equal((await call('/api/campus/session',{nickname:'并发写作'})).status,200);
 const workspace=text=>JSON.stringify({schema:'coach-writing-workspace-v2',keys:{'tcamp-guest-workspace:v1':JSON.stringify({schemaVersion:1,userId:'guest-local',topicId:'transport',entries:[{id:'concurrent-same-id',task:'task2',topicId:'transport',text,status:'done',isExample:false,report:{source:'rule',sentences:[]},createdAt:new Date().toISOString()}]})},topics:{}});
 const first=workspace('The first immutable essay has enough original content.'),second=workspace('The conflicting essay uses a different original text.');
 const results=await Promise.all([call('/api/writing/workspace',{workspace:first}),call('/api/writing/workspace',{workspace:second})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const snapshot=(await call('/api/writing/submissions')).body.submissions[0];const read=(await call('/api/writing/workspace')).body;
 const stored=JSON.parse(JSON.parse(read.data).keys['tcamp-guest-workspace:v1']).entries[0];assert.equal(stored.text,snapshot.text);
 assert.equal((await call('/api/writing/workspace',{workspace:results[0].status===200?first:second})).status,200);
 console.log('PASS concurrent same writing submission ID: exactly one commit, conflicting save 409, workspace matches immutable original, retry remains idempotent');
}finally{db.close()}
