import {fail} from './identity.mjs';
import {bank} from './answer-bank.mjs';

const foods={biscuit:[2,1],can:[6,3],sashimi:[12,6]};
const fields=['building','headset','examiner','waitingRoom','printShop'];
const day=86400000;
const nowDay=(stamp)=>new Date(stamp+8*3600000).toISOString().slice(0,10);
const statement=(db,query,...args)=>db.prepare(query).bind(...args);
const rows=async(db,query,...args)=>(await statement(db,query,...args).all()).results;
const first=async(db,query,...args)=>statement(db,query,...args).first();
const validText=(x,max)=>typeof x==='string'&&x.trim()&&x.trim().length<=max;
const key=(id)=>typeof id==='string' && /^[a-zA-Z0-9_:.~-]{1,160}$/.test(id);
const demo=(school)=>school.startsWith('szu-showcase-');
const examples=[
  ['陈思禾',7,42,'听到改口时，记下改动后的信息','我把两次出现的数字并排写下，在 but、actually 之后停下来核对。连续复盘五段录音以后，我开始能听出说话者在哪一句修正了信息。'],
  ['江芮',7.5,56,'阅读定位先画主语，再看限制词','做判断题时，我把题干和原文的主语、范围词分两栏抄下。每次只比较一个条件，复练时就能说出错在范围还是结论。'],
  ['许念',6.5,35,'录两次同一道口语题，中间只改一个细节','第一遍说完，我会找出最笼统的一句。第二遍补上地点或一个具体动作，回听时更容易发现表达哪里变清楚了。']
];
const archiveExample=['示范教学楼二层，考前请以准考证为准','现场先试听，音量异常可向监考员说明','准备一个具体例子，应对 Part 3 追问','进场安排以当天考务说明为准','考前可提前打印并准备备用份'];

async function prepareDemo(db,me) {
  if(!demo(me.school)) return;
  const origin='demo-camp',s=me.school,m=me.id;
  if(await first(db,'SELECT 1 FROM camp_growth_events WHERE school=? AND member=? AND event=?',s,m,'demo:starter'))return;
  const now=Date.now();
  const seed=(query,...args)=>statement(db,query,...args);
  const inserts=[
    seed("INSERT OR IGNORE INTO camp_growth_events VALUES(?,?,?,'practice',8,'showcase',?)",s,m,'demo:starter',now-day),
    seed("INSERT OR IGNORE INTO camp_growth_events VALUES(?,?,?,'feed',13,'showcase',?)",s,origin,'demo:shared-cat',now-day),
    ...fields.map((field,i)=>seed('INSERT OR IGNORE INTO camp_exam_fields VALUES(?,?,?,?,?)',s,field,archiveExample[i],origin,now-day)),
    seed('INSERT OR IGNORE INTO camp_exam_contributors VALUES(?,?)',s,origin)
  ];
  examples.forEach(([name,band,days,title,body],i)=>{
    inserts.push(seed('INSERT OR IGNORE INTO camp_stories VALUES(?,?,?,?,?,?,?,?,?)',s,'example-'+i,origin+i,name,band,days,title,body,now-(i+2)*day));
    for(let n=0;n<3-i;n++) inserts.push(seed('INSERT OR IGNORE INTO camp_story_likes VALUES(?,?,?)',s,'example-'+i,origin+n));
  });
  await db.batch(inserts);
}

function streaks(dates,today) {
  let streak=0,best=0,prev=0;
  for(const value of dates){
    const stamp=Date.parse(value);
    streak=stamp-prev===day?streak+1:1;
    best=Math.max(best,streak);
    prev=stamp;
  }
  return {lastLit:dates.at(-1)||'',streak:Date.parse(today)-prev<=day?streak:0,best};
}

// The listening section grader and solo/pair engine already persist immutable evidence.
async function importSessions(db,me){
  const q=(query,...args)=>statement(db,query,...args);
  const [s,m]=[me.school,me.id];
  const jobs=[
    q(`INSERT OR IGNORE INTO camp_growth_events
      SELECT ?1,?2,'listen:'||a.id,'practice',COUNT(*),'listening',CAST(strftime('%s',json_extract(snapshot,'$.report.finished_at')) AS INTEGER)*1000
      FROM listening_attempts a, json_each(a.snapshot,'$.items') j
      WHERE a.owner=?2 AND TRIM(COALESCE(json_extract(j.value,'$.user_answer'),''))<>'' GROUP BY a.id`,s,m),
    q(`INSERT INTO camp_growth_events SELECT ?1,?2,'drill:'||drill,'drill',total*revision,'listening',?3
      FROM listening_type_results WHERE owner=?2
      ON CONFLICT(school,member,event) DO UPDATE SET units=excluded.units,created=excluded.created WHERE excluded.units>camp_growth_events.units`,s,m,Date.now()),
    q(`INSERT OR IGNORE INTO camp_growth_events SELECT ?1,?2,'solo:'||s.task_id,'practice',COUNT(*),'speaking',s.finished_at
      FROM campus_solo_sessions s JOIN campus_solo_answers a ON a.user_id=s.user_id AND a.task_id=s.task_id
      WHERE s.user_id=?2 AND s.finished_at IS NOT NULL GROUP BY s.task_id`,s,m),
    q(`INSERT OR IGNORE INTO camp_growth_events SELECT ?1,?2,'pair:'||code,'practice',1,'speaking',completed_at
      FROM campus_speaking_pairs WHERE (host=?2 OR guest=?2) AND status='complete' AND completed_at IS NOT NULL`,s,m)
  ];
  const existing=await rows(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reading_attempts','writing_submissions')");
  if(existing.some(table=>table.name==='reading_attempts'))jobs.push(
    q(`INSERT OR IGNORE INTO camp_growth_events
      SELECT ?1,?2,'reading:'||a.id,'practice',COUNT(*),'reading',a.created_at
      FROM reading_attempts a,json_each(a.payload,'$.results') item
      WHERE a.owner_id=?2 AND COALESCE(json_extract(a.payload,'$.isExample'),0)=0 AND TRIM(COALESCE(json_extract(item.value,'$.response'),''))<>'' GROUP BY a.id`,s,m));
  if(existing.some(table=>table.name==='writing_submissions'))jobs.push(
    q(`INSERT OR IGNORE INTO camp_growth_events
      SELECT ?1,?2,'writing:'||id,'practice',1,'writing',created_at FROM writing_submissions
      WHERE owner_id=?2 AND json_extract(payload,'$.status')='done'
      AND COALESCE(json_extract(payload,'$.isExample'),0)=0
      AND TRIM(COALESCE(json_extract(payload,'$.text'),''))<>''`,s,m));
  await db.batch(jobs);
}

async function readGrowth(db,me){
  const [s,m]=[me.school,me.id],today=nowDay(Date.now());
  const [stats,days,invites,stock,archive,story]=await Promise.all([
    first(db,`SELECT COALESCE(SUM(CASE WHEN member=?2 AND kind IN ('practice','drill') THEN units END),0) questions,
      COALESCE(SUM(CASE WHEN member=?2 AND kind='exchange' THEN units END),0) spent,
      COALESCE(SUM(CASE WHEN kind='feed' THEN units END),0) fed,
      COUNT(CASE WHEN member=?2 AND kind='feed' THEN 1 END) personalFeeds,
      COUNT(CASE WHEN member=?2 AND kind='practice' AND item<>'showcase' AND strftime('%H',created/1000,'unixepoch','+8 hours')<'04' THEN 1 END) night,
      (SELECT COALESCE(SUM(p.points),0) FROM social_points p JOIN social_members m ON m.id=p.member WHERE m.school=?1) exp
      FROM camp_growth_events WHERE school=?1`,s,m),
    rows(db,"SELECT item FROM camp_growth_events WHERE school=? AND member=? AND kind='lamp' ORDER BY item",s,m),
    rows(db,"SELECT item FROM camp_growth_events WHERE school=? AND member=? AND kind='invite' ORDER BY created,rowid",s,m),
    rows(db,"SELECT item,SUM(CASE kind WHEN 'exchange' THEN 1 ELSE -1 END) amount FROM camp_growth_events WHERE school=? AND member=? AND kind IN ('feed','exchange') GROUP BY item",s,m),
    first(db,'SELECT 1 FROM camp_exam_contributors WHERE school=? AND member=?',s,m),
    first(db,'SELECT 1 FROM camp_stories WHERE school=? AND member=?',s,m)
  ]);
  const lamp=streaks(days.map(d=>d.item),today);
  let declines=0,best=0;
  for(const item of invites){declines=item.item==='declined'?declines+1:0;best=Math.max(best,declines)}
  const badges=Object.entries({night_owl:stats.night,reject_three:best>=3,lamp_seven:lamp.best>=7,
    first_story:story,archive_hero:archive,cat_friend:stats.personalFeeds>=20}).filter(([,on])=>Boolean(on)).map(([id])=>id);
  return {joined:!!me.nickname,today,lamp,badges,campExp:stats.exp,larder:Object.fromEntries(stock.map(r=>[r.item,r.amount])),
    pet:{name:'营地猫',fed:stats.fed,questionsDone:stats.questions,feed:Math.floor(stats.questions/2)-stats.spent}};
}

async function mutateGrowth(db,me,b){
  const [s,m]=[me.school,me.id],now=Date.now();
  const q=(query,...args)=>statement(db,query,...args);
  if(b.action==='practice'){
    if(!Array.isArray(b.attempts)||b.attempts.length>50)fail('无效的练习记录。');
    const inserts=b.attempts.map(a=>{
      if(!a||!key(a.id)||!a.id.startsWith('atm_')||!['listening','reading','writing','speaking'].includes(a.subject)
        ||!Number.isInteger(a.count)||a.count<1||a.count>({listening:40,reading:40,speaking:100,writing:1}[a.subject])
        ||!Number.isSafeInteger(a.at)||a.at<946684800000||a.at>now+60000)fail('练习证据无效。');
      let event='report:'+a.id;
      if(['reading','listening'].includes(a.subject)){
        const material=Object.hasOwn(bank,a.exercise)?bank[a.exercise]:null;
        if(material?.subject!==a.subject||!Array.isArray(a.questionIds)||a.questionIds.length!==a.count
          ||new Set(a.questionIds).size!==a.count||a.questionIds.some(id=>!Object.hasOwn(material.questions,id)))fail('作答题号与材料不一致。');
      }
      if(a.subject==='writing'&&!['exr_wr_task2_01','exr_wr_retake_01'].includes(a.exercise))fail('未找到写作练习。');
      if(a.subject==='speaking'){
        const parts=/^atm_sp_(exam|dialogue|pair)_([\w-]+)$/.exec(a.id);
        if(!parts)fail('口语练习编号无效。');
        event=(parts[1]==='pair'?'pair:':'solo:')+parts[2];
      }
      return q("INSERT OR IGNORE INTO camp_growth_events VALUES(?,?,?,'practice',?,?,?)",s,m,event,a.count,a.subject,a.at);
    });
    if(inserts.length)await db.batch(inserts);
    return;
  }
  if(b.action==='sample-invite'){
    if(!validText(b.peer,120)||!validText(b.eventId,160)||!['accepted','declined'].includes(b.decision))fail('邀请记录无效。');
    await q("INSERT OR IGNORE INTO camp_growth_events VALUES(?,?,?,'invite',0,?,?)",s,m,'sample:'+b.peer+':'+b.eventId,b.decision,now).run();
    return;
  }
  if(b.action==='lamp'){
    const today=nowDay(now);
    await q("INSERT OR IGNORE INTO camp_growth_events VALUES(?,?,?,'lamp',0,?,?)",s,m,'lamp:'+today,today,now).run();
    return;
  }
  if(!['feed','exchange'].includes(b.action)||!Object.hasOwn(foods,b.food)||!key(b.id))fail('无效的猫粮操作。');
  const [cost,value]=foods[b.food];
  const condition=b.action==='exchange'
    ? "COALESCE(SUM(CASE WHEN kind IN ('practice','drill') THEN units END),0)/2-COALESCE(SUM(CASE WHEN kind='exchange' THEN units END),0)>=?8"
    : "COALESCE(SUM(CASE WHEN item=?6 AND kind='exchange' THEN 1 WHEN item=?6 AND kind='feed' THEN -1 END),0)>0 AND ?8>0";
  await q(`INSERT OR IGNORE INTO camp_growth_events SELECT ?1,?2,?3,?4,?5,?6,?7
    WHERE (SELECT ${condition} FROM camp_growth_events WHERE school=?1 AND member=?2)`,s,m,'action:'+b.id,b.action,b.action==='exchange'?cost:value,b.food,now,cost).run();
  const saved=await first(db,'SELECT kind,item FROM camp_growth_events WHERE school=? AND member=? AND event=?',s,m,'action:'+b.id);
  if(saved?.kind!==b.action||saved?.item!==b.food)fail(b.action==='exchange'?'饲料不足，请先完成练习。':'猫粮库存不足，请先兑换。',409);
}

async function readExam(db,me){
  const [s,m]=[me.school,me.id];
  const [archive,total,stories]=await Promise.all([
    rows(db,'SELECT field,value,updated FROM camp_exam_fields WHERE school=?',s),
    first(db,'SELECT COUNT(*) count FROM camp_exam_contributors WHERE school=?',s),
    rows(db,`SELECT t.id storyId,t.nickname,t.band,t.days,t.headline,t.body,COUNT(l.member) likes,
      COALESCE(MAX(l.member=?2),0) liked FROM camp_stories t LEFT JOIN camp_story_likes l ON l.school=t.school AND l.story=t.id
      WHERE t.school=?1 GROUP BY t.school,t.id ORDER BY t.created DESC,t.id`,s,m)
  ]);
  const latest=Math.max(0,...archive.map(f=>f.updated));
  return {joined:!!me.nickname,demo:demo(s),exam:{...Object.fromEntries(fields.map(f=>[f,''])),
    ...Object.fromEntries(archive.map(f=>[f.field,f.value])),contributors:total.count,updatedAt:latest?new Date(latest).toISOString():''},stories};
}

async function mutateExam(db,me,b){
  const [s,m]=[me.school,me.id],now=Date.now(),q=(query,...args)=>statement(db,query,...args);
  if(b.action==='archive'){
    const changes=Object.entries(b.fields||{});
    if(!key(b.id)||!changes.length||changes.some(([k,v])=>!fields.includes(k)||!validText(v,300)||typeof b.before?.[k]!=='string'))fail('请至少补充一项，每项最多 300 字。');
    const readSet=Object.fromEntries(changes.map(([k])=>[k,b.before[k]]));
    const pending='EXISTS (SELECT 1 FROM camp_exam_edits WHERE school=?1 AND member=?2 AND id=?3 AND applied=0)';
    await db.batch([
      q(`INSERT OR IGNORE INTO camp_exam_edits SELECT ?1,?2,?3,0 WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?4) original LEFT JOIN camp_exam_fields f ON f.school=?1 AND f.field=original.key
        WHERE COALESCE(f.value,'')<>original.value)`,s,m,b.id,JSON.stringify(readSet)),
      ...changes.map(([field,val])=>q(`INSERT INTO camp_exam_fields SELECT ?1,?4,?5,?2,?6 WHERE ${pending}
        ON CONFLICT(school,field) DO UPDATE SET value=excluded.value,author=excluded.author,updated=excluded.updated`,s,m,b.id,field,val.trim(),now)),
      q(`INSERT OR IGNORE INTO camp_exam_contributors SELECT ?1,?2 WHERE ${pending}`,s,m,b.id),
      q('UPDATE camp_exam_edits SET applied=1 WHERE school=? AND member=? AND id=?',s,m,b.id)
    ]);
    if(!(await first(db,'SELECT 1 FROM camp_exam_edits WHERE school=? AND member=? AND id=?',s,m,b.id)))fail('刚有同学更新了这一项。请重新打开编辑，核对后再保存。',409);
  }else if(b.action==='story'){
    if(!key(b.id)||!validText(b.headline,90)||!validText(b.body,2000)||!Number.isInteger(b.band*2)||typeof b.band!=='number'||b.band<1||b.band>9
      ||!Number.isInteger(b.days)||b.days<0||b.days>3650) fail('请填写标题、具体做法和 1–9 的整分或半分，天数为 0–3650 的整数。');
    await q('INSERT OR IGNORE INTO camp_stories VALUES(?,?,?,?,?,?,?,?,?)',s,b.id,m,me.nickname,b.band,b.days,b.headline.trim(),b.body.trim(),now).run();
    if(!(await first(db,'SELECT 1 FROM camp_stories WHERE school=? AND id=? AND member=?',s,b.id,m)))fail('发布编号冲突，请重试。',409);
  }else if(b.action==='like'){
    if(!key(b.id)||typeof b.liked!=='boolean'||!(await first(db,'SELECT 1 FROM camp_stories WHERE school=? AND id=?',s,b.id)))fail('未找到本校这条经验。',404);
    if(b.liked)await q('INSERT OR IGNORE INTO camp_story_likes VALUES(?,?,?)',s,b.id,m).run();
    else await q('DELETE FROM camp_story_likes WHERE school=? AND story=? AND member=?',s,b.id,m).run();
  }else fail('未知的考试经验操作。');
}

export async function campusGrowth(db,me,route,body){
  await prepareDemo(db,me);
  if(route==='growth'){
    await importSessions(db,me);
    if(body)await mutateGrowth(db,me,body);
    return readGrowth(db,me);
  }
  if(body)await mutateExam(db,me,body);
  return readExam(db,me);
}

