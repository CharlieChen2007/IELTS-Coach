import { handleCampusTeams, awardSpeakingProgress } from './campus-teams.mjs';
import { handleSpeakingPair } from './pair-speaking.mjs';

// A scope selects a browser's separate host-account cookie. Only the random cookie grants access.
async function campusCookieName(request) {
  const scope = request.headers.get('X-Speaking-Scope');
  if (!scope) return 'coach_group_campus_session';
  if (scope.length > 768) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  const suffix = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  return 'coach_group_campus_session_' + suffix;
}
const idPattern = /^[A-Za-z0-9_:-]{1,100}$/;

async function participantId(kind, credential) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return kind + '_' + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function identity(request, cookieName) {
  const accountId = request.headers.get('oai-authenticated-user-id');
  if (accountId) return await participantId('account', accountId);
  const cookie = (request.headers.get('Cookie') || '').split(';').map(item => item.trim())
    .find(item => item.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? await participantId('guest', token) : null;
}

async function enroll(request, env, userId, nickname, json, cookieName) {
  if (typeof nickname !== 'string' || !nickname.trim() || [...nickname.trim()].length > 24 ||
      /[\u0000-\u001f\u007f]/.test(nickname)) return json({error:'请输入 1 至 24 个字的昵称。'},400);
  let cookie;
  if (!userId) {
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g,'');
    userId = await participantId('guest', token);
    cookie = cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000' +
      (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
  }
  await env.DB.prepare('INSERT INTO campus_profiles(user_id,nickname) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING')
    .bind(userId,nickname.trim()).run();
  const profile = await env.DB.prepare('SELECT nickname FROM campus_profiles WHERE user_id=?').bind(userId).first();
  const response = json({active:true,nickname:profile.nickname,participant:userId});
  if (cookie) response.headers.set('Set-Cookie',cookie);
  return response;
}

// Accept only lifecycle events for this participant's own practice. No recordings or transcripts
// are published to the team. Event IDs survive retries; an empty session earns no progress.
async function soloEvent(action, env, {userId, body, json}) {
  const {id,kind,answerId} = body;
  if (!idPattern.test(typeof id === 'string' ? id : '') || !['exam','practice'].includes(kind))
    return json({error:'练习记录无效。'},400);
  if (action === 'start') {
    await env.DB.prepare('INSERT OR IGNORE INTO campus_solo_sessions(user_id,task_id,kind,started_at) VALUES(?,?,?,?)')
      .bind(userId,id,kind,Date.now()).run();
    return json({ok:true});
  }
  const saved = await env.DB.prepare('SELECT kind,finished_at FROM campus_solo_sessions WHERE user_id=? AND task_id=?')
    .bind(userId,id).first();
  if (!saved || saved.kind !== kind) return json({error:'未找到本场校园练习。'},404);
  if (action === 'answer') {
    if (!idPattern.test(typeof answerId === 'string' ? answerId : '')) return json({error:'回答编号无效。'},400);
    if (!saved.finished_at) await env.DB.prepare('INSERT OR IGNORE INTO campus_solo_answers(user_id,task_id,answer_id) VALUES(?,?,?)')
      .bind(userId,id,answerId).run();
    return json({ok:true});
  }
  if (action !== 'finish') return json({error:'找不到此操作。'},404);
  await env.DB.prepare('UPDATE campus_solo_sessions SET finished_at=? WHERE user_id=? AND task_id=? AND finished_at IS NULL AND EXISTS (SELECT 1 FROM campus_solo_answers WHERE user_id=? AND task_id=?)')
    .bind(Date.now(),userId,id,userId,id).run();
  const finished = await env.DB.prepare('SELECT finished_at FROM campus_solo_sessions WHERE user_id=? AND task_id=?').bind(userId,id).first();
  if (finished?.finished_at) await awardSpeakingProgress(env,userId,'solo:'+kind+':'+id,finished.finished_at);
  return json({ok:true});
}

export async function handleCampus(request, env, {json,readJSON}) {
  const url = new URL(request.url), path = url.pathname;
  const write = request.method === 'POST';
  if (!write && !['GET','HEAD'].includes(request.method)) return json({error:'请求方法不支持。'},405);
  if (write && (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site'))
    return json({error:'请从本站提交。'},403);
  const cookieName = await campusCookieName(request);
  if (!cookieName) return json({error:'账号标识超出长度限制。'},400);
  const userId = await identity(request,cookieName);
  const profile = userId && await env.DB.prepare('SELECT nickname FROM campus_profiles WHERE user_id=?').bind(userId).first();
  if (path === '/api/campus/me' && request.method === 'GET') {
    return json(profile ? {active:true,nickname:profile.nickname,participant:userId} : {active:false});
  }
  if (path === '/api/campus/session' && write) {
    const input = await readJSON(request,1024);
    return await enroll(request,env,userId,input?.nickname,json,cookieName);
  }
  if (!profile) return json({error:'请先设置一个搭子昵称。',code:'CAMPUS_PROFILE_REQUIRED'},401);
  const expected = request.headers.get('X-Campus-Participant');
  if (expected && expected !== userId) return json({error:'当前练习身份已切换，请刷新页面。'},409);
  const rawAudio = path === '/api/campus/pair/audio';
  const body = write && !rawAudio ? await readJSON(request,32768) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'请求内容无效。'},400);
  const ctx = {userId,nickname:profile.nickname,body,json,
    awardSpeaking:(participant,completionId,completedAt) => awardSpeakingProgress(env,participant,completionId,completedAt)};
  if (path.startsWith('/api/campus/teams/')) return await handleCampusTeams(request,env,ctx);
  if (path.startsWith('/api/campus/pair/')) return await handleSpeakingPair(request,env,ctx);
  if (write && path.startsWith('/api/campus/solo/')) return await soloEvent(path.slice('/api/campus/solo/'.length),env,ctx);
  return json({error:'找不到这个校园练习入口。'},404);
}
