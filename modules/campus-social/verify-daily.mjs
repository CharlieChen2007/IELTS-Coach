import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs')));
const {openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));
const temp=mkdtempSync(path.join(tmpdir(),'ielts-daily-'));
const env=openLocalBindings(temp,{campus:true});
const origin='https://verified.test';
async function call(scope,path,body,cookie='',method='PUT'){
 return speakingApi(new Request(origin+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'X-Speaking-Scope':scope,'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
}
try{
 const a=await call('first','/api/campus/session',{nickname:'甲'},'','POST');
 const ca=a.headers.get('Set-Cookie').split(';')[0];
 const b=await call('second','/api/campus/session',{nickname:'乙'},'','POST');
 const cb=b.headers.get('Set-Cookie').split(';')[0];
 const state={version:1,cards:{word1:{n:2}},daily:{},streak:{days:0,last:''},settings:{target:15,newLimit:20}};
 assert.equal((await call('first','/api/daily/vocab',{state:JSON.stringify(state)},ca)).status,200);
 assert.deepEqual((await (await call('first','/api/daily/vocab',undefined,ca)).json()).data,state);
 assert.equal((await (await call('second','/api/daily/vocab',undefined,cb)).json()).data,null);
 assert.equal((await call('first','/api/daily/vocab',undefined,cb)).status,401);
 assert.equal((await call('first','/api/daily/vocab',{state:JSON.stringify(state)})).status,401);
 const daily={version:1,sessions:[],tasks:{},curve:[],streak:{days:0,last:''}};
 assert.equal((await call('first','/api/daily/shadow',{state:JSON.stringify(daily)},ca,'POST')).status,200);
 assert.deepEqual((await (await call('first','/api/daily/shadow',undefined,ca)).json()).data,daily);
 assert.equal((await call('first','/api/daily/shadow',{state:'broken'},ca)).status,400);
 console.log('PASS daily/vocab actor cookie isolation, forged scope rejection, wrapper JSON/POST backup, malformed payload, read-after-write');
} finally {env.close()}
