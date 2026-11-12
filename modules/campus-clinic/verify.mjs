// Run with Node 22.13+. All accounts and submissions live in a new temporary database.
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openLocalBindings} from '../speaking/scripts/local-bindings.mjs';
import {speakingApi} from '../../scripts/speaking-api.mjs';

const directory=mkdtempSync(path.join(tmpdir(),'ielts-clinic-check-')),origin='http://localhost';
let env=openLocalBindings(directory,{campus:true});
async function call(actor,url,data,blob,expected=200){
 const headers={Origin:origin,'X-Speaking-Scope':actor.name,Cookie:actor.cookie||''};
 let body;
 if(blob){body=new FormData();body.set('data',JSON.stringify(data));body.set('audio',blob,'answer.webm');}
 else if(data!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(data);}
 const response=await speakingApi(new Request(origin+'/api/'+url,{method:data===undefined?'GET':'POST',headers,body}),env);
 if(response.headers.get('set-cookie'))actor.cookie=response.headers.get('set-cookie').split(';')[0];
 const result=response.headers.get('content-type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
 if(Array.isArray(expected)){assert(expected.includes(response.status));return {status:response.status,result};}
 assert.equal(response.status,expected,url+' '+JSON.stringify(result));return result;
}
async function enrolled(name){
 const actor={name};
 await call(actor,'campus/session',{nickname:name});
 await call(actor,'clinic/board',undefined,undefined,403);
 await call(actor,'social/profile',{nickname:name});
 const {profile}=await call(actor,'social/me');
 assert.equal(profile.level,null);assert.equal(profile.target,null);assert.deepEqual(profile.slots,[]);
 if(name==='mentor') await call(actor,'social/profile',{nickname:name,strong:['reading','writing','speaking']});
 return actor;
}
const inputs=[
 {subject:'reading',sourceId:'exr_re_pass_01:q_re_4',title:'阅读判断题',prompt:'Green space is the only environment that restores attention.',original:'TRUE',issues:['证据定位'],reply:'Look at “only”. Other environments can also restore attention.',revised:'FALSE. The passage allows more than one restorative environment.'},
 {subject:'speaking',sourceId:'test-voice-study',title:'图书馆 · 观点展开',prompt:'Where do you study?',original:'In the library.',issues:['回答展开'],reply:'Add a concrete detail.',revised:'I usually read by the library window.'}
];
try{
 const [student,mentor,outsider]=await Promise.all(['student','mentor','other'].map(enrolled));
 await call({name:student.name},'social/profile',{nickname:'Impostor'},undefined,401);
 await call({name:mentor.name,cookie:student.cookie},'clinic/board',undefined,undefined,401);
 const start=Math.ceil((Date.now()+3600000)/900000)*900000;
 const exampleAudio=new Blob([new Uint8Array([26,69,223,163,21])],{type:'audio/webm'});
 for(const [idx,ex] of inputs.entries()){
  const {id}=await call(student,'clinic/create',{...ex,id:crypto.randomUUID(),private:idx===1},idx===1?exampleAudio:undefined,201);
  if(!idx){
   await call(mentor,'clinic/claim',{id});await call(outsider,'clinic/claim',{id},undefined,409);
   const replies=await Promise.all([ex.reply,'A competing suggestion'].map(text=>call(mentor,'clinic/reply',{id,text},undefined,[200,409])));
   assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
   const receipt=(await call(student,'clinic/case?id='+id)).reply;
   assert.equal(receipt,replies[0].status===200?ex.reply:'A competing suggestion');
   await call(mentor,'clinic/reply',{id,text:receipt});
   await call(outsider,'clinic/reply',{id,text:'Other account'},undefined,403);
   await call(mentor,'clinic/slots',{subject:ex.subject,focus:'阅读',start},undefined,400);
   await call(student,'clinic/revise',{id,text:ex.revised});await call(student,'clinic/resolve',{id});
   assert.equal((await call(student,'clinic/case?id='+id)).resolved,true);
   await call(mentor,'clinic/reply',{id,text:receipt});
   await call(mentor,'clinic/reply',{id,text:'Replacement'},undefined,409);
   const publicCard=await call(outsider,'clinic/case?id='+id);
   assert(publicCard.resolved&&publicCard.replied&&publicCard.revised);
   assert.equal(publicCard.original,null);assert.equal(publicCard.reply,null);assert.equal(publicCard.after,null);
   console.log('PASS concurrent claims/replies, one author, safe retries after resolution and public read-only privacy');
   continue;
  }else{
   await call(outsider,'clinic/case?id='+id,undefined,undefined,404);
   assert(!(await call(outsider,'clinic/board')).rows.some(r=>r.id===id));
  }
  await call(mentor,'clinic/slots',{subject:ex.subject,focus:ex.issues[0],place:'Library discussion room',start:start+idx*900000},undefined,201);
  const slotId=(await call(student,'clinic/slots')).slots.find(s=>s.subject===ex.subject).id;
  const raced=await Promise.all(Array.from({length:16},()=>call(student,'clinic/book',{id,issues:ex.issues,slotId},undefined,[200,409])));
  assert.equal(raced.filter(response=>response.status===200).length,1);
  const otherId=(await call(outsider,'clinic/create',{...ex,id:crypto.randomUUID(),private:true},exampleAudio,201)).id;
  await call(outsider,'clinic/book',{id:otherId,issues:ex.issues,slotId},undefined,409);
  await Promise.all(Array.from({length:4},()=>call(mentor,'clinic/advice',{id,text:ex.reply})));
  await call(mentor,'clinic/advice',{id,text:'Replace guidance'},undefined,409);
  assert.equal((await call(student,'clinic/board')).rows.find(r=>r.id===id).visitState,'consulted');
  await call(student,'clinic/revise',{id,text:ex.revised},undefined,400);await call(student,'clinic/revise',{id,text:ex.revised},exampleAudio);await call(student,'clinic/resolve',{id});await call(student,'clinic/resolve',{id});
  await call(mentor,'clinic/advice',{id,text:ex.reply});
  await call(mentor,'clinic/advice',{id,text:'Late guidance'},undefined,409);
  const saved=await call(student,'clinic/case?id='+id);assert.equal(saved.original,ex.original);assert.equal(saved.after.text,ex.revised);assert.equal(saved.visit.advice,ex.reply);assert.equal(saved.visit.place,'Library discussion room');assert.equal(saved.resolved,true);
  console.log('PASS '+ex.subject+' original → selected issues → real 15-minute reservation → mentor feedback → new answer → comparison');
 }
 // Verify that attached bytes are restricted to the actual owner or participating helper.

 const speech=await call(student,'clinic/create',{id:crypto.randomUUID(),private:false,subject:'speaking',sourceId:'test-recording:0',title:'Audio permission test',prompt:'Where do you study?',original:'At home',issues:['发音与重音']},exampleAudio,201);
 await call(outsider,'clinic/audio?id='+speech.id,undefined,undefined,403);
 await call(mentor,'clinic/claim',{id:speech.id});
 assert.deepEqual(await call(mentor,'clinic/audio?id='+speech.id),new Uint8Array(await exampleAudio.arrayBuffer()));
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS c FROM social_points').first()).c,2);
 env.close();env=openLocalBindings(directory,{campus:true});
 assert((await call(student,'clinic/board')).rows.some(r=>r.subject==='speaking'&&r.resolved));
 console.log('PASS private audio access, appointment conflicts, idempotent ledger, persistence after restart');
 const showcase={name:'showcase_clinic-check'};
 await call(showcase,'campus/session',{nickname:'演示同学'});
 const available=(await call(showcase,'clinic/slots')).slots;
 const demoSlot=available.find(slot=>slot.focus==='发音与重音');
 assert(demoSlot,'seeded mentor available');
 const demoCase=(await call(showcase,'clinic/create',{id:crypto.randomUUID(),private:true,subject:'speaking',sourceId:'demo-clip',title:'重音对比',prompt:'When will we meet?',original:'On Thursday.',issues:['发音与重音']},exampleAudio,201)).id;
 await call(showcase,'clinic/book',{id:demoCase,issues:['发音与重音'],slotId:demoSlot.id});
 const booked=(await call(showcase,'clinic/case?id='+demoCase)).visit;
 assert.equal(booked.state,'consulted');assert.match(booked.advice,/演示学伴建议.*发音与重音/);assert.match(booked.advice,/关键词/);
 await call(showcase,'clinic/revise',{id:demoCase,text:''},exampleAudio);
 const final=await call(showcase,'clinic/case?id='+demoCase);
 assert.equal(final.hasAudio,true);assert.equal(final.after.hasAudio,true);
 assert.deepEqual(await call(showcase,'clinic/audio?id='+demoCase+'&take=after'),new Uint8Array(await exampleAudio.arrayBuffer()));
 console.log('PASS showcase personal voice recording → seeded speech mentor booking → situation-specific guidance → recorded comparison');

}finally{env.close();for(const name of readdirSync(directory)){if(/^studio\.sqlite(?:-wal|-shm)?$/.test(name))unlinkSync(path.join(directory,name));}rmdirSync(directory);}

