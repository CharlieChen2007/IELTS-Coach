import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openLocalBindings} from '../speaking/scripts/local-bindings.mjs';
import {speakingApi} from '../../scripts/speaking-api.mjs';

const directory=mkdtempSync(path.join(tmpdir(),'ielts-growth-'));
let env=openLocalBindings(directory,{campus:true});
const origin='http://localhost';
async function send(actor,route,data,allowed=[200]){
  const headers={Origin:origin,'X-Speaking-Scope':actor.scope,Cookie:actor.cookie||''};
  if(data)headers['Content-Type']='application/json';
  const res=await speakingApi(new Request(origin+'/api/'+route,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined}),env);
  if(res.headers.get('set-cookie'))actor.cookie=res.headers.get('set-cookie').split(';')[0];
  const result=await res.json();
  assert(allowed.includes(res.status),JSON.stringify([route,res.status,result]));
  return result;
}
async function actor(scope,join=true){
  const who={scope};
  await send(who,'campus/session',{nickname:scope});
  if(join)await send(who,'social/profile',{nickname:scope});
  return who;
}
const g=(u,d,c)=>send(u,'social/growth',d,c);
const e=(u,d,c)=>send(u,'social/exam',d,c);
try {
  const a=await actor('li'),b=await actor('chen'),visitor=await actor('guest',false),show=await actor('showcase_teacher',false);
  assert.equal((await g(visitor)).joined,false);
  assert.equal((await g(show)).joined,true);
  assert.equal((await e(show)).stories.length,3);
  assert.equal((await e(a)).stories.length,0);
  const grade={action:'practice',attempts:[
    {id:'atm_read_1',subject:'reading',exercise:'exr_re_pass_01',questionIds:['q_re_1','q_re_2','q_re_3'],count:3,at:Date.now()},
    {id:'atm_write_1',subject:'writing',exercise:'exr_wr_task2_01',count:1,at:Date.now()}
  ]};
  const graded=await Promise.all([g(a,grade),g(a,grade)]);
  assert.equal(graded[1].pet.feed,2);
  const exchange={action:'exchange',food:'biscuit',id:'buy1'};
  await Promise.all([g(a,exchange),g(a,exchange)]);
  await g(a,{...exchange,id:'buy2'},[409]);
  const fed=await g(a,{action:'feed',food:'biscuit',id:'feed1'});
  assert.equal(fed.pet.feed,0); assert.equal(fed.pet.fed,1);assert.equal(fed.larder.biscuit,0);
  await g(a,{action:'feed',food:'biscuit',id:'feed1'});
  assert.equal((await g(b)).pet.fed,1);assert.equal((await g(b)).pet.questionsDone,0);assert.equal((await g(show)).pet.fed,13);
  await Promise.all([g(a,{action:'lamp'}),g(a,{action:'lamp'})]);
  assert.equal((await g(a)).lamp.streak,1);assert.equal((await g(b)).lamp.streak,0);
  const left={action:'archive',id:'edit-1',fields:{building:'二层测试室'},before:{building:''}},right={action:'archive',id:'edit-2',fields:{headset:'先试听'},before:{headset:''}};
  await Promise.all([e(a,left),e(b,right)]);
  await e(b,{...left,id:'edit-3',fields:{building:'过时的地点'}},[409]);
  await e(a,left);
  const exam=(await e(a)).exam;
  assert.equal(exam.contributors,2);assert.equal(exam.building,left.fields.building);assert.equal(exam.headset,right.fields.headset);
  const story={action:'story',id:'story-test',band:7,days:28,headline:'复盘定位句',body:'把原文和题干的同义替换并排抄下。'};
  await Promise.all([e(a,story),e(a,story)]);
  await Promise.all([e(a,{action:'like',id:story.id,liked:true}),e(b,{action:'like',id:story.id,liked:true})]);
  await e(b,{action:'like',id:story.id,liked:true});
  assert.equal((await e(a)).stories[0].likes,2);
  await e(b,{action:'like',id:story.id,liked:false});
  const record=(await e(b)).stories[0];assert.equal(record.likes,1);assert.equal(record.liked,0);
  await e(show,{action:'like',id:story.id,liked:true},[404]);
  assert((await g(a)).badges.includes('first_story'));assert(!(await g(b)).badges.includes('first_story'));
  assert((await g(b)).badges.includes('archive_hero'));assert(!(await g(visitor)).badges.includes('archive_hero'));
  const section=await send(b,'listening/practices/prac_lsn_s1');
  const handedIn={practice_id:'prac_lsn_s1',answers:section.items.slice(0,2).map(item=>({item_id:item.id,answer:'round'}))};
  await send(b,'listening/attempts',handedIn);
  await send(b,'listening/attempts',handedIn);
  assert.equal((await g(b)).pet.questionsDone,2);
  const oral={kind:'exam',id:'quick1'};
  await send(b,'campus/solo/start',oral);
  for(const answerId of ['one','two'])await send(b,'campus/solo/answer',{...oral,answerId});
  await send(b,'campus/solo/finish',oral);
  await g(b,{action:'practice',attempts:[{id:'atm_sp_exam_quick1',subject:'speaking',count:2,at:Date.now()}]});
  assert.equal((await g(b)).pet.questionsDone,4);
  assert.equal((await g(b)).pet.feed,2);
  await send(b,'listening/drills/single',{revision:0,answer:['B']});
  await send(b,'listening/drills/single',{revision:0,answer:['B']});
  assert.equal((await g(b)).pet.questionsDone,5);
  await send(b,'listening/drills/single',{revision:1,answer:['A']});
  assert.equal((await g(b)).pet.questionsDone,6);
  env.close();env=openLocalBindings(directory,{campus:true});
  assert.equal((await e(a)).stories[0].likes,1);assert.equal((await g(a)).pet.fed,1);
  console.log('PASS growth: shared campus, guest access, isolated showcases, exactly-once practice, exchange and feeding, daily lamp, concurrent archive and story likes, badges and persistence');
}finally{
  env.close();
  for(const file of readdirSync(directory))unlinkSync(path.join(directory,file));
  rmdirSync(directory);
}

