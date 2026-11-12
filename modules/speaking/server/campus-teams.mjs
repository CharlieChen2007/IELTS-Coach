const skills = ['listening', 'speaking', 'reading', 'writing'];
const goals = Object.fromEntries(skills.map(skill => [skill, 1]));
const dayMs = 86400000;
const days = ['一', '二', '三', '四', '五', '六', '日'];
const periods = ['上午', '午间', '下午', '晚间'];
const validSlots = new Set(days.flatMap(day => periods.map(period => '周' + day + period)));

function shanghaiWeek(now) {
  const local = new Date(now + 8 * 3600000);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    - (local.getUTCDay() + 6) % 7 * dayMs;
  const label = time => new Date(time).toISOString().slice(0, 10);
  return {start:label(monday), end:label(monday + 6 * dayMs)};
}

function criteria(month, target, slots) {
  if (typeof month !== 'string' || !/^20\d\d-(?:0[1-9]|1[0-2])$/.test(month)) return null;
  const band = Number(target);
  if (!Number.isInteger(band * 2) || band < 1 || band > 9) return null;
  if (!Array.isArray(slots) || !slots.length || slots.length > validSlots.size ||
      slots.some(slot => !validSlots.has(slot))) return null;
  return {month, target:band, slots:[...new Set(slots)]};
}

function summary(row) {
  return {
    id:row.id, name:row.name, month:row.exam_month, target:row.target,
    slots:JSON.parse(row.slots), size:row.size
  };
}

async function dashboard(db, userId, space) {
  const week = shanghaiWeek(Date.now());
  const state = {week, goals, team:null};
  const team = await db.prepare(
    'SELECT t.* FROM campus_team_members m JOIN campus_teams t ON t.id=m.team_id WHERE m.user_id=? AND t.space=?'
  ).bind(userId,space).first();
  if (!team) return state;
  // Verify membership again in the query exposing the roster (a leave may be concurrent).
  const {results} = await db.prepare(
    'SELECT m.nickname, m.user_id, c.skill, COUNT(c.completion_id) AS qty FROM campus_team_members m ' +
    'LEFT JOIN campus_team_completions c ON c.team_id=m.team_id AND c.user_id=m.user_id AND c.week=? ' +
    'WHERE m.team_id=? AND EXISTS (SELECT 1 FROM campus_team_members WHERE user_id=? AND team_id=m.team_id) ' +
    'GROUP BY m.user_id, c.skill ORDER BY m.joined_at, m.user_id'
  ).bind(week.start,team.id,userId).all();
  const roster = new Map();
  for (const row of results) {
    let member = roster.get(row.user_id);
    if (!member) {
      member = {nickname:row.nickname, self:row.user_id === userId, counts:Object.fromEntries(skills.map(s => [s, 0]))};
      roster.set(row.user_id, member);
    }
    if (row.skill) member.counts[row.skill] = row.qty;
  }
  if (roster.size) state.team = {...summary({...team,size:roster.size}), members:[...roster.values()]};
  return state;
}

// Call only from a trusted server handler after verifying/persisting a finished exercise.
// Persist even a currently ungrouped completion, so a replay cannot credit a later group.
export async function awardTeamProgress(env, userId, skill, completionId, completedAt = Date.now()) {
  if (!userId || !skills.includes(skill) || typeof completionId !== 'string' || !completionId ||
      completionId.length > 240 || !Number.isSafeInteger(completedAt) || completedAt <= 0) {
    throw new Error('Invalid team completion');
  }
  await env.DB.prepare(
    'INSERT INTO campus_team_completions(user_id,skill,completion_id,team_id,week,completed_at) ' +
    'VALUES(?,?,?,(SELECT team_id FROM campus_team_members WHERE user_id=? AND joined_at<=?),?,?) ' +
    'ON CONFLICT(user_id,skill,completion_id) DO NOTHING'
  ).bind(userId,skill,completionId,userId,completedAt,shanghaiWeek(completedAt).start,completedAt).run();
}

export async function awardSpeakingProgress(env, userId, completionId, completedAt = Date.now()) {
  return awardTeamProgress(env, userId, 'speaking', completionId, completedAt);
}

export async function handleCampusTeams(request, env, {userId,nickname,body,json}) {
  const db = env.DB;
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();
  const error = (message,status = 400) => json({error:message},status);
  if (!userId) return error('请先设置练习昵称。',401);
  const space = request.headers.get('X-Speaking-Scope')?.startsWith('showcase_') ? userId : '';
  if (request.method === 'GET' && action === 'me') return json(await dashboard(db,userId,space));
  if (request.method === 'GET' && action === 'invite') {
    const row = await db.prepare('SELECT t.*, COUNT(m.user_id) AS size FROM campus_teams t ' +
      'JOIN campus_team_members m ON m.team_id=t.id WHERE t.id=? AND t.space=? GROUP BY t.id')
      .bind(url.searchParams.get('id') || '',space).first();
    return row ? json({team:summary(row)}) : error('这份邀请已经失效，可以重新匹配小组。',404);
  }
  if (request.method === 'GET' && action === 'find') {
    const p = url.searchParams;
    const filter = criteria(p.get('month'), p.get('target'), p.getAll('slot'));
    if (!filter) return error('请选择考试月份、目标分和至少一个空闲时段。');
    const {results} = await db.prepare(
      'SELECT t.*, COUNT(m.user_id) AS size FROM campus_teams t JOIN campus_team_members m ON m.team_id=t.id ' +
      'WHERE t.space=? AND t.exam_month=? AND t.target=? AND EXISTS (SELECT 1 FROM json_each(t.slots) s ' +
      'JOIN json_each(?) f ON s.value=f.value) GROUP BY t.id HAVING COUNT(m.user_id)<4 ' +
      'ORDER BY t.created_at DESC LIMIT 40'
    ).bind(space,filter.month,filter.target,JSON.stringify(filter.slots)).all();
    return json({teams:results.map(summary)});
  }
  if (!['create','join','leave'].includes(action)) return error('没有这个小组接口。',404);
  if (request.method !== 'POST') return error('请使用 POST 更新小组。',405);
  const input = body || {};
  const now = Date.now();
  const displayName = String(nickname || '').trim().slice(0, 32);
  if (!displayName) return error('请先设置练习昵称。');
  if (action === 'create') {
    const filter = criteria(input.month,input.target,input.slots);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!filter || !name || name.length > 32) return error('请填写 1–32 字组名，并选择月份、目标分和空闲时段。');
    const id = crypto.randomUUID();
    // Membership is unique per user. Repeated create and concurrent join cannot allocate a second team.
    await db.batch([
      db.prepare('INSERT INTO campus_teams(id,name,exam_month,target,slots,created_at,space) SELECT ?,?,?,?,?,?,? ' +
        'WHERE NOT EXISTS (SELECT 1 FROM campus_team_members WHERE user_id=?)')
        .bind(id,name,filter.month,filter.target,JSON.stringify(filter.slots),now,space,userId),
      db.prepare('INSERT INTO campus_team_members(user_id,team_id,nickname,joined_at) ' +
        'SELECT ?,id,?,? FROM campus_teams WHERE id=?').bind(userId,displayName,now,id)
    ]);
    return json(await dashboard(db,userId,space));
  }
  const id = input.id;
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return error('小组编号无效。');
  if (action === 'leave') {
    await db.prepare('DELETE FROM campus_team_members WHERE user_id=? AND team_id=?').bind(userId,id).run();
    return json(await dashboard(db,userId,space));
  }
  // Perform capacity and membership checks in the same write, including concurrent fourth-seat joins.
  await db.prepare(
    'INSERT INTO campus_team_members(user_id,team_id,nickname,joined_at) ' +
    'SELECT ?,t.id,?,? FROM campus_teams t WHERE t.id=? AND t.space=? AND ' +
    '(SELECT COUNT(*) FROM campus_team_members WHERE team_id=t.id) BETWEEN 1 AND 3 ' +
    'ON CONFLICT(user_id) DO NOTHING'
  ).bind(userId,displayName,now,id,space).run();
  const state = await dashboard(db,userId,space);
  if (state.team?.id === id) return json(state);
  return error(state.team ? '请先退出当前小组，再加入新组。' : '这个小组已满或已经解散，请重新匹配。',409);
}
