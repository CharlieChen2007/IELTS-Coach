import {participant} from '../modules/campus-social/identity.mjs';
import {decodeWorkspace, extractSubmissions} from '../public/writing/assets/writing-state.js';
import {getDeepSeekConfig, callDeepSeekCompletion, DeepSeekError} from '../modules/ai/deepseek.mjs';
import {handleWritingEngine} from '../modules/writing-engine/api.mjs';
/**
 * 「AI 写作精修」模块的服务端端口。
 *
 * 写作工作区包含按账号隔离的草稿、原稿和报告快照：
 *   · GET/PUT /api/writing/workspace   —— 把游客工作区备份到站点数据库，按站内账号隔离
 *   · POST    /api/ai/chat             —— streamCompletion 的 DeepSeek 服务端代理
 *   · GET     /api/writing/ai/status   —— AI 能力与今日额度状态，便于验收与前端提示
 *
 * 工作区保留本机缓存，已提交原稿另存不可变记录以供历史、营地和复练核验。
 * AI Key 只从服务端环境变量读取，浏览器永远拿不到；未配置时返回结构化错误而不是崩溃。
 */
const MAX_WORKSPACE = 3 * 1024 * 1024;
const MAX_PROMPT = 6 * 1024 * 1024;
const SCOPES = /^[A-Za-z0-9_%.-]{1,200}$/;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function respond(value, status = 200) {
  return Response.json(value, { status, headers });
}
function error(code, message, status = 503) {
  return respond({ error: { code, message } }, status);
}
async function ownerOf(request, env) {
  const headers=new Headers(request.headers);
  if(!headers.has('X-Speaking-Scope')){const scope=new URL(request.url).searchParams.get('scope');if(scope && SCOPES.test(scope))headers.set('X-Speaking-Scope',scope);}
  return participant(new Request(request.url,{headers}), env);
}
function sameSite(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  return !(origin && origin !== url.origin) && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
async function ensureTables(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS writing_submissions(owner_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,id))').run();
  /* 幂等建表：不改动口语模块的迁移基线，避免影响既有数据库。 */
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS writing_workspace(' +
    'owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS writing_ai_usage(' +
    'owner_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner_id,day))').run();
}

function dailyLimit(env) {
  const value = Number(env?.WRITING_AI_DAILY_LIMIT || globalThis.process?.env?.WRITING_AI_DAILY_LIMIT || 40);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value || 40)) : 40;
}
/** Same DeepSeek settings as oral coaching; Worker bindings win over Node env. */
export function aiConfig(env = {}) {
  const config = getDeepSeekConfig(env);
  return config ? {...config, limit: dailyLimit(env)} : null;
}

async function handleWorkspace(request, env) {
  await ensureTables(env);
  const owner = await ownerOf(request, env);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, updated_at FROM writing_workspace WHERE owner_id=?')
      .bind(owner).first();
    return respond({ data: row ? row.payload : null, updatedAt: row?.updated_at || null });
  }
  /* POST 与 PUT 等价：sendBeacon 只能发 POST，用于离开页面时的兜底备份。 */
  if (request.method !== 'PUT' && request.method !== 'POST') return respond({ error: '不支持该操作。' }, 405);
  if (!sameSite(request)) return respond({ error: '请从本站保存写作工作区。' }, 403);
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !(type === 'text/plain' && request.method === 'POST')) {
    return respond({ error: '请提交 JSON 工作区。' }, 415);
  }
  if (Number(request.headers.get('Content-Length')) > MAX_WORKSPACE) return respond({ error: '工作区过大。' }, 413);
  const text = await request.text();
  if (text.length > MAX_WORKSPACE) return respond({ error: '工作区过大。' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return respond({ error: '工作区格式无效。' }, 400); }
  if (typeof body?.workspace !== 'string' || body.workspace.length < 2) {
    return respond({ error: '工作区结构无效。' }, 400);
  }
  let snapshot;
  try { snapshot = decodeWorkspace(body.workspace); } catch { return respond({error:'写作工作区结构无效。'},400); }
  const entries = extractSubmissions(snapshot).slice(0,1000);
  if (entries.some(e=>typeof e.id!=='string' || e.id.length>160 || !/^[a-zA-Z0-9_.:-]+$/.test(e.id) || typeof e.text!=='string' || e.text.length>20000 || !['task1','task2'].includes(e.task))) return respond({error:'提交记录结构无效。'},400);
  const now = Date.now();
  const existing=entries.length?(await env.DB.prepare('SELECT id,payload FROM writing_submissions WHERE owner_id=?').bind(owner).all()).results:[];
  const snapshots=new Map(existing.map(row=>[row.id,JSON.parse(row.payload)]));
  for(const entry of entries){
    const original=snapshots.get(entry.id);
    if(original){if(original.text!==entry.text || original.task!==entry.task || original.topicId!==entry.topicId)return respond({error:'已提交的原稿有冲突，请另存为新的一稿。'},409);}
    if(!Number.isFinite(Date.parse(entry.createdAt)) || Date.parse(entry.createdAt)>now+60000)entry.createdAt=new Date(now).toISOString();
  }
  const writes = entries.map(entry=>env.DB.prepare('INSERT OR IGNORE INTO writing_submissions(owner_id,id,payload,created_at) VALUES(?,?,?,?)')
    .bind(owner,entry.id,JSON.stringify(entry),Number.isFinite(Date.parse(entry.createdAt))?Date.parse(entry.createdAt):now));
  // The condition runs in the same batch as immutable inserts. A simultaneous
  // request can never replace the workspace with a different text for the same ID.
  writes.push(env.DB.prepare(`INSERT INTO writing_workspace(owner_id,payload,updated_at)
    SELECT ?1,?2,?3 WHERE NOT EXISTS(
      SELECT 1 FROM json_each(?4) incoming JOIN writing_submissions saved
        ON saved.owner_id=?1 AND saved.id=json_extract(incoming.value,'$.id')
      WHERE json_extract(saved.payload,'$.text')<>json_extract(incoming.value,'$.text')
        OR json_extract(saved.payload,'$.task')<>json_extract(incoming.value,'$.task')
        OR json_extract(saved.payload,'$.topicId')<>json_extract(incoming.value,'$.topicId'))
    ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
    .bind(owner,body.workspace,now,JSON.stringify(entries)));
  const saved=await env.DB.batch(writes);
  if(!saved.at(-1)?.meta?.changes)return respond({error:'已提交的原稿有冲突，请另存为新的一稿。'},409);
  return respond({ ok: true, updatedAt: now });
}

async function handleSubmissions(request,env) {
  if(request.method!=='GET') return respond({error:'请用 GET 查看写作记录。'},405);
  await ensureTables(env);
  const owner=await ownerOf(request,env);
  const result=await env.DB.prepare('SELECT payload FROM writing_submissions WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 1000').bind(owner).all();
  return respond({submissions:result.results.map(row=>JSON.parse(row.payload))});
}

async function handleChat(request, env, config) {
  const owner = await ownerOf(request, env);
  if (request.method !== 'POST') return respond({ error: '不支持该操作。' }, 405);
  if (!sameSite(request)) return error('FORBIDDEN', '请从本站发起 AI 精修。', 403);
  await ensureTables(env);
  const day = new Date(Date.now()+8*3600000).toISOString().slice(0, 10);
  const used = Number((await env.DB.prepare('SELECT count FROM writing_ai_usage WHERE owner_id=? AND day=?')
    .bind(owner, day).first())?.count || 0);
  if (used >= config.limit) {
    return error('AI_QUOTA_EXCEEDED', '今日 AI 精修额度已用完，明天会自动恢复；基础规则反馈与草稿照常可用。', 429);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error('INVALID_REQUEST', '请提交 JSON 请求。', 415);
  }
  const text = await request.text();
  if (text.length > MAX_PROMPT) return error('INVALID_REQUEST', '作文内容过长。', 413);
  let body;
  try { body = JSON.parse(text); } catch { return error('INVALID_REQUEST', '请求格式无效。', 400); }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length || messages.some(m => !['user','assistant','system'].includes(m?.role) || !(typeof m.content==='string' || Array.isArray(m.content) && m.content.every(part=>part?.type==='text' && typeof part.text==='string' || part?.type==='image_url' && typeof part.image_url?.url==='string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(part.image_url.url))))) {
    return error('INVALID_REQUEST', '请求内容无效。', 400);
  }
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 2048, 1), 8192);
  const reserved = await env.DB.prepare('INSERT INTO writing_ai_usage(owner_id,day,count) VALUES(?,?,1) ON CONFLICT(owner_id,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(owner,day,config.limit).first();
  if(!reserved) return error('AI_QUOTA_EXCEEDED','今日 AI 精修额度已用完。',429);
  const release = ()=>env.DB.prepare('UPDATE writing_ai_usage SET count=MAX(0,count-1) WHERE owner_id=? AND day=?').bind(owner,day).run();
  try {
    const completion = await callDeepSeekCompletion(env, messages, {
      maxTokens,
      temperature: Math.min(Math.max(Number(body.temperature) || 0, 0), 2),
      jsonObject: Boolean(body.jsonObject),
      signal: request.signal,
    });
    // Preserve the native Task 1 / Task 2 JSON text and response contract.
    return respond(completion);
  } catch (cause) {
    await release();
    if (cause instanceof DeepSeekError) return error(cause.code, cause.message, cause.status);
    console.error('Writing AI upstream:', cause?.name || 'Error');
    return error('AI_UPSTREAM_UNAVAILABLE', 'AI 服务暂时连不上，请稍后再试；基础规则反馈与草稿照常可用。', 502);
  }
}

async function handleStatus(request, env, config, limit) {
  await ensureTables(env);
  let owner = null;
  try { owner = await ownerOf(request, env); } catch { /* 未登录也能看能力状态 */ }
  const day = new Date(Date.now()+8*3600000).toISOString().slice(0, 10);
  const used = owner ? Number((await env.DB.prepare('SELECT count FROM writing_ai_usage WHERE owner_id=? AND day=?')
    .bind(owner, day).first())?.count || 0) : 0;
  return respond({
    configured: Boolean(config),
    provider: config ? config.host : null,
    model: config?.model || 'deepseek-flash',
    quota: { limit, used: owner ? used : null, remaining: owner ? Math.max(0, limit - used) : null },
    localEngine: true,
  });
}

export function isWritingApi(pathname) {
  return /^\/api\/writing\/(?:workspace|submissions|ai\/status|evaluate|profile)$/.test(pathname) || pathname === '/api/ai/chat';
}

export async function handleWritingApi(request, env) {
  const config = aiConfig(env);
  const limit = config?.limit ?? dailyLimit(env);
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === '/api/writing/evaluate' || pathname === '/api/writing/profile') return await handleWritingEngine(request,env);
    if (pathname === '/api/writing/submissions') return await handleSubmissions(request,env);
    if (pathname === '/api/writing/workspace') return await handleWorkspace(request, env);
    if (pathname === '/api/writing/ai/status') return await handleStatus(request, env, config, limit);
    if (pathname === '/api/ai/chat') {
      if (!config) return error('AI_NOT_CONFIGURED', 'AI 精修尚未配置服务端密钥；题库、草稿和基础规则反馈可正常使用。', 503);
      return await handleChat(request, env, config);
    }
    return respond({ error: '接口不存在。' }, 404);
  } catch (cause) {
    if (!cause.status) console.error('Writing service:', cause?.name || cause);
    return respond({ error: cause.status ? cause.message : '写作服务暂时不可用，请稍后重试。' }, cause.status || 500);
  }
}
