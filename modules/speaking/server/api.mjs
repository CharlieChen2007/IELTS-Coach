import { handleCoaching } from './coaching.mjs';
import { handleSoe } from './soe-route.mjs';
import { handleCampus } from './campus.mjs';
import { handleDaily } from './daily.mjs';
import { speakingOwner } from './speaking-identity.mjs';
// Hosted endpoints. The Sites gateway supplies the authenticated visitor ID.
const MiB = 1024 * 1024;
const MAX_AUDIO = 18 * MiB;
const MAX_JSON = 25 * MiB;
const MAX_METADATA = 450 * 1024;
const PAGE_SIZE = 50;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const AUDIO_TYPE = /^(?:audio\/(?:webm|ogg|mp4|aac|mpeg|wav|x-wav)|application\/octet-stream)(?:\s*;\s*codecs\s*=\s*"?[a-z0-9.,_-]+"?)?$/i;
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

class InputError extends Error {
  constructor(status, message, code = 'INVALID_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) {
  throw new InputError(400, message);
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}

function boundedString(value, limit) {
  if (typeof value !== 'string' || value.length > limit) invalid('文字字段无效或过长。');
  return value;
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid('数值字段无效。');
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) invalid('标识符无效。');
  return value;
}

async function readJSON(request, maxBytes = MAX_JSON) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new InputError(415, '请提交 JSON 数据。');
  }
  const tooLarge = new InputError(413, '这场练习的文件超过上传限制。', 'TOO_LARGE');
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw tooLarge;
  if (!request.body) invalid('缺少练习数据。');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } catch (error) {
    if (bytes > maxBytes) throw tooLarge;
    invalid('提交的数据不是有效的 JSON。');
  } finally {
    reader.releaseLock();
  }
}

// Preserve bounded v1 quality metadata. Scratch notes never enter the handoff.
function sessionFields(raw) {
  if (!raw || raw.status !== 'submitted' || !['full', 'quick'].includes(raw.mode)) invalid('只可同步已提交的模考或演练。');
  const createdAt = integer(raw.createdAt);
  const endedAt = integer(raw.endedAt, createdAt);
  const submittedAt = integer(raw.submittedAt, endedAt);
  if (typeof raw.interrupted !== 'boolean' || typeof raw.assessmentEligible !== 'boolean') invalid('练习状态无效。');
  const result = {
    id: id(raw.id), mode: raw.mode, status: 'submitted', createdAt, endedAt, submittedAt,
    durationMs: integer(raw.durationMs), interrupted: raw.interrupted, assessmentEligible: raw.assessmentEligible
  };
  for (const key of ['qualityNotes', 'interruptions', 'skipped']) {
    const values = raw[key] ?? [];
    if (!Array.isArray(values) || values.length > 512) invalid('练习记录格式无效。');
    if (key === 'qualityNotes') {
      result[key] = values.map(note => boundedString(note, 1024));
    } else {
      result[key] = values.map(event => {
        if (!event || !['part1', 'prep', 'talk', 'followup', 'part3'].includes(event.phase)) invalid('考试阶段无效。');
        const entry = { phase: event.phase, questionId: id(event.questionId) };
        if (key === 'interruptions') entry.resumedAt = integer(event.resumedAt);
        else { entry.reason = boundedString(event.reason, 64); entry.at = integer(event.at); }
        return entry;
      });
    }
  }
  const times = raw.stageDurationsMs ?? {};
  if (typeof times !== 'object' || times === null || Array.isArray(times)) invalid('练习时长格式无效。');
  result.stageDurationsMs = {};
  for (const phase of ['part1', 'prep', 'talk', 'followup', 'part3']) {
    if (Object.hasOwn(times, phase)) result.stageDurationsMs[phase] = integer(times[phase]);
  }
  return result;
}

function turnFields(turn, index) {
  if (!turn || ![1, 2, 3].includes(turn.part)) invalid('回答的考试部分无效。');
  const questionId = id(turn.questionId);
  const audio = turn.audio;
  if (!audio || audio.encoding !== 'base64' || typeof audio.data !== 'string') invalid('缺少音频内容。');
  const byteLength = integer(audio.byteLength, 1, MAX_AUDIO);
  const mimeType = boundedString(audio.mimeType, 96);
  if (!AUDIO_TYPE.test(mimeType) || turn.mimeType !== mimeType || turn.byteLength !== byteLength ||
      audio.data.length !== 4 * Math.ceil(byteLength / 3)) invalid('录音类型或长度无效。');
  const savedAt = integer(turn.savedAt);
  const result = {
    id: questionId, questionId, turnIndex: index + 1, part: turn.part, phase: boundedString(turn.phase, 12),
    prompt: boundedString(turn.prompt, 4096), durationMs: integer(turn.durationMs, 1),
    recordedAt: integer(turn.recordedAt, 0, savedAt), savedAt,
    byteLength, mimeType, transcript: boundedString(turn.transcript ?? '', 10000),
    transcriptStatus: boundedString(turn.transcriptStatus ?? 'unavailable', 64),
    transcriptSource: boundedString(turn.transcriptSource ?? 'unavailable', 64)
  };
  if (turn.cues !== undefined) {
    if (!Array.isArray(turn.cues) || turn.cues.length > 24) invalid('题卡提示无效。');
    result.cues = turn.cues.map(cue => boundedString(cue, 1024));
  }
  return result;
}

function decodeAudio(source, output, offset, length) {
  // Use small chunks so the full binary string is never also held in memory.
  const block = 64 * 1024;
  let writeAt = offset;
  try {
    for (let i = 0; i < source.length; i += block) {
      const decoded = atob(source.slice(i, i + block));
      for (let n = 0; n < decoded.length; n++) output[writeAt++] = decoded.charCodeAt(n);
    }
  } catch {
    invalid('无法解码录音。');
  }
  if (writeAt - offset !== length) invalid('录音字节数不匹配。');
}

async function hash(data) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function saveSession(request, env, userId) {
  const input = await readJSON(request);
  if (!input || input.schemaVersion !== 'speaking-a.handoff.v1' ||
      !Array.isArray(input.turns) || input.turns.length > 64) invalid('不支持的练习格式。');
  const session = sessionFields(input.session);
  session.turns = input.turns.map(turnFields);
  if (new Set(session.turns.map(t => t.questionId)).size !== session.turns.length) invalid('存在重复的题号。');
  const total = session.turns.reduce((bytes, t) => bytes + t.byteLength, 0);
  if (total > MAX_AUDIO) throw new InputError(413, '录音过大，仍可在本机导出。', 'TOO_LARGE');
  const encoder = new TextEncoder();
  const metadata = JSON.stringify(session);
  if (encoder.encode(metadata).length > MAX_METADATA) throw new InputError(413, '练习文字过长。', 'TOO_LARGE');

  const packed = new Uint8Array(total);
  let start = 0;
  for (const [i, turn] of session.turns.entries()) {
    decodeAudio(input.turns[i].audio.data, packed, start, turn.byteLength);
    input.turns[i].audio.data = '';
    start += turn.byteLength;
  }
  const fingerprint = await hash(encoder.encode(metadata + '\n' + await hash(packed)));

  // Reserve the immutable submission first. Retries share the same object key.
  // A failed R2 PUT leaves an invisible pending row which the next retry resumes.
  await env.DB.prepare(
    'INSERT INTO speaking_sessions (owner_id, session_id, created_at, submitted_at, mode, duration_ms, interrupted, assessment_eligible, turn_count, metadata_json, object_key, fingerprint, ready) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT (owner_id, session_id) DO NOTHING'
  ).bind(userId, session.id, session.createdAt, session.submittedAt, session.mode, session.durationMs,
    Number(session.interrupted), Number(session.assessmentEligible), session.turns.length,
    metadata, 'recordings/' + crypto.randomUUID(), fingerprint).run();

  const row = await env.DB.prepare(
    'SELECT object_key, fingerprint, ready FROM speaking_sessions WHERE owner_id = ? AND session_id = ?'
  ).bind(userId, session.id).first();
  if (!row) throw new Error('Missing session reservation');
  if (row.fingerprint !== fingerprint) throw new InputError(409, '此编号已对应另一份已封卷练习。', 'SESSION_CONFLICT');
  if (row.ready) return json({ session });
  if (total > 0) await env.BUCKET.put(row.object_key, packed);
  await env.DB.prepare(
    'UPDATE speaking_sessions SET ready = 1 WHERE owner_id = ? AND session_id = ? AND fingerprint = ?'
  ).bind(userId, session.id, fingerprint).run();
  return json({ session }, 201);
}

async function listSessions(url, db, userId) {
  let cursor = [];
  const token = url.searchParams.get('cursor');
  if (token !== null) {
    const match = /^(\d{1,16}):([A-Za-z0-9_-]{1,80})$/.exec(token);
    if (!match) invalid('分页标识无效。');
    cursor = [integer(Number(match[1])), match[2]];
  }
  const after = cursor.length ? ' AND (created_at, session_id) < (?, ?)' : '';
  const { results } = await db.prepare(
    'SELECT session_id AS id, created_at AS createdAt, submitted_at AS submittedAt, mode, duration_ms AS durationMs, ' +
    'interrupted, assessment_eligible AS assessmentEligible, turn_count AS turnCount FROM speaking_sessions ' +
    'WHERE owner_id = ? AND ready = 1' + after + ' ORDER BY created_at DESC, session_id DESC LIMIT ?'
  ).bind(userId, ...cursor, PAGE_SIZE + 1).all();
  const sessions = results.slice(0, PAGE_SIZE).map(row => ({
    ...row, status: 'submitted', interrupted: Boolean(row.interrupted), assessmentEligible: Boolean(row.assessmentEligible)
  }));
  const last = sessions.at(-1);
  return json({ sessions, nextCursor: results.length > PAGE_SIZE ? last.createdAt + ':' + last.id : null });
}

function audioRange(range, length) {
  if (!range) return { start: 0, end: length - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  return start <= end && start < length ? { start, end } : null;
}

function notFound() { return json({ error: '找不到这条练习记录。', code: 'NOT_FOUND' }, 404); }

async function readSession(request, env, userId, sessionId, questionId) {
  const row = await env.DB.prepare(
    'SELECT metadata_json, object_key FROM speaking_sessions WHERE owner_id = ? AND session_id = ? AND ready = 1'
  ).bind(userId, sessionId).first();
  if (!row) return notFound();
  const session = JSON.parse(row.metadata_json);
  if (!questionId) return json({ session });

  let offset = 0;
  for (const turn of session.turns) {
    if (turn.questionId !== questionId) { offset += turn.byteLength; continue; }
    const rangeHeader = request.headers.get('Range');
    const range = audioRange(rangeHeader, turn.byteLength);
    const headers = new Headers(privateHeaders);
    headers.set('Accept-Ranges', 'bytes');
    if (!range) {
      headers.set('Content-Range', 'bytes */' + turn.byteLength);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    headers.set('Content-Length', String(length));
    headers.set('Content-Type', turn.mimeType);
    if (rangeHeader) headers.set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + turn.byteLength);
    const result = { status: rangeHeader ? 206 : 200, headers };
    if (request.method === 'HEAD') return new Response(null, result);
    const audio = await env.BUCKET.get(row.object_key, { range: { offset: offset + range.start, length } });
    if (!audio || !audio.body) throw new Error('Recording unavailable');
    return new Response(audio.body, result);
  }
  return notFound();
}

export async function handleApi(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/campus/')) return await handleCampus(request, env, {json, readJSON});
    if (request.method === 'GET' && url.pathname === '/api/health') {
      await Promise.all([
        env.DB.prepare('SELECT 1 AS ok FROM speaking_sessions LIMIT 1').first(),
        env.BUCKET.head('health/ready')
      ]);
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/api/soe/')) {
      return await handleSoe(request, env, {json, readJSON});
    }
    if (url.pathname.startsWith('/api/daily/')) return await handleDaily(request, env);
    const userId = await speakingOwner(request,env);
    if (!userId) throw new InputError(401, '请先登录本站。', 'SIGN_IN_REQUIRED');
    const expected = request.headers.get('X-Speaking-Account');
    if (expected !== null && expected !== userId) throw new InputError(409, '当前登录账号已变化，请重新打开页面。', 'ACCOUNT_CHANGED');
    if (request.method === 'GET' && url.pathname === '/api/me') return json({ userId });
    if (url.pathname === '/api/practice' || url.pathname.startsWith('/api/coach/')) {
      if (request.method === 'POST' && (!expected || (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin))) {
        throw new InputError(403, '请刷新页面后从本站提交。');
      }
      return await handleCoaching(request, env, userId, {json, readJSON, id, integer, boundedString, invalid, notFound});
    }
    if (url.pathname === '/api/sessions') {
      if (request.method === 'GET') return await listSessions(url, env.DB, userId);
      if (request.method === 'POST') {
        if (!expected) throw new InputError(403, '请重新打开页面并确认当前账号。', 'ACCOUNT_REQUIRED');
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new InputError(403, '请求来源无效。');
        return await saveSession(request, env, userId);
      }
    }
    const match = /^\/api\/sessions\/([A-Za-z0-9_-]{1,80})(?:\/audio\/([A-Za-z0-9_-]{1,80}))?$/.exec(url.pathname);
    if (match && (request.method === 'GET' || (request.method === 'HEAD' && match[2]))) {
      return await readSession(request, env, userId, match[1], match[2]);
    }
    return notFound();
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message, code: error.code }, error.status);
    console.error('Speaking storage request failed', error?.name || 'Error');
    return json({ error: '云端存储暂时不可用，请稍后重试。', code: 'STORAGE_UNAVAILABLE' }, 503);
  }
}
