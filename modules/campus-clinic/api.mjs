import { requireMember, awardHelp } from '../campus-social/identity.mjs';

const subjects = ['listening','speaking','reading','writing'];
const quarter = 15 * 60 * 1000;
const audioLimit = 4 * 1024 * 1024;
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function fail(status,message) { throw Object.assign(new Error(message),{status}); }
function string(val,max,required=true) {
  if (typeof val !== 'string' || val.trim().length > max || (required && !val.trim())) fail(400,'请完整填写内容，并检查长度。');
  return val.trim();
}
function id(val) { if (typeof val !== 'string' || !/^[A-Za-z0-9_-]{4,100}$/.test(val)) fail(400,'记录编号无效。'); return val; }
function subject(val) { if (!subjects.includes(val)) fail(400,'请选择科目。'); return val; }
function issues(val) {
  if (!Array.isArray(val) || !val.length || val.length>8) fail(400,'请选择 1 至 8 个问题。');
  return [...new Set(val.map(v=>string(v,180)))];
}
async function limited(req,limit) {
  if (Number(req.headers.get('Content-Length'))>limit) fail(413,'附件过大，请选择小于 4 MB 的录音。');
  const reader=req.body?.getReader(); if(!reader)fail(400,'缺少提交内容。');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;
    if(length>limit){await reader.cancel();fail(413,'提交内容超过大小限制。');}chunks.push(value);}
  return new Blob(chunks);
}
async function input(req) {
  const mime=req.headers.get('Content-Type')||'';
  if(mime.startsWith('multipart/form-data')) {
    const bytes=await limited(req,audioLimit+90000);
    let form,data;
    try { form=await new Response(bytes,{headers:{'Content-Type':mime}}).formData();data=JSON.parse(form.get('data')); } catch { fail(400,'提交内容无效。'); }
    const audio=form.get('audio');
    if(!audio || typeof audio==='string' || !audio.size || audio.size>audioLimit ||
      !/^audio\/(webm|ogg|mpeg|mp3|wav|x-wav|mp4|aac|m4a|x-m4a|3gpp)(?:;.*)?$/i.test(audio.type)) fail(400,'请选择 4 MB 以内的常见音频格式。');
    return {data,audio};
  }
  if(!mime.includes('application/json'))fail(415,'请使用 JSON 或录音附件提交。');
  const text=await (await limited(req,90000)).text();
  try{return {data:JSON.parse(text)}}catch{fail(400,'提交格式无效。');}
}
async function record(db,school,caseId) {
  const row=await db.prepare('SELECT * FROM clinic_cases WHERE school=? AND id=?').bind(school,id(caseId)).first();
  if (!row) fail(404,'找不到这份互助记录。');
  return row;
}
function participant(row,visit,me){return row.owner===me||row.helper===me||(visit && visit.mentor===me);}
async function visitFor(db,caseId){return db.prepare("SELECT v.*,s.mentor_name,s.focus,p.place FROM clinic_visits v JOIN clinic_slots s ON s.id=v.slot_id LEFT JOIN clinic_slot_places p ON p.slot_id=s.id WHERE v.case_id=? AND v.state<>'cancelled'").bind(caseId).first();}
function requireChanges(res){if(!res.meta?.changes)fail(409,'这份记录已更新，请刷新后再试。');}
async function attachment(env,blob){
 if(!blob)return null;
 const key='clinic-audio/'+crypto.randomUUID();await env.BUCKET.put(key,blob);return {key,mime:blob.type};
}
function publicRow(row,visit,me) {
 const mine=row.owner===me,helper=row.helper===me,mentor=visit?.mentor===me;
 return {id:row.id,subject:row.subject,title:row.title,sourceId:row.source_id,issues:JSON.parse(row.issues),note:row.note,
   private:row.visibility==='private',mine,helper,mentor,visitState:(mine||mentor)?visit?.state||null:null,ownerName:row.owner_name,helperName:row.helper_name,claimed:Boolean(row.helper),
   replied:Boolean(row.reply),revised:Boolean(row.revised),resolved:Boolean(row.resolved),created:row.created,updated:row.updated};
}
function visitDetail(visit,canSeePlace){
 return visit?{id:visit.id,mentorName:visit.mentor_name,start:visit.start,state:visit.state,
   issues:JSON.parse(visit.issues),advice:visit.advice,focus:visit.focus,place:canSeePlace?visit.place||'在本预约单内留言指导':null}:null;
}
async function perform(req,env,me) {
 const url=new URL(req.url),path=url.pathname.slice('/api/clinic/'.length),db=env.DB,now=Date.now();
 const action=req.method==='POST';
 if(!action && req.method!=='GET') fail(405,'不支持此操作。');
 if(action && req.headers.get('Origin')!==url.origin)fail(403,'请从本站提交。');
 if(path==='board'&&!action) {
   const rows=(await db.prepare("SELECT c.*,v.state AS visit_state,v.mentor AS visit_mentor FROM clinic_cases c LEFT JOIN clinic_visits v ON v.case_id=c.id AND v.state<>'cancelled' WHERE c.school=? AND (c.visibility='school' OR c.owner=? OR v.mentor=?) ORDER BY c.updated DESC LIMIT 200").bind(me.school,me.id,me.id).all()).results;
   return json({rows:rows.map(row=>publicRow(row,{state:row.visit_state,mentor:row.visit_mentor},me.id))});
 }
 if(path==='slots'&&!action){
   const rows=(await db.prepare("SELECT s.*,v.id AS booking,v.learner,v.case_id,v.state FROM clinic_slots s LEFT JOIN clinic_visits v ON s.id=v.slot_id AND v.state<>'cancelled' WHERE s.school=? AND ((s.start>? AND v.id IS NULL) OR (s.mentor=? OR v.learner=?) AND s.start>?) ORDER BY s.start LIMIT 500").bind(me.school,now,me.id,me.id,now-30*86400000).all()).results;
   return json({slots:rows.map(s=>({id:s.id,subject:s.subject,focus:s.focus,mentorName:s.mentor_name,start:s.start,mine:s.mentor===me.id,caseId:s.case_id,state:s.state})),strong:me.strong});
 }
 const {data={},audio}=action?await input(req):{};
 if(action && (!data||typeof data!=='object'))fail(400,'提交内容无效。');
 if(path==='slots'&&action){
   const s=subject(data.subject),start=Number(data.start);
   if(s!=='speaking')fail(400,'请为口语诊所开放口语指导时段。');
   if(!me.strong?.includes(s))fail(400,'请先在校园资料中将该科目列为擅长科目。');
   if(!Number.isSafeInteger(start)||start<=now||start>now+60*86400000||start%quarter)fail(400,'请选择未来 60 天内的整刻钟时段。');
   const field=string(data.focus,70),slotId=crypto.randomUUID(),place=string(data.place||'在本预约单内留言指导',180);
   await db.batch([db.prepare('INSERT INTO clinic_slots(id,school,mentor,mentor_name,subject,focus,start) VALUES(?,?,?,?,?,?,?)').bind(slotId,me.school,me.id,me.nickname,s,field,start),
     db.prepare('INSERT INTO clinic_slot_places(slot_id,place) VALUES(?,?)').bind(slotId,place)]);
   return json({ok:true},201);
 }
 if(path==='withdraw'&&action){
   const slotId=id(data.slotId);
   const result=await db.batch([db.prepare("DELETE FROM clinic_visits WHERE slot_id=? AND mentor=? AND state='cancelled'").bind(slotId,me.id),
     db.prepare("DELETE FROM clinic_slots WHERE id=? AND mentor=? AND NOT EXISTS(SELECT 1 FROM clinic_visits WHERE slot_id=clinic_slots.id)").bind(slotId,me.id)]);
   if(!result[1].meta?.changes)fail(409,'已被预约的时段不能撤下。');return json({ok:true});
 }
 if(path==='create'&&action){
   const caseId=id(data.id),s=subject(data.subject),source=string(data.sourceId,150),title=string(data.title,210),prompt=string(data.prompt,5000),before=string(data.original||'',10000,false),problem=JSON.stringify(issues(data.issues)),note=string(data.note||'',1000,false);
   if(audio && s!=='speaking')fail(400,'录音仅用于口语。');
   const existing=await db.prepare('SELECT owner FROM clinic_cases WHERE id=?').bind(caseId).first();
   if(existing?.owner===me.id)return json({id:caseId});if(existing)fail(409,'请重新提交。');
   if(data.private===true&&(s!=='speaking'||!audio))fail(400,'口语诊所需要附上练前录音。');
   const attached=await attachment(env,audio);
   try{await db.prepare('INSERT INTO clinic_cases(id,school,owner,owner_name,visibility,subject,source_id,title,prompt,original,issues,note,attachment,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(caseId,me.school,me.id,me.nickname,data.private===true?'private':'school',s,source,title,prompt,before,problem,note,attached?JSON.stringify(attached):null,now,now).run();}
   catch(error){if(attached)await env.BUCKET.delete(attached.key);throw error;}
   return json({id:caseId},201);
 }
 if(!['case','audio','claim','reply','book','cancel','advice','revise','resolve'].includes(path))fail(404,'找不到此入口。');
 const row=await record(db,me.school,action?data.id:url.searchParams.get('id')),visit=await visitFor(db,row.id);
 const mine=me.id===row.owner,access=participant(row,visit,me.id);
 if(!access&&row.visibility!=='school')fail(404,'找不到这份互助记录。');
 const revised=row.revised?JSON.parse(row.revised):null;
 if(path==='audio'&&!action){
   if(!access)fail(403,'认领或预约后可以回听该录音。');
   const att=url.searchParams.get('take')==='after'?revised?.attachment:row.attachment?JSON.parse(row.attachment):null;
   if(!att)fail(404,'没有这段录音。');const object=await env.BUCKET.get(att.key);if(!object)fail(404,'录音暂不可用。');
   return new Response(object.body,{headers:{'Content-Type':att.mime,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='case'&&!action){
   return json({...publicRow(row,visit,me.id),prompt:row.prompt,original:access?row.original:null,hasAudio:Boolean(row.attachment),reply:access?row.reply:null,
    after:access&&revised?{text:revised.text,hasAudio:Boolean(revised.attachment),at:revised.at}:null,
    visit:access?visitDetail(visit,mine||visit?.mentor===me.id):null});
 }
 if(!action)fail(405,'请使用 POST 提交。');
 if(path==='resolve'&&mine){
   if(visit?.state==='booked')fail(409,'还有一场诊所预约。请先完成指导或取消预约。');
   requireChanges(await db.prepare('UPDATE clinic_cases SET resolved=1,updated=CASE WHEN resolved=0 THEN ? ELSE updated END WHERE id=? AND revised IS NOT NULL').bind(now,row.id).run());
   if(row.helper&&row.reply)await awardHelp(env,row.helper,row.subject,'help:'+row.id,'互助单获解决');
   if(visit?.advice)await awardHelp(env,visit.mentor,row.subject,'clinic:'+visit.id,'诊所指导后完成复练');
   return json({ok:true});
 }
 if(path==='reply' && row.helper===me.id){
   const text=string(data.text,2500);
   const write=await db.prepare('UPDATE clinic_cases SET reply=?,updated=? WHERE id=? AND helper=? AND reply IS NULL AND resolved=0 AND revised IS NULL').bind(text,now,row.id,me.id).run();
   if(!write.meta?.changes){
     const current=await db.prepare('SELECT reply FROM clinic_cases WHERE id=? AND helper=?').bind(row.id,me.id).first();
     if(current?.reply!==text)fail(409,'这份互助单已更新，请查看最新回复。');
   }
   return json({ok:true});
 }
 if(path==='advice' && visit?.mentor===me.id){
   const text=string(data.text,2500);
   const write=await db.prepare("UPDATE clinic_visits SET advice=?,state='consulted' WHERE id=? AND mentor=? AND state='booked' AND advice IS NULL AND EXISTS(SELECT 1 FROM clinic_cases c WHERE c.id=clinic_visits.case_id AND c.revised IS NULL AND c.resolved=0)").bind(text,visit.id,me.id).run();
   if(!write.meta?.changes){
     const current=await db.prepare("SELECT advice FROM clinic_visits WHERE id=? AND mentor=? AND state='consulted'").bind(visit.id,me.id).first();
     if(current?.advice!==text)fail(409,'这场预约已更新，请查看最新建议。');
   }
   return json({ok:true});
 }
 if(row.resolved)fail(409,'此记录已经解决。');
 if(path==='claim'&&!mine&&row.visibility==='school'){
   requireChanges(await db.prepare('UPDATE clinic_cases SET helper=?,helper_name=?,updated=? WHERE id=? AND resolved=0 AND revised IS NULL AND (helper IS NULL OR helper=?)').bind(me.id,me.nickname,now,row.id,me.id).run());
 }else if(path==='book'&&mine){
   if(row.subject!=='speaking')fail(400,'诊所预约限口语作答。');
   const picked=issues(data.issues);if(picked.some(i=>!JSON.parse(row.issues).includes(i)))fail(400,'请选择此记录已有的问题。');
   const slotId=id(data.slotId);
   const visitId=crypto.randomUUID();
   const book=db.prepare("INSERT INTO clinic_visits(id,case_id,slot_id,learner,mentor,start,issues,created) SELECT ?,c.id,s.id,c.owner,s.mentor,s.start,?,? FROM clinic_slots s JOIN clinic_cases c ON c.id=? WHERE s.id=? AND s.school=c.school AND s.subject=c.subject AND s.mentor<>c.owner AND c.resolved=0 AND c.revised IS NULL AND s.start>?").bind(visitId,JSON.stringify(picked),now,row.id,slotId,now);
   let result;
   if(me.school.startsWith('szu-showcase-')){
     const seededPrefix=me.id+'_demo_';
     const tip=db.prepare(`UPDATE clinic_visits SET state='consulted',advice=(
       SELECT '演示学伴建议 · ' || s.focus || char(10) ||
         CASE WHEN s.focus LIKE '%重音%' OR s.focus LIKE '%发音%' THEN '先标出一句里的两个关键词，慢读一次，停顿后用自然语速重新回答。回听两次，比较关键词是否更容易听清。'
              WHEN s.focus LIKE '%语法%' OR s.focus LIKE '%用词%' THEN '挑一个句子，先确认动作发生的时间，再用两个短句重说。回听时留意动词的时态。'
              ELSE '在观点后加一个具体场景，说清何时、何地、发生了什么。重新录一遍，比较前后两次能听到的细节。' END
       FROM clinic_slots s WHERE s.id=clinic_visits.slot_id
     ) WHERE id=? AND substr(mentor,1,length(?))=?`).bind(visitId,seededPrefix,seededPrefix);
     [result]=await db.batch([book,tip]);
   }else result=await book.run();
   requireChanges(result);
   return json({ok:true,visit:visitDetail(await visitFor(db,row.id),true)});
 }else if(path==='cancel'&&visit&&(mine||visit.mentor===me.id)){
   requireChanges(await db.prepare("UPDATE clinic_visits SET state='cancelled' WHERE id=? AND state='booked'").bind(visit.id).run());
 }else if(path==='revise'&&mine){
   const text=string(data.text||'',10000,false);if(!text&&!audio)fail(400,'请先完成同题复练作答。');
   if(visit?.state==='booked')fail(409,'预约进行中，请先完成指导或取消预约。');
   if(!row.reply&&!visit?.advice)fail(409,'收到同伴解答或诊所建议后可复练。');
   if(row.subject==='speaking'&&!audio)fail(400,'请录制同题作答或附上音频。');
   if(audio&&row.subject!=='speaking')fail(400,'录音仅用于口语。');
   const attached=await attachment(env,audio);
   try{requireChanges(await db.prepare("UPDATE clinic_cases SET revised=?,updated=? WHERE id=? AND resolved=0 AND revised IS NULL AND NOT EXISTS(SELECT 1 FROM clinic_visits v WHERE v.case_id=clinic_cases.id AND v.state='booked')").bind(JSON.stringify({text,attachment:attached,at:now}),now,row.id).run());}
   catch(error){if(attached)await env.BUCKET.delete(attached.key);throw error;}
 }else fail(403,'当前身份不能执行此操作。');
 return json({ok:true});
}
export async function handleClinic(request,env){
 try{const actor=await requireMember(request,env);return await perform(request,env,actor);}
 catch(error){const message=String(error?.message||'');
   if(error?.status>=400&&error.status<500)return json({error:message},error.status);
   if(/unique constraint|clinic time busy|constraint failed/i.test(message))return json({error:'该时间已被占用或已有预约，请刷新后选择其他时段。'},409);
   return json({error:'诊所服务暂不可用，请稍后重试。'},503);
 }
}
