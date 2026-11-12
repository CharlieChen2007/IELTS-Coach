import {schoolOf,prepareSchool} from './showcase.mjs';
import {skills,fail,participant,publicMember,requireMember} from './identity.mjs';
import {bank} from './answer-bank.mjs';
import {buddyMeet} from './buddy-meets.mjs';
import {readPlaza,changePlaza} from './buddy.mjs';
import {judge} from '../listening/core/grade.js';
import {campusGrowth} from './growth.mjs';

const day = 86400000;
const slots = ['一','二','三','四','五','六','日'].flatMap(d=>['上午','下午','晚间'].map(t=>'周'+d+t));
const kinds = ['宿舍队','班级队','学院代表队'];
const practiceNames = {speaking:'口语复练',reading:'阅读定位',listening:'听力纠错',writing:'作文修改'};
const respond = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql = (db,statement,...args) => db.prepare(statement).bind(...args);
const list = async (db,statement,...args) => (await sql(db,statement,...args).all()).results;
const clean = (v,max=3000) => typeof v==='string' && v.length<=max ? v.trim() : '';
const norm = v => clean(v,10000).toLowerCase().replace(/[^\p{L}\d]+/gu,' ').trim();
const answerText = v => norm(v).replace(/^45$/,'forty five');
function weekStart(time=Date.now()) {
  const local = new Date(time + 8*3600000);
  return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(local.getUTCDay()+6)%7)-8*3600000;
}
function choices(value, allowed) {
  if(value===undefined) return null;
  if (!Array.isArray(value) || value.length>allowed.length || value.some(s=>!allowed.includes(s))) fail('请选择列表中的有效选项。');
  return JSON.stringify([...new Set(value)]);
}
function band(value) {
  if(value===undefined) return null;
  if(value===null) return 0;
  if(typeof value!=='number' || !Number.isInteger(value*2) || value<1 || value>9) fail('水平与目标分必须为 1–9 之间的整分或半分。');
  return value;
}
async function profile(db,id,body,school) {
  const nickname=clean(body.nickname,24);
  if(!nickname) fail('请填写校园昵称。');
  // Older databases require numeric bands. Zero represents an unset band in storage only.
  await sql(db,`INSERT INTO social_members(id,school,nickname,level,target,strong,need,slots,verified_at)
    VALUES(?1,?2,?3,COALESCE(?4,0),COALESCE(?5,0),COALESCE(?6,'[]'),COALESCE(?7,'[]'),COALESCE(?8,'[]'),?9)
    ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,level=COALESCE(?4,level),target=COALESCE(?5,target),
      strong=COALESCE(?6,strong),need=COALESCE(?7,need),slots=COALESCE(?8,slots)`,
    id,school,nickname,band(body.level),band(body.target),choices(body.strong,skills),choices(body.need,skills),choices(body.slots,slots),Date.now()).run();
  return {ok:true};
}
function board(rows,me) {
  let rank=0;
  const placed=rows.map((row,index)=>{
    if (!index || rows[index-1].points!==row.points) rank=index+1;
    return {name:row.name,points:row.points,rank,self:row.id===me};
  });
  return {rows:placed.slice(0,60),self:placed.find(v=>v.self)||null};
}
async function ranking(db,member,subject) {
  const school=member.school;
  const start=weekStart(), filter=skills.includes(subject) ? subject : '';
  const rows=await list(db,"SELECT m.id,m.nickname name,SUM(p.points) points FROM social_members m JOIN social_points p ON p.member=m.id AND p.created>=? WHERE m.school=? AND (?='' OR p.subject=?) GROUP BY m.id ORDER BY points DESC,name,m.id",start,school,filter,filter);
  return {...board(rows,member.id),start};
}
async function partners(db,me,mode) {
  const school=me.school;
  const people=await list(db,'SELECT * FROM social_members WHERE school=? AND id<>?',school,me.id);
  const invites=await list(db,'SELECT i.*,m.nickname name FROM social_invites i JOIN social_members m ON m.id=CASE WHEN i.a=? THEN i.b ELSE i.a END WHERE i.a=? OR i.b=? ORDER BY i.created DESC',me.id,me.id,me.id);
  const taken = new Set(invites.filter(inv=>inv.status!=='declined').map(i=>i.a===me.id?i.b:i.a));
  const items=[];
  for(const row of people){
    if(taken.has(row.id)) continue;
    const p=publicMember(row),common=p.slots.filter(s=>me.slots.includes(s)),offers=p.strong.filter(s=>me.need.includes(s)),seeks=p.need.filter(s=>me.strong.includes(s));
    const gap=me.level && p.level ? Math.abs(me.level-p.level) : null;
    const targetGap=me.target && p.target ? Math.abs(me.target-p.target) : null;
    if(!common.length || (mode==='complement' ? !(offers.length||seeks.length) : gap===null || gap>1)) continue;
    const goalBonus=targetGap===null ? 0 : 1/(1+targetGap);
    items.push({...p,common,offers,seeks,gap,targetGap,order:4*common.length+2*(offers.length+seeks.length)+goalBonus+(gap===null?0:1/(1+gap))});
  }
  items.sort((a,b)=>b.order-a.order||a.nickname.localeCompare(b.nickname));
  return {items:items.slice(0,30),invites:invites.map(i=>({other:i.a===me.id?i.b:i.a,name:i.name,incoming:i.sender!==me.id,status:i.status}))};
}
async function invite(db,me,body) {
  const school=me.school;
  const other=clean(body.other,80),peer=await sql(db,'SELECT 1 FROM social_members WHERE id=? AND school=?',other,school).first();
  if(!peer||other===me.id) fail('请选择本校其他成员。');
  const [a,b]=[me.id,other].sort(), now=Date.now();
  if(body.action==='send') {
    await sql(db,"INSERT INTO social_invites(a,b,sender,status,created) VALUES(?,?,?,'pending',?) ON CONFLICT(a,b) DO UPDATE SET sender=excluded.sender,status='pending',created=excluded.created WHERE social_invites.status='declined' AND social_invites.created<?",a,b,me.id,now,now-day).run();
  } else if(['accept','decline'].includes(body.action)) {
    const result=await sql(db,"UPDATE social_invites SET status=?,created=? WHERE a=? AND b=? AND sender<>? AND status='pending'",body.action==='accept'?'accepted':'declined',now,a,b,me.id).run();
    if(!result.meta.changes) fail('邀请状态已变化，请刷新。',409);
  } else fail('未知邀请操作。');
  return {ok:true};
}
async function squad(db,me,body) {
  const school=me.school;
  const now=Date.now(), existing=await sql(db,'SELECT team FROM social_roster WHERE member=?',me.id).first();
  if(body.action==='leave'){
    await sql(db,'DELETE FROM social_roster WHERE member=? AND team=?',me.id,clean(body.code,20)).run();
    return {ok:true};
  }
  const code=clean(body.code,20).toUpperCase();
  if(existing && (body.action!=='join'||code!==existing.team)) fail('你已经加入四人队，退出后可加入另一队。',409);
  if(body.action==='create'){
    const name=clean(body.name,24);
    if(!name || !kinds.includes(body.kind)) fail('请填写队名并选择队伍类型。');
    const id=crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
    await db.batch([sql(db,'INSERT INTO social_squads VALUES(?,?,?,?,?)',id,school,name,body.kind,now),sql(db,'INSERT INTO social_roster VALUES(?,?,?)',me.id,id,now)]);
  } else if(body.action==='join'){
    const res=await sql(db,'INSERT OR IGNORE INTO social_roster(member,team,joined) SELECT ?,id,? FROM social_squads WHERE school=? AND id=? AND (SELECT COUNT(*) FROM social_roster WHERE team=id)<4',me.id,now,school,code).run();
    if(!res.meta.changes && existing?.team!==code) fail('邀请码无效或队伍已满。',409);
  } else fail('未知组队操作。');
  return {ok:true};
}
async function squads(db,me) {
  const school=me.school;
  const week=weekStart();
  const rows=await list(db,`SELECT t.id,t.name,t.kind,m.id member,m.nickname,p.subject FROM social_squads t
    JOIN social_roster r ON r.team=t.id JOIN social_members m ON m.id=r.member
    LEFT JOIN social_points p ON p.member=m.id AND p.created>=? AND p.created>=r.joined AND p.category='practice'
    WHERE t.school=? GROUP BY t.id,m.id,p.subject ORDER BY t.created,m.nickname`,week,school);
  const teams=new Map();
  for(const row of rows){
    if(!teams.has(row.id)) teams.set(row.id,{id:row.id,name:row.name,kind:row.kind,members:new Map(),points:0});
    const team=teams.get(row.id);
    if(!team.members.has(row.member)) team.members.set(row.member,{name:row.nickname,self:me.id===row.member,skills:[]});
    if(row.subject){team.members.get(row.member).skills.push(row.subject);team.points++;}
  }
  const all=[...teams.values()].map(t=>({...t,members:[...t.members.values()]}));
  const mine=all.find(t=>t.members.some(m=>m.self))||null;
  const eligible=all.filter(t=>t.members.length===4).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
  return {mine,leaderboard:board(eligible,mine?.id),week};
}
const retryId = /^[a-zA-Z0-9_-]{1,95}$/;
async function practiceState(db,me,subject,source,exercise) {
  if(!skills.includes(subject)||!/^rpt_[\w-]{1,166}$/.test(source)) fail('请从自己的练习报告发起。');
  const perQuestion=subject==='reading'||subject==='listening';
  if(perQuestion&&!/^[\w-]{1,80}$/.test(exercise)) fail('未找到这项练习。');
  const key=perQuestion?subject+':'+exercise+':':(subject==='speaking'?'oral':subject)+':'+source;
  const condition=perQuestion?'p.event>=? AND p.event<?':'p.event=?';
  const args=perQuestion?[key,key+'\uffff']:[key];
  const entries=await list(db,`SELECT p.event,e.before_text,e.after_text,e.reason FROM social_points p
    LEFT JOIN social_evidence e ON e.member=p.member AND e.event=p.event
    WHERE p.member=? AND p.subject=? AND p.category='practice' AND ${condition}`,me.id,subject,...args);
  return {completed:entries.map(row=>({selection:perQuestion?row.event.slice(key.length):subject,
    before:row.before_text||'',after:row.after_text||'',reason:row.reason||''}))};
}
async function practice(db,me,b) {
  const q=clean(b.questionId,80), source=clean(b.sourceId,170),subject=b.subject,now=Date.now();
  if(!skills.includes(subject)||!/^rpt_[\w-]+$/.test(source)) fail('请从自己的练习报告发起。');
  const before=clean(b.before,10000),after=clean(b.after,10000),reason=clean(b.reason,400);
  let event;
  if(subject==='speaking'){
    if(b.action==='start'){
      await sql(db,'INSERT OR IGNORE INTO social_oral_retry(member,source,started) VALUES(?,?,?)',me.id,source,now).run();
      return {ok:true};
    }
    const task=clean(b.sessionId,95);
    if(!retryId.test(task)) fail('先完成复练并交卷。');
    const updated=await sql(db,`UPDATE social_oral_retry SET completed=? WHERE member=? AND source=? AND (completed IS NULL OR completed=?) AND EXISTS
      (SELECT 1 FROM campus_solo_sessions s WHERE s.user_id=? AND s.task_id=? AND s.kind='exam' AND s.started_at>=social_oral_retry.started AND s.finished_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM social_oral_retry o WHERE o.member=? AND o.completed=? AND o.source<>?)`,task,me.id,source,task,me.id,task,me.id,task,source).run();
    if(!updated.meta.changes) fail('尚未查到本次录音模考交卷记录，请稍后重试。',409);
    event='oral:'+source;
  } else if(subject==='listening' && /^prac_lsn_s[1-4]$/.test(b.exerciseId)){
    const id=source.startsWith('rpt_li_') ? source.slice(7) : '';
    const saved=await sql(db,'SELECT snapshot FROM listening_attempts WHERE owner=? AND id=? AND practice=?',me.id,id,b.exerciseId).first();
    const item=saved && JSON.parse(saved.snapshot).items.find(item=>item.item_id===q);
    if(!item || item.status==='correct' || before!==String(item.user_answer||'').trim()) fail('请从本人已提交的听力报告中选一道错题。');
    const graded=judge({type:item.question_type,correct_answers:item.correct_answer,word_limit:item.word_limit},after);
    if(graded.status!=='correct') fail('请根据原声订正错题，并核对标准答案。');
    if(reason.length<4) fail('请补充具体原因，至少 4 个字。');
    event=subject+':'+b.exerciseId+':'+q;
  } else if(subject==='reading' && /^reading_[\w-]+$/.test(b.exerciseId)){
    const id=source.startsWith('rpt_rd_')?source.slice(7):'';
    const saved=await sql(db,'SELECT payload FROM reading_attempts WHERE owner_id=? AND id=? AND passage=?',me.id,id,b.exerciseId.slice(8)).first();
    const snapshot=saved&&JSON.parse(saved.payload),item=snapshot?.results.find(item=>item.questionId===q);
    if(!item||before!==String(item.response||'').trim())fail('请从本人已交卷的阅读报告发起。');
    const excerpt=norm(after),paragraph=snapshot.paragraphMap?.[item.explanation?.paragraph];
    const sources=paragraph?[paragraph]:[item.explanation?.quote||'',...snapshot.paragraphs];
    if(excerpt.length<15||!sources.some(text=>norm(text).includes(excerpt)))fail('请摘录与本题相关的连续原文依据，至少 15 个字符。');
    if(reason.length<4)fail('请说明原文如何支持判断，至少 4 个字。');
    event='reading:'+b.exerciseId+':'+q;
  } else if(subject==='listening'||subject==='reading') {
    const entry=bank[clean(b.exerciseId,70)];
    const correct=entry?.questions?.[q];
    if(entry?.subject!==subject || typeof correct!=='string' || !q) fail('此题尚未纳入校园专项。');
    if(subject==='listening'){
      if(answerText(before)===answerText(correct) || answerText(after)!==answerText(correct)) fail('请根据原声订正错题，并核对标准答案。');
    } else {
      const anchors={q_re_1:0,q_re_2:0,q_re_3:1,q_re_4:1,q_re_5:2,q_re_6:2,q_re_7:3,q_re_8:3,q_re_10:3,q_rt_1:0,q_rt_3:1};
      const paragraphs=q in anchors?[entry.paragraphs[anchors[q]]]:entry.paragraphs;
      if(norm(after).length<15||!paragraphs.some(p=>norm(p).includes(norm(after)))) fail('请从与本题相关的原文段落摘录连续依据，至少 15 个字符。');
    }
    if(reason.length<4) fail('请补充具体原因，至少 4 个字。');
    event=subject+':'+b.exerciseId+':'+q;
  } else {
    const words = value=>norm(value).split(' ').filter(Boolean);
    if(subject==='writing'&&/^writing_/.test(b.exerciseId)){
      const id=source.startsWith('rpt_wr_')?source.slice(7):'';
      const saved=await sql(db,'SELECT payload FROM writing_submissions WHERE owner_id=? AND id=?',me.id,id).first();
      const submission=saved&&JSON.parse(saved.payload);
      if(!submission||submission.status!=='done'||submission.isExample||!submission.text.split(/\n+/).some(p=>p.trim()===before))fail('请从本人已完成的写作报告选择原段落。');
    }
    if(!before || words(after).length<8 || !/[a-z]/i.test(before) || !/[a-z]/i.test(after) || reason.length<4) fail('请修改一段英文、保留至少 8 个词，并说明改动。');
    const remaining=words(before).slice();
    let added=0;
    for(const w of words(after)){const i=remaining.indexOf(w);if(i<0)added++;else remaining.splice(i,1);}
    if(added+remaining.length<3) fail('请实质调整表达，至少改动三个词。');
    event='writing:'+source;
  }
  const start=Math.floor((now+8*3600000)/day)*day-8*3600000;
  const [award] = await db.batch([sql(db,`INSERT OR IGNORE INTO social_points(member,subject,event,label,points,category,created)
    SELECT ?,?,?,?,5,'practice',? WHERE (SELECT COUNT(*) FROM social_points WHERE member=? AND subject=? AND created>=? AND category='practice')<5`,
    me.id,subject,event,practiceNames[subject],now,me.id,subject,start),sql(db,`INSERT OR IGNORE INTO social_evidence(member,event,report,question,before_text,after_text,reason)
    SELECT member,event,?,?,?,?,? FROM social_points WHERE member=? AND event=?`,source,q,before.slice(0,3000),after.slice(0,3000),reason,me.id,event)]);
  const evidence=await sql(db,`SELECT e.before_text AS before,e.after_text AS after,e.reason FROM social_points p
    LEFT JOIN social_evidence e ON e.member=p.member AND e.event=p.event WHERE p.member=? AND p.event=?`,me.id,event).first();
  if(!evidence) fail('该科今天的五次积分已记满。',409);
  return {ok:true,event,evidence,awardedPoints:award.meta.changes > 0 ? 5 : 0,awardLabel:practiceNames[subject]};
}
async function read(request){
  if(!request.headers.get('Content-Type')?.includes('application/json')) fail('需要 JSON。',415);
  const reader=request.body?.getReader(); if(!reader) fail('请求内容为空。');
  const decoder=new TextDecoder(); let text='',length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>35000){await reader.cancel();fail('内容过长。',413);}text+=decoder.decode(value,{stream:true});}
  let object;try{object=JSON.parse(text+decoder.decode());}catch{fail('请求格式无效。');}
  if(!object||typeof object!=='object'||Array.isArray(object)) fail('请求格式无效。');return object;
}
export async function handleSocial(request,env) {
  try{
    const url=new URL(request.url), route=url.pathname.slice('/api/social/'.length), db=env.DB,write=request.method==='POST';
    if(!write && request.method!=='GET') fail('不支持此方法。',405);
    if(write && (request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')) fail('请从本站提交。',403);
    if(route==='me'&&!write){const id=await participant(request,env),school=schoolOf(request,id);await prepareSchool(db,school,id,url.searchParams.get('targetBand'));return respond({school,profile:publicMember(await sql(db,'SELECT * FROM social_members WHERE id=? AND school=?',id,school).first())});}
    if(route==='profile'&&write) {
      const id=await participant(request,env),school=schoolOf(request,id);
      await prepareSchool(db,school,id);
      return respond(await profile(db,id,await read(request),school));
    }
    if(route==='plaza'){
      const id=await participant(request,env);
      const school=schoolOf(request,id);
      await prepareSchool(db,school,id);
      return respond(write ? await changePlaza(db,id,await read(request),school) : await readPlaza(db,id,school));
    }
    if(route==='growth'||route==='exam'){
      const id=await participant(request,env),school=schoolOf(request,id);
      await prepareSchool(db,school,id);
      const member=await sql(db,'SELECT nickname FROM social_members WHERE id=? AND school=?',id,school).first();
      const body=write?await read(request):null;
      if(write&&!member&&!(route==='growth'&&body.action==='practice')) fail('请先加入深圳大学校园。',403);
      return respond(await campusGrowth(db,{id,school,nickname:member?.nickname},route,body));
    }
    /* 四人周挑战是「有队伍就显示、没有就隐藏」的可选信息卡：科目页的演示账号
       还没加入校园时，不该让这个只读探测产生 4xx 网络错误。写操作仍要求成员。 */
    if(route==='challenge'&&!write){
      try{
        const member=await requireMember(request,env);
        return respond(await squads(db,member));
      }catch(e){
        if(e.status===401||e.status===403) return respond({mine:null,leaderboard:{rows:[],self:null},week:null});
        throw e;
      }
    }
    const me=await requireMember(request,env);
    if(route==='meet'){
      const body=write?await read(request):null;
      return respond(await buddyMeet(db,me,body?.other??url.searchParams.get('other'),body));
    }
    if(route==='points'&&!write) {
      const total=await sql(db,'SELECT COALESCE(SUM(points),0) AS total FROM social_points WHERE member=?',me.id).first();
      const entries=await list(db,'SELECT p.id,p.subject,p.event,p.label,p.category,p.points,p.created,e.report,e.reason FROM social_points p LEFT JOIN social_evidence e ON e.member=p.member AND e.event=p.event WHERE p.member=? AND p.id<? ORDER BY p.id DESC LIMIT 51',me.id,Math.min(Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER));
      return respond({...total,entries:entries.slice(0,50),next:entries.length>50?entries[49].id:null});
    }
    if(route==='rank'&&!write) return respond(await ranking(db,me,url.searchParams.get('subject')));
    if(route==='match'&&!write) return respond(await partners(db,me,url.searchParams.get('mode')));
    if(route==='invite'&&write) return respond(await invite(db,me,await read(request)));
    if(route==='challenge') return respond(await squad(db,me,await read(request)));
    if(route==='practice-state'&&!write) return respond(await practiceState(db,me,url.searchParams.get('subject'),url.searchParams.get('sourceId'),url.searchParams.get('exerciseId')));
    if(route==='practice'&&write) return respond(await practice(db,me,await read(request)));
    fail('未找到校园操作。',404);
  }catch(e){
    // A generic 503 hides real bugs from whoever runs the deployment; keep the
    // client message vague but leave the stack in the server log.
    if(!e.status) console.error('campus/social', new URL(request.url).pathname, e);
    return respond({error:e.status?e.message:'校园服务暂时不可用，请重试。'},e.status||503);
  }
}
