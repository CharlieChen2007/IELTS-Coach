const roundSeconds = 120;
const uploadGraceMs = 60_000;
const queuePresenceMs = 60_000;
const audioLimit = 6 * 1024 * 1024;
const live = "status IN ('waiting','ready','active','review')";
const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
const cards = [
  {title:'学习空间', prompt:'Describe a place where you enjoy studying. Say where it is, what you do there and why it helps you study.', followups:['How is this place different from studying at home?', 'How could a university improve its study spaces?']},
  {title:'一次合作', prompt:'Describe a time you worked with others on a project. Explain your role, what happened and how you felt about the result.', followups:['What was the hardest part of working together?', 'What makes teamwork successful at university?']},
  {title:'学会一项技能', prompt:'Describe a skill you learned outside class. Say why you chose it, how you practised and what you can do now.', followups:['Who helped you learn this skill?', 'Should practical skills be taught in university courses?']},
  {title:'一次难忘的活动', prompt:'Describe an event you enjoyed attending. Say what happened, who was there and why it was memorable.', followups:['Would you go to a similar event again?', 'What can organisers do to attract more students?']}
];
const revisits = [
  ['用一句话交代地点，再用一个具体细节说明它怎样帮助学习。','各举一个细节，对比在校园和在家学习。','提出一种设施改进，解释它能帮助哪类学生。'],
  ['按目标、你的行动和结果三步重述，特别说清自己的贡献。','重述一个具体困难，加一句说明你如何解决它。','提出一个让团队顺利合作的条件，用这次经历举例。'],
  ['先介绍技能，再用起初和现在的表现对比进步。','用一句具体建议说明对方如何帮你进步。','先表达立场，再举一个适合在大学里练习的例子。'],
  ['按活动、一个亲历细节和感受来重述。','先明确是否愿意再去，再补充一个具体理由。','针对一种学生需求提出改进，并说明可能的效果。']
];

class PairError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requirePair(condition, status, message) {
  if (!condition) throw new PairError(status, message);
}
function createCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => letters[n % letters.length]).join('');
}
function newState() {
  const start = crypto.getRandomValues(new Uint8Array(1))[0] % cards.length;
  return {round:1, startedAt:null, deadline:null, reason:'', rounds:[0,1].map(i => ({
    card:(start+i)%cards.length, promptIndex:0, audio:null, submitted:false, feedback:null
  }))};
}
function getRoom(db, code) {
  return db.prepare('SELECT * FROM campus_speaking_pairs WHERE code=?').bind(code).first();
}
function getMine(db, id, activeOnly) {
  return db.prepare('SELECT * FROM campus_speaking_pairs WHERE (host=? OR guest=?) ' +
    (activeOnly ? 'AND '+live+' ' : '') +
    'ORDER BY CASE WHEN '+live+' THEN 0 ELSE 1 END, updated_at DESC, rowid DESC LIMIT 1').bind(id,id).first();
}
async function save(db, row, state, status = row.status) {
  // Every role-sensitive transition applies to exactly the version the caller inspected.
  const now = Date.now();
  const res = await db.prepare('UPDATE campus_speaking_pairs SET state_json=?,status=?,version=version+1,updated_at=?,completed_at=? WHERE code=? AND version=?')
    .bind(JSON.stringify(state),status,now,status==='complete' ? (row.completed_at || now) : null,row.code,row.version).run();
  requirePair(res.meta.changes===1,409,'房间状态已更新，请刷新后重试。');
  return getRoom(db,row.code);
}
function candidate(row, round) { return round === 1 ? row.guest : row.host; }
function isMember(row, id) { return row && (row.host === id || row.guest === id); }
async function applyClock(db, row) {
  if (!row) return row;
  const now = Date.now();
  if (row.status === 'active') {
    const state = JSON.parse(row.state_json);
    if (now <= state.deadline + uploadGraceMs) return row;
    const turn = state.rounds[state.round-1];
    if (turn.audio) {
      turn.submitted = true;
      return save(db,row,state,'review');
    }
    state.reason = '本轮结束后未收到录音，已结束本场。';
    return save(db,row,state,'cancelled');
  }
  if (['waiting','ready','review'].includes(row.status) && now - row.updated_at > 24*60*60_000) {
    const state = JSON.parse(row.state_json);
    state.reason = '房间已超过一天没有活动。';
    return save(db,row,state,'cancelled');
  }
  return row;
}
function view(row, id) {
  if (!row) return null;
  const state = JSON.parse(row.state_json);
  const isHost = row.host === id;
  return {
    code:row.code,status:row.status,quick:Boolean(row.quick),round:state.round,
    role:candidate(row,state.round) === id ? 'candidate':'examiner',
    me:isHost ? row.host_name : row.guest_name, partner:isHost ? row.guest_name : row.host_name,
    startedAt:state.startedAt,deadline:state.deadline,serverNow:Date.now(),durationSeconds:roundSeconds,
    reason:state.reason, completedAt:row.completed_at,
    rounds:state.rounds.map((turn,index) => {
      const round = index + 1;
      const canHear = turn.audio && (turn.submitted || candidate(row,round) === id);
      return {...cards[turn.card], round, promptIndex:turn.promptIndex,mine:candidate(row,round)===id,
        retryTip:turn.submitted ? revisits[turn.card][turn.promptIndex] : null,
        examiner:round===1 ? row.host_name : row.guest_name,
        candidate:round===1 ? row.guest_name : row.host_name,
        hasAudio:Boolean(canHear),submitted:turn.submitted,feedback:turn.feedback,
        audioUrl:canHear ? '/api/campus/pair/audio?code='+row.code+'&round='+round : null};
    })
  };
}
async function settleCredits(db, ctx) {
  const result = await db.prepare("SELECT code,host,guest,completed_at FROM campus_speaking_pairs WHERE (host=? OR guest=?) AND status='complete' AND credited=0 ORDER BY completed_at LIMIT 8")
    .bind(ctx.userId,ctx.userId).all();
  for (const room of result.results) {
    const completion = 'pair:' + room.code;
    await ctx.awardSpeaking(room.host,completion,room.completed_at);
    await ctx.awardSpeaking(room.guest,completion,room.completed_at);
    await db.prepare('UPDATE campus_speaking_pairs SET credited=1 WHERE code=?').bind(room.code).run();
  }
}
async function join(db, id, name, code, quick) {
  const now = Date.now();
  // The subqueries and update run as one SQLite statement. Two candidates cannot take the same seat.
  const lookup = quick
    ? "code=(SELECT code FROM campus_speaking_pairs WHERE status='waiting' AND quick=1 AND host<>? AND waiting_seen_at>? ORDER BY updated_at,code LIMIT 1)"
    : 'code=?';
  const params = quick ? [id,now-queuePresenceMs] : [code];
  return db.prepare("UPDATE campus_speaking_pairs SET guest=?,guest_name=?,status='ready',version=version+1,updated_at=? WHERE "+lookup+
    " AND status='waiting' AND guest IS NULL AND host<>? AND updated_at>? AND NOT EXISTS (SELECT 1 FROM campus_speaking_pairs WHERE (host=? OR guest=?) AND "+live+')')
    .bind(id,name,now,...params,id,now-24*60*60_000,id,id).run();
}
async function enter(db, ctx, mode) {
  const {userId:id,nickname:name} = ctx;
  let active = await applyClock(db,await getMine(db,id,true));
  if (active && !['complete','cancelled'].includes(active.status)) {
    if (mode==='join' && active.code!==String(ctx.body.code || '').trim().toUpperCase()) {
      throw new PairError(409,'请先离开当前的模考房间。');
    }
    return active;
  }
  if (mode === 'join') {
    const code = String(ctx.body.code || '').trim().toUpperCase();
    requirePair(codePattern.test(code),400,'请输入 8 位房间码。');
    await join(db,id,name,code,false);
    active = await getMine(db,id,true);
    requirePair(active?.code===code,409,'房间已满、已结束或房间码无效。');
    return active;
  }
  const quick = mode === 'match';
  for (let attempt=0;attempt<5;attempt++) {
    if (quick) {
      const joined = await join(db,id,name,null,true);
      if (joined.meta.changes) return getMine(db,id,true);
    }
    const now = Date.now(), code = createCode();
    const skipQueue = quick ? " AND NOT EXISTS (SELECT 1 FROM campus_speaking_pairs WHERE status='waiting' AND quick=1 AND host<>? AND waiting_seen_at>?)" : '';
    const extra = quick ? [id,now-queuePresenceMs] : [];
    await db.prepare("INSERT OR IGNORE INTO campus_speaking_pairs(code,host,host_name,quick,status,updated_at,waiting_seen_at,state_json) SELECT ?,?,?,?,'waiting',?,?,? WHERE NOT EXISTS (SELECT 1 FROM campus_speaking_pairs WHERE (host=? OR guest=?) AND "+live+')'+skipQueue)
      .bind(code,id,name,quick ? 1:0,now,now,JSON.stringify(newState()),id,id,...extra).run();
    active = await getMine(db,id,true);
    if (active) return active;
  }
  throw new PairError(409,'匹配状态已变化，请重试。');
}
async function readAudio(request) {
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  requirePair(/^audio\/(webm|ogg|mp4|wav|x-wav|mpeg|aac)$/.test(mime),415,'请上传浏览器录制的音频。');
  requirePair(Number(request.headers.get('Content-Length'))<=audioLimit,413,'录音超过 6 MB，请缩短录音。');
  requirePair(request.body,400,'未收到录音。');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length>audioLimit) {
        await reader.cancel().catch(()=>{});
        throw new PairError(413,'录音超过 6 MB，请缩短录音。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  requirePair(length>=100,400,'录音太短，请重新录音。');
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk,offset); offset+=chunk.byteLength; }
  return {mime,data};
}
async function putAudio(request, env, row, state, turn) {
  if (turn.audio) return row;
  const {mime,data} = await readAudio(request);
  requirePair(Date.now()<=state.deadline+uploadGraceMs,409,'本轮上传时间已结束。');
  const key = 'campus-pair/'+row.code+'/'+state.round+'/'+crypto.randomUUID();
  await env.BUCKET.put(key,data,{httpMetadata:{contentType:mime}});
  // A question change from the examiner is independent of an audio upload: merge against
  // the latest version. A unique object key prevents overwriting the winning recording.
  try {
    for (let i=0;i<4;i++) {
      const fresh = await getRoom(env.DB,row.code);
      const current = JSON.parse(fresh.state_json), currentTurn = current.rounds[state.round-1];
      if (currentTurn.audio) {
        await env.BUCKET.delete(key);
        return fresh;
      }
      requirePair(fresh.status==='active' && current.round===state.round,409,'本轮已结束。');
      currentTurn.audio = {key,mime,bytes:data.byteLength};
      try { return await save(env.DB,fresh,current); }
      catch (error) { if (!(error instanceof PairError) || error.status!==409) throw error; }
    }
    throw new PairError(409,'房间状态正在同步，请重新上传。');
  } catch (error) {
    // A confirmed CAS conflict/invalid state guarantees our key was never linked.
    if (error instanceof PairError) await env.BUCKET.delete(key);
    throw error;
  }
}
async function getAudio(env, turn, request) {
  const {mime,bytes,key} = turn.audio;
  const headers = new Headers({'Content-Type':mime,'Accept-Ranges':'bytes',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  const range = request.headers.get('Range');
  let start = 0, end = bytes-1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      start = match[1] ? Number(match[1]) : Math.max(0,bytes-Number(match[2]));
      end = match[1] && match[2] ? Math.min(end,Number(match[2])) : end;
    }
    if (!match || (!match[1] && !match[2]) || start>end || !Number.isSafeInteger(start)) {
      headers.set('Content-Range','bytes */'+bytes);
      return new Response(null,{status:416,headers});
    }
    headers.set('Content-Range','bytes '+start+'-'+end+'/'+bytes);
  }
  const length = end-start+1;
  headers.set('Content-Length',String(length));
  const init = {status:range ? 206 : 200, headers};
  if (request.method==='HEAD') return new Response(null,init);
  const object = await env.BUCKET.get(key,range ? {range:{offset:start,length}} : {});
  requirePair(object,404,'未找到这段录音。');
  return new Response(object.body,init);
}
function feedback(body) {
  const result = {};
  for (const key of ['strength','focus','suggestion']) {
    const text = body[key];
    requirePair(typeof text==='string' && text.trim().length>0 && text.length<=240,400,'请填写亮点、改进点和重练建议，每项最多 240 字。');
    result[key] = text.trim();
  }
  return result;
}
export async function handleSpeakingPair(request, env, ctx) {
  try {
    const db = env.DB;
    const url = new URL(request.url);
    const action = url.pathname.slice('/api/campus/pair/'.length);
    const read = request.method==='GET' || (request.method==='HEAD' && action==='audio');
    requirePair((read && ['state','audio'].includes(action)) ||
      (request.method==='POST' && ['create','match','join','start','prompt','audio','submit','feedback','leave'].includes(action)),405,'不支持此房间操作。');
    const respond = row => ctx.json({room:view(row,ctx.userId)});
    if (action==='state' && !url.searchParams.has('code')) {
      await settleCredits(db,ctx);
      const row = await applyClock(db,await getMine(db,ctx.userId,false));
      if (row?.quick && row.status==='waiting' && row.host===ctx.userId && Date.now()-row.waiting_seen_at>15_000) {
        await db.prepare("UPDATE campus_speaking_pairs SET waiting_seen_at=? WHERE code=? AND status='waiting'").bind(Date.now(),row.code).run();
      }
      return respond(row);
    }
    if (['create','match','join'].includes(action)) {
      await settleCredits(db,ctx);
      return respond(await enter(db,ctx,action));
    }
    const body = ctx.body || {};
    const code = String(body.code || url.searchParams.get('code') || '').trim().toUpperCase();
    requirePair(codePattern.test(code),400,'请输入正确的房间码。');
    let row = await getRoom(db,code);
    requirePair(isMember(row,ctx.userId),404,'未找到你的房间。');
    row = await applyClock(db,row);
    if (action==='state') return respond(row);
    const state = JSON.parse(row.state_json);
    if (action==='leave') {
      if (['complete','cancelled'].includes(row.status)) return respond(row);
      state.reason = '有成员离开，本场已结束。';
      return respond(await save(db,row,state,'cancelled'));
    }
    const round = Number(body.round ?? url.searchParams.get('round'));
    requirePair(round===1 || round===2,400,'轮次无效。');
    const turn = state.rounds[round-1];
    const learner = candidate(row,round) === ctx.userId;
    if (action==='audio' && read) {
      requirePair(turn.audio && (turn.submitted || learner),404,'这段作答尚未提交。');
      return getAudio(env,turn,request);
    }
    if (action==='feedback' && !learner && turn.feedback) {
      const repeat = feedback(body);
      requirePair(JSON.stringify(repeat)===JSON.stringify(turn.feedback),409,'本轮反馈已提交。');
      await settleCredits(db,ctx);
      return respond(row);
    }
    if (action==='submit' && learner && turn.submitted) return respond(row);
    requirePair(round===state.round && row.guest && !['cancelled','complete'].includes(row.status),409,'本轮尚未就绪，或房间已结束。');
    if (action==='start') {
      requirePair(!learner,403,'本轮由考官开始。');
      if (row.status==='active') return respond(row);
      requirePair(row.status==='ready',409,'当前不能开始本轮。');
      state.startedAt = Date.now(); state.deadline = state.startedAt + roundSeconds*1000;
      return respond(await save(db,row,state,'active'));
    }
    if (action==='prompt') {
      requirePair(!learner,403,'由考官切换问题。');
      requirePair(row.status==='active' && Date.now() <= state.deadline,409,'本轮提问时间已结束。');
      requirePair(Number.isInteger(body.index) && body.index>=0 && body.index<=cards[turn.card].followups.length,400,'追问编号无效。');
      turn.promptIndex=body.index;
      return respond(await save(db,row,state));
    }
    if (action==='audio' || action==='submit') {
      requirePair(learner,403,'仅本轮考生可提交录音。');
      requirePair(row.status==='active',409,'当前不能提交作答。');
      if (action==='audio') return respond(await putAudio(request,env,row,state,turn));
      requirePair(turn.audio,400,'请先上传本轮录音。');
      turn.submitted=true;
      return respond(await save(db,row,state,'review'));
    }
    requirePair(!learner,403,'仅本轮考官可提交反馈。');
    requirePair(row.status==='review' && turn.submitted,409,'请等待考生交卷。');
    turn.feedback=feedback(body);
    state.startedAt=null; state.deadline=null;
    if (round===1) {
      state.round=2;
      return respond(await save(db,row,state,'ready'));
    }
    row=await save(db,row,state,'complete');
    await settleCredits(db,ctx);
    return respond(row);
  } catch (error) {
    if (error instanceof PairError) return ctx.json({error:error.message},error.status);
    throw error;
  }
}
