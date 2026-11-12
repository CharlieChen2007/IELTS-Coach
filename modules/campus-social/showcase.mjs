// Each showcase school belongs to a separately authenticated browser participant.
import {hasStudyWeek,seedStudyWeek} from './showcase-study.mjs';
const day = 86400000;
const skills = ['listening','speaking','reading','writing'];
const labels = ['听力错题回听','口语同题复练','阅读原文定位','作文段落改写'];
const teams = [
  {name:'荔园晚自习',kind:'宿舍队',names:[null,'陈予安','林一宁','苏沐'],marks:[5,11,6,13]},
  {name:'南区阅览室',kind:'班级队',names:['梁乐遥','吴桐','宋子涵','方驰'],marks:[15,13,15,7]},
  {name:'粤海晨读组',kind:'学院代表队',names:['罗知行','许楠','唐思源','顾云舒'],marks:[7,11,13,12]},
  {name:'周四四人行',kind:'宿舍队',names:['杨昕','叶澈','谢予文','张可'],marks:[3,10,5,8]},
];
export function schoolOf(request,id) {
  return request.headers.get('X-Speaking-Scope')?.startsWith('showcase_') ? 'szu-showcase-'+id : 'szu';
}
export async function prepareSchool(db, tenant, owner, targetBand) {
  if (!tenant.startsWith('szu-showcase-')) return;
  const personalTarget=Number(targetBand);
  const target=Number.isInteger(personalTarget*2)&&personalTarget>=1&&personalTarget<=9?personalTarget:7;
  const now=Date.now(), local=new Date(now+8*3600000);
  const week=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(local.getUTCDay()+6)%7)-8*3600000;
  const anchor='showcase-week-'+week;
  const [socialReady,studyReady]=await Promise.all([
    db.prepare('SELECT id FROM social_points WHERE member=? AND event=?').bind(owner,anchor).first(),
    hasStudyWeek(db,owner,week),
  ]);
  if(socialReady && studyReady) return;
  const original=await db.prepare('SELECT nickname FROM campus_profiles WHERE user_id=?').bind(owner).first();
  if (!original) return;
  const first=!(await db.prepare('SELECT id FROM social_members WHERE id=?').bind(owner).first());
  const statements=[];
  const statement=(query,...args)=>statements.push(db.prepare(query).bind(...args));
  if(!studyReady) seedStudyWeek(statement,owner,original.nickname,week,now,teams[0],target);
  if(socialReady){await db.batch(statements);return;}
  const seatTime=week-day;
  const span=Math.max(0,now-week-1);
  const moment=index=>week+Math.floor(span*(index+1)/20);
  for(const [t,team] of teams.entries()) {
    const teamId=owner.slice(-11).toUpperCase()+t;
    if(first) statement('INSERT OR IGNORE INTO social_squads(id,school,name,kind,created) VALUES(?,?,?,?,?)',teamId,tenant,team.name,team.kind,seatTime);
    for(const [m,name] of team.names.entries()) {
      const self=name===null, id=self?owner:owner+'_demo_'+t+m;
      if(first){
        statement('INSERT OR IGNORE INTO social_members(id,school,nickname,level,target,strong,need,slots,verified_at) VALUES(?,?,?,?,?,?,?,?,?)',
          id,tenant,name??original.nickname,6,self?target:7,'["listening","reading"]','["speaking","writing"]','["周二晚间","周四晚间","周六下午"]',seatTime);
        statement('INSERT OR IGNORE INTO social_roster(member,team,joined) VALUES(?,?,?)',id,teamId,seatTime);
      }
      for(const [s,skill] of skills.entries()){
        if(team.marks[m] & (1<<s)) statement('INSERT OR IGNORE INTO social_points(member,subject,event,label,points,category,created) VALUES(?,?,?,?,5,?,?)',
          id,skill,anchor+'-'+s,labels[s],'practice',moment(t+m+s+2));
      }
      if(self || (m+t)%2===0) statement('INSERT OR IGNORE INTO social_points(member,subject,event,label,points,category,created) VALUES(?,?,?,?,5,?,?)',
        id,'speaking',anchor,'互助单获解决','help',moment(t+m+10));
    }
  }
  if(first){
    const addCase=(tag,subject,author,authorName,title,prompt,original,issue,note,helper,helperName,reply,when)=>{
      statement(`INSERT OR IGNORE INTO clinic_cases(id,school,owner,owner_name,visibility,subject,source_id,title,prompt,original,issues,note,helper,helper_name,reply,created,updated)
        VALUES(?,?,?,?,'school',?,?,?,?,?,?,?,?,?,?,?,?)`, owner.slice(-24)+'-'+tag,tenant,author,authorName,subject,'demo-'+tag,title,prompt,original,JSON.stringify([issue]),note,helper,helperName,reply,when,when);
    };
    addCase('read-evidence','reading',owner,original.nickname,'题干里的 only 能从原文推出吗？',
      'Passage: Some students use the library after class. Statement: Only students use the library after class.',
      'True','判断依据','我看到了 students，却不确定 only 能否成立。',owner+'_demo_02','林一宁',
      '原文说明有学生会用图书馆，没有说明其他人能不能用。请再判断题干里的 only。',moment(11));
    addCase('listen-change','listening',owner+'_demo_01','陈予安','改期后的时间，该记前一个还是后一个？',
      'The workshop was set for Tuesday, but the new booking is for Thursday. Which day is the workshop?',
      'Tuesday','定位信息','听到了两个日期，想找出表示改期的词。',owner,original.nickname,null,moment(13));
  }
  const today=Math.floor((now+8*3600000)/day)*day-8*3600000;
  const clinics=[
    {seat:'01',mentor:'陈予安',focus:'回答展开',offset:1,hour:19},
    {seat:'12',mentor:'宋子涵',focus:'发音与重音',offset:3,hour:14},
    {seat:'20',mentor:'罗知行',focus:'语法和用词',offset:7,hour:10},
  ];
  for(const clinic of clinics){
    const slotId=owner.slice(-20)+'-'+week+'-'+clinic.seat;
    statement('INSERT OR IGNORE INTO clinic_slots(id,school,mentor,mentor_name,subject,focus,start) VALUES(?,?,?,?,?,?,?)',
      slotId,tenant,owner+'_demo_'+clinic.seat,clinic.mentor,'speaking',clinic.focus,today+clinic.offset*day+clinic.hour*3600000);
  }
  await db.batch(statements);
}
