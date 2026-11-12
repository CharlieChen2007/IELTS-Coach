import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=fileURLToPath(new URL('../../',import.meta.url));
const {openLocalBindings}=await import(pathToFileURL(path.join(project,'modules/speaking/scripts/local-bindings.mjs')));
const {speakingApi}=await import(pathToFileURL(path.join(project,'scripts/speaking-api.mjs')));
const bank=JSON.parse(readFileSync(path.join(project,'modules/listening/data/practices.json')));
const directory=mkdtempSync(path.join(tmpdir(),'listening-auth-db-'));
let db=openLocalBindings(directory,{campus:true});
const student={name:'student'},second={name:'second'};
async function fetchAs(who,endpoint,body,status=200) {
  const headers={'X-Speaking-Scope':who.name,Cookie:who.cookie||'',Origin:'http://localhost','Content-Type':'application/json'};
  const req=new Request('http://localhost/api/'+endpoint,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
  const res=await speakingApi(req,db);
  const cookie=res.headers.get('Set-Cookie');if(cookie)who.cookie=cookie.split(';')[0];
  const data=await res.json();
  assert.equal(res.status,status,endpoint+' '+JSON.stringify(data).slice(0,260));
  return data;
}
try {
  for(const who of [student,second])await fetchAs(who,'campus/session',{nickname:who.name});
  assert.deepEqual((await fetchAs(student,'listening/drills')).items,[]);
  const drills=JSON.parse(readFileSync(path.join(project,'modules/listening/data/drills.json')));
  assert.equal(drills.length,9);
  for(const drill of drills){
    const endpoint='listening/drills/'+drill.id, initial=await fetchAs(student,endpoint);
    assert.equal(initial.result,null);
    assert.doesNotMatch(JSON.stringify(initial),/"accepted"|"script"|"reason"|"correct"/);
    const answer=drill.options?drill.correct:[drill.correct[0].toUpperCase()];
    const payload={revision:0,answer};
    const [feedback,again]=await Promise.all([fetchAs(student,endpoint,payload),fetchAs(student,endpoint,payload)]);
    assert.deepEqual(again,feedback);
    assert.equal(feedback.correct,initial.total);
    assert.equal((await fetchAs(student,endpoint)).result.script,drill.script);
    assert.equal((await fetchAs(second,endpoint)).result,null);
  }
  const multi='listening/drills/multiple';
  await fetchAs(student,multi,{revision:1,answer:['A','A']},400);
  const partial=await fetchAs(student,multi,{revision:1,answer:['A','B']});
  assert.equal(partial.correct,1);assert.equal(partial.total,2);
  await fetchAs(student,multi,{revision:1,answer:['C','D']},409);
  assert.equal((await fetchAs(student,'listening/drills')).items.length,9);
  assert.equal((await fetchAs(student,'listening/attempts')).items.length,0);
  console.log('PASS nine original listening drills, private results, redaction, repeat submissions, partial credit and stale retry.');
  let firstAttempt;
  for(const practice of Object.values(bank)){
    const id=practice.practice_id,prefix='listening/practices/'+id;
    const pub=await fetchAs(student,prefix);
    assert.equal(pub.items.length,practice.items.length);
    assert.doesNotMatch(JSON.stringify(pub),/"correct_answers"|"distractors"|"explanation"|"transcripts"|"evidence"|答案是 radiation|officer → Rooms/);
    await fetchAs(student,prefix+'/transcript',undefined,403);
    const answers=practice.items.map(i=>({item_id:i.id,answer:i.correct_answers[0]}));
    const attempts=await Promise.all([1,2].map(()=>fetchAs(student,'listening/attempts',{practice_id:id,answers})));
    assert.equal(attempts[0].attempt_id,attempts[1].attempt_id);
    const result=attempts[0];assert.equal(result.summary.correct,practice.items.length);
    assert.equal(result.summary.wrong,0);
    assert(result.transcripts&&Object.keys(result.transcripts).length);
    await fetchAs(second,'listening/attempts/'+result.attempt_id,undefined,404);
    await fetchAs(second,prefix+'/transcript',undefined,403);
    assert.equal((await fetchAs(student,'listening/attempts?practice_id='+id)).items.length,1);
    if(!firstAttempt) firstAttempt=result.attempt_id;
  }
  const section='prac_lsn_s1';
  await fetchAs(student,'listening/sections/'+section+'/reset',{practice_id:section});
  await fetchAs(student,'listening/practices/'+section+'/transcript',undefined,403);
  const prev=await fetchAs(student,'listening/attempts/'+firstAttempt);assert.equal(prev.summary.correct,7);
  assert.equal((await fetchAs(student,'listening/practices/prac_lsn_s2/result')).summary.correct,5);
  const again=await fetchAs(student,'listening/attempts',{practice_id:section,answers:[]});assert.equal(again.summary.missed,7);
  assert.notEqual(again.attempt_id,firstAttempt,'distinct attempt even if repeated in the same second');
  db.close();db=openLocalBindings(directory,{campus:true});
  assert.equal((await fetchAs(student,'listening/attempts')).items.length,5);
  assert.equal((await fetchAs(second,'listening/attempts')).items.length,0);
  assert.equal((await fetchAs(student,'listening/practices/'+section+'/result')).attempt_id,again.attempt_id);
  const wb=await fetchAs(student,'listening/wrongbook?practice_id='+section);
  const entry=wb.items.find(e=>e.item_id===bank[section].items[0].id);
  const params={practice_id:section,item_id:entry.item_id,request_id:'first-retry',mode:'redo',answer:'round'};
  await fetchAs(student,'listening/wrongbook/'+entry.id+'/review',params);
  const duplicate=await fetchAs(student,'listening/wrongbook/'+entry.id+'/review',params);
  assert.equal(duplicate.entry.review_history.length,1);assert.notEqual(duplicate.entry.status,'mastered');
  params.request_id='second-retry';const next=await fetchAs(student,'listening/wrongbook/'+entry.id+'/review',params);
  assert.equal(next.entry.review_history.length,2);assert.equal(next.entry.status,'mastered');
  console.log('PASS all 22 full marks; redaction and section locks; concurrent submit deduplication; reset preserves history and other sections; restart persistence; cookie isolation; retry idempotence and mastery.');
}finally{db.close();}
