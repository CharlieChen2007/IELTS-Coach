const MAX_PAYLOAD = 3 * 1024 * 1024;
const MODULES = new Set(['shadow', 'vocab']);
const SCOPES = /^[A-Za-z0-9_%.-]{1,200}$/;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function respond(value, status = 200) {
  return Response.json(value, { status, headers });
}
async function ownerOf(request, env) {
  const scope = request.headers.get('X-Speaking-Scope') || new URL(request.url).searchParams.get('scope') || '';
  if (!SCOPES.test(scope)) throw Object.assign(new Error('请从登录后的学习空间进入。'), {status:401});
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  const cookieName = 'coach_group_campus_session_' + await digest(scope);
  const cookie = (request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
  const token = cookie?.slice(cookieName.length+1);
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Object.assign(new Error('学习身份已过期，请重新进入本科目。'),{status:401});
  const participant = 'guest_' + await digest(token);
  if (!await env.DB.prepare('SELECT 1 FROM campus_profiles WHERE user_id=?').bind(participant).first()) {
    throw Object.assign(new Error('请先进入学习空间。'), {status:401});
  }
  return participant;
}
function validPayload(module, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return false;
  /* 词汇模块重新接入：state.db 的结构就是 version:1 + cards/daily/streak/settings。 */
  if (module === 'vocab') {
    return !!value.cards && typeof value.cards === 'object' && !Array.isArray(value.cards);
  }
  return Array.isArray(value.sessions) && value.sessions.length <= 500 &&
    value.tasks && typeof value.tasks === 'object' && !Array.isArray(value.tasks) &&
    Array.isArray(value.curve) && value.curve.length <= 500;
}

export async function handleDaily(request, env) {
  try {
    const url = new URL(request.url);
    const match = /^\/api\/daily\/(shadow|vocab)$/.exec(url.pathname);
    if (!match) return respond({ error: '接口不存在。' }, 404);
    const module = match[1];
    if (!MODULES.has(module)) return respond({ error: '模块不存在。' }, 404);
    const owner = await ownerOf(request,env);
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT payload_json, updated_at FROM daily_learning WHERE owner_id=? AND module=?')
        .bind(owner, module).first();
      return respond({ data: row ? JSON.parse(row.payload_json) : null, updatedAt: row?.updated_at || null });
    }
    if (!['PUT','POST'].includes(request.method)) return respond({ error: '不支持该操作。' }, 405);
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return respond({ error: '请从本站保存学习记录。' }, 403);
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return respond({ error: '请提交 JSON 学习记录。' }, 415);
    }
    if (Number(request.headers.get('Content-Length')) > MAX_PAYLOAD) return respond({ error: '学习记录过大。' }, 413);
    const text = await request.text();
    if (text.length > MAX_PAYLOAD) return respond({ error: '学习记录过大。' }, 413);
    let data;
    try { data = JSON.parse(text); if (typeof data?.state === 'string') data = JSON.parse(data.state); } catch { return respond({ error: '学习记录格式无效。' }, 400); }
    if (!validPayload(module, data)) return respond({ error: '学习记录结构无效。' }, 400);
    const now = Date.now();
    await env.DB.prepare('INSERT INTO daily_learning(owner_id,module,payload_json,updated_at) VALUES(?,?,?,?) ' +
      'ON CONFLICT(owner_id,module) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at')
      .bind(owner, module, JSON.stringify(data), now).run();
    return respond({ ok: true, updatedAt: now });
  } catch (error) {
    if (!error.status) console.error('Daily learning service:', error);
    return respond({ error: error.status ? error.message : '每日学习记录暂时不可用，请稍后重试。' }, error.status || 500);
  }
}
