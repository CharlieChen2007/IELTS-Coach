import { evaluateTencent } from './tencent-soe.mjs';
import { speakingOwner } from './speaking-identity.mjs';
import { saveSoeEvidence } from './speaking-evidence.mjs';

function configured(env) {
  return /^\d+$/.test(String(env.TENCENT_APP_ID || '').trim()) &&
    Boolean(env.TENCENT_SECRET_ID?.trim() && env.TENCENT_SECRET_KEY?.trim());
}

function unpackAudio(audio, limit) {
  if (typeof audio !== 'string' || audio.length > Math.ceil(limit / 3) * 4 ||
      audio.length % 4 || !audio.length || /[^A-Za-z0-9+/=]/.test(audio)) return null;
  let raw;
  try { raw = atob(audio); } catch { return null; }
  if (raw.length < 6400 || raw.length % 2 || raw.length > limit ||
      raw.startsWith('RIFF') || raw.startsWith('OggS')) return null;
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function reserveRequest(request, env, kind) {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  // The platform supplies the visitor identity headers. Never save the raw address or account ID.
  const user = request.headers.get('oai-authenticated-user-id');
  const identity = user ? 'account:' + user : 'guest:' + (request.headers.get('cf-connecting-ip') || 'shared');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.TENCENT_SECRET_KEY),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('soe-quota/' + day + '/' + identity)));
  const visitor = Array.from(digest, n => n.toString(16).padStart(2,'0')).join('');
  const isWord = kind === 'word';
  const limit = (value, fallback) => /^\d{1,7}$/.test(String(value)) ? Number(value) : fallback;
  const siteLimit = isWord ? 240 : limit(env.SOE_SITE_DAILY_LIMIT, 240);
  const visitorLimit = isWord ? 24 : limit(env.SOE_VISITOR_DAILY_LIMIT, 40);
  // A single conditional write prevents simultaneous submissions exceeding either cap.
  await env.DB.prepare('DELETE FROM speaking_soe_usage WHERE usage_day < ?')
    .bind(new Date(now - 2*86400000).toISOString().slice(0,10)).run();
  const reserved = await env.DB.prepare(
    'INSERT INTO speaking_soe_usage (usage_day,kind,visitor) SELECT ?,?,? ' +
    'WHERE (SELECT COUNT(*) FROM speaking_soe_usage WHERE usage_day=? AND kind=?) < ? ' +
    'AND (SELECT COUNT(*) FROM speaking_soe_usage WHERE usage_day=? AND kind=? AND visitor=?) < ?'
  ).bind(day,kind,visitor,day,kind,siteLimit,day,kind,visitor,visitorLimit).run();
  return reserved.meta?.changes === 1;
}

export async function handleSoe(request, env, {json,readJSON}) {
  const url = new URL(request.url);
  if (url.pathname === '/api/soe/status') {
    return request.method === 'GET' ? json({available:configured(env)}) : json({error:'请用 GET 查看评测状态。'},405);
  }
  if (url.pathname !== '/api/soe/evaluate') return json({error:'找不到这个评测接口。'},404);
  if (request.method !== 'POST') return json({error:'请用 POST 提交录音。'},405);
  if (request.headers.get('Origin') !== url.origin ||
      (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
    return json({error:'请从本站页面提交录音。'},403);
  }
  if (!configured(env)) return json({error:'本站还没有配置腾讯云口语评测。',code:'SOE_UNAVAILABLE'},503);
  const input = await readJSON(request, 2561024);
  const owner=await speakingOwner(request,env);
  if(input?.context?.kind==='exam' && request.headers.has('X-Speaking-Scope') && !owner)return json({error:'当前口语身份尚未就绪，请重新进入口语后重试评测。',code:'SOE_OWNER_REQUIRED'},401);
  const word = input?.word === undefined ? null : input.word;
  if (word !== null && (typeof word !== 'string' || word.length > 64 || !/^[a-z]+(?:['-][a-z]+)*$/i.test(word))) {
    return json({error:'请选择一个英文单词跟读。'},400);
  }
  const pcm = unpackAudio(input?.audio, (word ? 15 : 60)*32000);
  if (!pcm) return json({error:word ? '请提交 0.2 至 15 秒的单词跟读录音。' : '请提交 0.2 至 60 秒的英语录音。'},400);
  let contextKey='';
  if(input?.context!==undefined){
    const c=input.context,validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
    if(word!==null||!owner||c?.kind!=='exam'||!validId(c.sessionId)||!validId(c.questionId)||!Number.isInteger(c.segmentIndex)||!Number.isInteger(c.segmentCount)||c.segmentCount<1||c.segmentCount>16||c.segmentIndex<0||c.segmentIndex>=c.segmentCount)return json({error:'模考语音证据只能绑定本人整段回答与有效题号。',code:'SOE_INVALID_CONTEXT'},400);
    const saved=await env.DB.prepare('SELECT metadata_json FROM speaking_sessions WHERE owner_id=? AND session_id=? AND ready=1').bind(owner,c.sessionId).first();
    if(!saved)return json({error:'等待本场封卷同步后自动评测。',code:'SOE_SESSION_PENDING'},409);
    const turn=JSON.parse(saved.metadata_json).turns.find(turn=>turn.questionId===c.questionId);
    if(!turn)return json({error:'这份已封卷答卷没有该题录音。',code:'SOE_QUESTION_NOT_FOUND'},400);
    contextKey='/exam/'+c.sessionId+'/'+c.questionId+'/'+c.segmentIndex+'/'+c.segmentCount;
  }
  let receipt;
  const started = Date.now();
  if (input.requestId !== undefined) {
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId) || typeof input.requestId !== 'string') return json({error:'评测编号无效。'},400);
    // Retrieving a result requires the random submission ID and exactly the original audio.
    const audioHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pcm)), b=>b.toString(16).padStart(2,'0')).join('');
    receipt = (owner?owner+'/':'') + input.requestId + '/' + audioHash + '/' + (word || '')+contextKey;
    await env.DB.prepare('DELETE FROM speaking_soe_receipts WHERE reserved_at < ? AND NOT EXISTS(SELECT 1 FROM speaking_soe_evidence e WHERE e.request_key=speaking_soe_receipts.request_key)').bind(started - 7*86400000).run();
    const lock = await env.DB.prepare('INSERT INTO speaking_soe_receipts(request_key,reserved_at) VALUES(?,?) ON CONFLICT(request_key) DO UPDATE SET reserved_at=excluded.reserved_at WHERE result_json IS NULL AND reserved_at < ?')
      .bind(receipt, started, started-120000).run();
    if (!lock.meta?.changes) {
      const prior = await env.DB.prepare('SELECT result_json FROM speaking_soe_receipts WHERE request_key=?').bind(receipt).first();
      if(prior?.result_json){const result=JSON.parse(prior.result_json);await saveSoeEvidence(env,owner,input,receipt,pcm,result);return json(result);}
      return json({error:'评测进行中。',code:'SOE_IN_PROGRESS'},409);
    }
  }
  const release = async () => {
    if (receipt) await env.DB.prepare('DELETE FROM speaking_soe_receipts WHERE request_key=? AND reserved_at=? AND result_json IS NULL').bind(receipt,started).run();
  };
  if (!await reserveRequest(request, env, word ? 'word' : 'passage')) {
    await release();
    return json({error:'今日演示评测次数已用完，请明天再试。',code:'SOE_DAILY_LIMIT'},429);
  }
  try {
    const result = await evaluateTencent(env, {pcm,word});
    if (receipt) await env.DB.prepare('UPDATE speaking_soe_receipts SET result_json=? WHERE request_key=? AND reserved_at=?').bind(JSON.stringify(result),receipt,started).run();
    await saveSoeEvidence(env,owner,input,receipt,pcm,result);
    return json(result);
  } catch (err) {
    await release();
    // Match only our own actionable errors; never expose third-party text or a signed URL.
    const msg = err?.message || '';
    if (/^腾讯云(?:未识别到有效语音|未返回可用的语音评分|无法评测这个参考词)/.test(msg)) {
      return json({error:'这段录音没有得到有效评分，请检查麦克风后重新录一段清晰的英语。',code:'SOE_NO_SCORE'},422);
    }
    return json({error:'腾讯云未能完成评测。可稍后重试；如持续失败，请管理员检查口语评测权限、额度与服务连接。',code:'SOE_UPSTREAM'},502);
  }
}
