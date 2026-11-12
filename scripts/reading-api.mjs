/** 阅读备份与交卷服务。所有记录由校园会话 cookie 认证并按 participant 隔离。
 * 交卷使用同一套原生判分引擎，保存不可变快照，可供主站历史与校园复练核验。 */
import {participant} from '../modules/campus-social/identity.mjs';
import {gradePassage} from '../public/reading/js/features/grading.js';
import {bandFor} from '../public/reading/js/core/constants.js';
import p1 from '../public/reading/content/passages/p1.json' with {type:'json'};
import p2 from '../public/reading/content/passages/p2.json' with {type:'json'};
import p3 from '../public/reading/content/passages/p3.json' with {type:'json'};
import b7p1 from '../public/reading/content/passages/b7p1.json' with {type:'json'};
import b7p2 from '../public/reading/content/passages/b7p2.json' with {type:'json'};
import b7p3 from '../public/reading/content/passages/b7p3.json' with {type:'json'};
import b8p1 from '../public/reading/content/passages/b8p1.json' with {type:'json'};
import b8p2 from '../public/reading/content/passages/b8p2.json' with {type:'json'};
import b8p3 from '../public/reading/content/passages/b8p3.json' with {type:'json'};
import b9p1 from '../public/reading/content/passages/b9p1.json' with {type:'json'};
import b9p2 from '../public/reading/content/passages/b9p2.json' with {type:'json'};
import b9p3 from '../public/reading/content/passages/b9p3.json' with {type:'json'};
import b8ap1 from '../public/reading/content/passages/b8ap1.json' with {type:'json'};
import b8ap2 from '../public/reading/content/passages/b8ap2.json' with {type:'json'};
import b8ap3 from '../public/reading/content/passages/b8ap3.json' with {type:'json'};
import m1p1 from '../public/reading/content/passages/m1p1.json' with {type:'json'};
import m1p2 from '../public/reading/content/passages/m1p2.json' with {type:'json'};
import m1p3 from '../public/reading/content/passages/m1p3.json' with {type:'json'};

const passages=new Map([p1,p2,p3,b7p1,b7p2,b7p3,b8p1,b8p2,b8p3,b9p1,b9p2,b9p3,b8ap1,b8ap2,b8ap3,m1p1,m1p2,m1p3].map(p=>[p.id,p]));
const MAX_STATE = 4 * 1024 * 1024;
const SCOPES = /^[A-Za-z0-9_%.-]{1,200}$/;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function respond(value, status = 200) {
  return Response.json(value, { status, headers });
}
async function ownerOf(request,env) {
  const url = new URL(request.url);
  const scope = request.headers.get('X-Speaking-Scope') || url.searchParams.get('scope') || '';
  if (!SCOPES.test(scope)) throw Object.assign(new Error('请从登录后的学习空间进入。'), { status: 401 });
  const verified = request.headers.get('X-Speaking-Scope') ? request : new Request(request,{headers:new Headers([...request.headers,['X-Speaking-Scope',scope]])});
  return participant(verified,env);
}
function sameSite(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  return !(origin && origin !== url.origin) && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
async function ensureTables(env) {
  /* 幂等建表：不改动口语 / 写作模块的迁移基线，避免影响既有数据库。 */
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS reading_state(' +
    'owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS reading_attempts(owner_id TEXT NOT NULL,id TEXT NOT NULL,passage TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,id))').run();
}

async function handleState(request, env) {
  await ensureTables(env);
  const owner = await ownerOf(request,env);
  if (request.method === 'GET' || request.method === 'HEAD') {
    let row = await env.DB.prepare('SELECT payload, updated_at FROM reading_state WHERE owner_id=?')
      .bind(owner).first();
    if(!row){
      const scope=request.headers.get('X-Speaking-Scope')||new URL(request.url).searchParams.get('scope');
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO reading_state SELECT ?,payload,updated_at FROM reading_state WHERE owner_id=?').bind(owner,'host:'+scope),
        env.DB.prepare('DELETE FROM reading_state WHERE owner_id=? AND EXISTS(SELECT 1 FROM reading_state WHERE owner_id=?)').bind('host:'+scope,owner)
      ]);
      row=await env.DB.prepare('SELECT payload,updated_at FROM reading_state WHERE owner_id=?').bind(owner).first();
    }
    return respond({ data: row ? row.payload : null, updatedAt: row?.updated_at || null });
  }
  /* POST 与 PUT 等价：浏览器的 sendBeacon 只能发 POST，用于「离开页面时」的兜底备份。 */
  if (request.method !== 'PUT' && request.method !== 'POST') return respond({ error: '不支持该操作。' }, 405);
  if (!sameSite(request)) return respond({ error: '请从本站保存阅读进度。' }, 403);
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !(type === 'text/plain' && request.method === 'POST')) {
    return respond({ error: '请提交 JSON 工作区。' }, 415);
  }
  if (Number(request.headers.get('Content-Length')) > MAX_STATE) return respond({ error: '工作区过大。' }, 413);
  const text = await request.text();
  if (text.length > MAX_STATE) return respond({ error: '工作区过大。' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return respond({ error: '工作区格式无效。' }, 400); }
  if (typeof body?.state !== 'string' || body.state.length < 2) {
    return respond({ error: '工作区结构无效。' }, 400);
  }
  /* 数据在浏览器里是「键 → localStorage 字符串」的字典；服务端只做备份，不解析业务。
     仍然校验一次外层结构，避免把任意内容写进数据库。 */
  let parsed;
  try { parsed = JSON.parse(body.state); } catch { return respond({ error: '工作区内容无效。' }, 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return respond({ error: '工作区内容无效。' }, 400);
  }
  for (const key of Object.keys(parsed)) {
    if (!/^yl\.v1\.[A-Za-z0-9._-]{1,120}$/.test(key) || typeof parsed[key] !== 'string') {
      return respond({ error: '工作区包含非阅读模块的数据。' }, 400);
    }
  }
  const now = Date.now();
  await env.DB.prepare('INSERT INTO reading_state(owner_id,payload,updated_at) VALUES(?,?,?) ' +
    'ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
    .bind(owner, body.state, now).run();
  return respond({ ok: true, updatedAt: now });
}

async function handleStatus(request, env) {
  await ensureTables(env);
  let owner = null;
  try { owner = await ownerOf(request,env); } catch { /* 未登录也能看能力状态 */ }
  const row = owner ? await env.DB.prepare('SELECT updated_at FROM reading_state WHERE owner_id=?')
    .bind(owner).first() : null;
  return respond({
    configured: true,
    table: 'reading_state',
    scopeIsolation: true,
    savedAt: row?.updated_at || null,
    localEngine: true,
  });
}

export function isReadingApi(pathname) {
  return /^\/api\/reading\/(?:state|status|submit|attempts(?:\/[\w-]+)?)$/.test(pathname);
}

async function handleAttempts(request,env){
  await ensureTables(env);
  const owner=await ownerOf(request,env),url=new URL(request.url);
  const sql=(query,...args)=>env.DB.prepare(query).bind(...args);
  if((request.headers.get('X-Speaking-Scope')||'').startsWith('showcase_')){
    const items=['p1','b7p1','m1p1'];
    for(const [index,id] of items.entries()){
      const passage=passages.get(id),sampleId='s_demo_'+id;
      const exists=await sql('SELECT 1 FROM reading_attempts WHERE owner_id=? AND id=?',owner,sampleId).first();
      if(exists)continue;
      const questions=passage.sections.flatMap(section=>section.questions),answers=Object.fromEntries(questions.map((q,i)=>[q.id,i%4===0?'':i%4===1?'sample-error':String(q.answer.value)]));
      const grade=gradePassage(passage,answers),at=Date.now()-(index+1)*86400000;
      const session={...grade,id:sampleId,passageId:id,passageTitle:passage.title,passageLabel:passage.label,
        startedAt:at-720000,finishedAt:at,durationMs:720000,band:bandFor(grade.correct,grade.total),answers,
        paragraphs:passage.paragraphs.map(p=>p.text),paragraphMap:Object.fromEntries(passage.paragraphs.map(p=>[p.id,p.text])),retakeOf:null,isExample:true};
      await sql('INSERT OR IGNORE INTO reading_attempts VALUES(?,?,?,?,?)',owner,sampleId,id,JSON.stringify(session),at).run();
    }
  }
  if(request.method==='GET'){
    const id=url.pathname.slice('/api/reading/attempts/'.length);
    if(url.pathname==='/api/reading/attempts'){
      const result=await sql('SELECT payload FROM reading_attempts WHERE owner_id=? ORDER BY created_at DESC LIMIT 300',owner).all();
      return respond({items:result.results.map(r=>JSON.parse(r.payload))});
    }
    const row=await sql('SELECT payload FROM reading_attempts WHERE owner_id=? AND id=?',owner,id).first();
    return row?respond({session:JSON.parse(row.payload)}):respond({error:'这份阅读记录不存在。'},404);
  }
  if(request.method!=='POST'||url.pathname!=='/api/reading/submit')return respond({error:'不支持该操作。'},405);
  if(!sameSite(request)||request.headers.get('Origin')!==url.origin)return respond({error:'请从本站交卷。'},403);
  if(!request.headers.get('Content-Type')?.includes('application/json'))return respond({error:'需要 JSON 作答。'},415);
  const body=await request.text();
  if(body.length>40000)return respond({error:'作答内容过长。'},413);
  let input;try{input=JSON.parse(body)}catch{return respond({error:'作答格式无效。'},400)}
  const passage=passages.get(input?.passageId);
  if(!passage||!/^s_[\w-]{1,100}$/.test(input?.id)||!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers))return respond({error:'请从有效的篇章练习交卷。'},400);
  const questions=new Set(passage.sections.flatMap(section=>section.questions.map(q=>q.id)));
  const answers={};
  for(const [id,value] of Object.entries(input.answers).sort(([a],[b])=>a.localeCompare(b))){
    if(!questions.has(id)||typeof value!=='string'||value.length>500)return respond({error:'题号或答案格式无效。'},400);
    answers[id]=value.trim();
  }
  const prior=await sql('SELECT payload FROM reading_attempts WHERE owner_id=? AND id=?',owner,input.id).first();
  if(prior){
    const saved=JSON.parse(prior.payload);
    if(saved.passageId!==input.passageId||JSON.stringify(saved.answers)!==JSON.stringify(answers))return respond({error:'这份作答已经交卷，请重新开始一篇练习。'},409);
    return respond({session:saved});
  }
  const now=Date.now(),startedAt=Number.isSafeInteger(input.startedAt)&&input.startedAt>now-30*86400000&&input.startedAt<=now?input.startedAt:now;
  const grade=gradePassage(passage,answers);
  const previous=await sql('SELECT id FROM reading_attempts WHERE owner_id=? AND passage=? ORDER BY created_at DESC LIMIT 1',owner,passage.id).first();
  const session={...grade,id:input.id,passageId:passage.id,passageTitle:passage.title,passageLabel:passage.label,
    startedAt,finishedAt:now,durationMs:now-startedAt,band:bandFor(grade.correct,grade.total),answers,
    paragraphs:passage.paragraphs.map(p=>p.text),paragraphMap:Object.fromEntries(passage.paragraphs.map(p=>[p.id,p.text])),retakeOf:previous?.id||null};
  await sql('INSERT OR IGNORE INTO reading_attempts VALUES(?,?,?,?,?)',owner,session.id,passage.id,JSON.stringify(session),now).run();
  const stored=await sql('SELECT payload FROM reading_attempts WHERE owner_id=? AND id=?',owner,session.id).first();
  const result=JSON.parse(stored.payload);
  if(JSON.stringify(result.answers)!==JSON.stringify(answers))return respond({error:'这份作答已经交卷，请重新开始一篇练习。'},409);
  return respond({session:result});
}

export async function handleReadingApi(request, env) {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === '/api/reading/state') return await handleState(request, env);
    if (pathname === '/api/reading/status') return await handleStatus(request, env);
    if(pathname==='/api/reading/submit'||pathname.startsWith('/api/reading/attempts'))return await handleAttempts(request,env);
    return respond({ error: '接口不存在。' }, 404);
  } catch (cause) {
    if (!cause.status) console.error('Reading service:', cause?.name || cause);
    return respond({ error: cause.status ? cause.message : '阅读服务暂时不可用，请稍后重试。' }, cause.status || 500);
  }
}
