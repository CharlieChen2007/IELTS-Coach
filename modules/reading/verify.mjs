import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalBindings} from '../speaking/scripts/local-bindings.mjs';
import {speakingApi} from '../../scripts/speaking-api.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=mkdtempSync(path.join(tmpdir(),'reading-verification-'));
let env=openLocalBindings(dir,{campus:true});
const a={scope:'reader-a'},b={scope:'reader-b'};
async function as(user,route,body,status=200){
  const response=await speakingApi(new Request('http://localhost/api/'+route,{method:body?'POST':'GET',headers:{Origin:'http://localhost','Content-Type':'application/json','X-Speaking-Scope':user.scope,Cookie:user.cookie||''},body:body?JSON.stringify(body):undefined}),env);
  if(response.headers.get('Set-Cookie'))user.cookie=response.headers.get('Set-Cookie').split(';')[0];
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
try{
  await as(a,'reading/state',undefined,401);
  for(const user of [a,b]){await as(user,'campus/session',{nickname:user.scope});await as(user,'social/profile',{nickname:user.scope})}
  const ids=JSON.parse(readFileSync(path.join(root,'public/reading/content/passages/index.json')));
  let total=0,first;
  for(const id of ids){
    const passage=JSON.parse(readFileSync(path.join(root,'public/reading/content/passages',id+'.json')));
    const answers=Object.fromEntries(passage.sections.flatMap(s=>s.questions.map(q=>[q.id,String(q.answer.value)])));
    const input={id:'s_'+id,passageId:id,startedAt:Date.now()-5000,answers};
    const [one,two]=await Promise.all([as(a,'reading/submit',input),as(a,'reading/submit',input)]);
    assert.deepEqual(one,two);assert.equal(one.session.correct,Object.keys(answers).length);total+=one.session.total;first??=one.session;
    await as(a,'reading/submit',{...input,answers:{}},409);
    await as(b,'reading/attempts/'+one.session.id,undefined,404);
  }
  assert.equal(total,217);assert.equal((await as(a,'reading/attempts')).items.length,18);assert.equal((await as(b,'reading/attempts')).items.length,0);
  const q=first.results[0],review={subject:'reading',sourceId:'rpt_rd_'+first.id,exerciseId:'reading_'+first.passageId,questionId:q.questionId,before:q.response,after:q.explanation.quote,reason:'根据原文直接核对判断范围。'};
  const award=await as(a,'social/practice',review);assert.equal(award.awardedPoints,5);assert.equal((await as(a,'social/practice',review)).awardedPoints,0);
  await as(b,'social/practice',review,400);
  const growth=await as(a,'social/growth');assert.equal(growth.pet.questionsDone,217);
  env.close();env=openLocalBindings(dir,{campus:true});assert.equal((await as(a,'reading/attempts')).items.length,18);
  console.log('PASS reading all 18 passages / 217 questions, authoritative immutable grading, concurrent retry deduplication, cookie isolation, exact-once campus review, growth and restart persistence');
}finally{env.close()}
