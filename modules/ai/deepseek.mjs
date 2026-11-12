/** Server-only DeepSeek Chat Completions adapter; never import this in a browser.
 * API: https://api-docs.deepseek.com/api/create-chat-completion/
 */
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_BASE = 'https://api.deepseek.com';
const TIMEOUT_MS = 180000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function setting(env, name) {
  const bound = env?.[name];
  // An explicitly empty binding disables/resets that setting; it must not pick
  // up an unrelated development-machine secret through process.env.
  if (env && Object.hasOwn(env, name) && bound !== undefined) return typeof bound === 'string' ? bound.trim() : '';
  const local = globalThis.process?.env?.[name];
  return typeof local === 'string' ? local.trim() : '';
}

export function getDeepSeekConfig(env = {}) {
  const key = setting(env, 'DEEPSEEK_API_KEY');
  if (!key || /[\r\n]/.test(key)) return null;
  let base;
  try { base = new URL(setting(env, 'DEEPSEEK_BASE_URL') || DEFAULT_BASE); } catch { return null; }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return null;
  const suffix = base.pathname.replace(/\/+$/, '');
  const endpoint = new URL(suffix.endsWith('/chat/completions') ? suffix : suffix + '/chat/completions', base.origin);
  const model = setting(env, 'DEEPSEEK_MODEL') || DEFAULT_MODEL;
  if (model.length > 160 || /[\r\n]/.test(model)) return null;
  return { key, endpoint: endpoint.toString(), host: base.host, model };
}

export class DeepSeekError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'DeepSeekError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) { throw new DeepSeekError(code, message, status); }
function contentPart(part) {
  if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
  const image = part?.image_url;
  if (part?.type === 'image_url' && typeof image?.url === 'string' &&
      (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image.url) || /^https:\/\/[^\s]+$/.test(image.url))) {
    if (image.detail !== undefined && !['auto', 'low', 'high', 'original'].includes(image.detail)) return null;
    return { type: 'image_url', image_url: { url: image.url, ...(image.detail ? { detail: image.detail } : {}) } };
  }
  return null;
}

function prepareMessages(messages, jsonObject) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 100) fail('AI_INVALID_REQUEST', 'AI 请求内容无效。', 400);
  const clean = messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) fail('AI_INVALID_REQUEST', 'AI 请求角色无效。', 400);
    let content = message.content;
    if (Array.isArray(content)) {
      if (!content.length) fail('AI_INVALID_REQUEST', 'AI 请求内容不能为空。', 400);
      content = content.map(contentPart);
      if (content.some(part => !part)) fail('AI_INVALID_REQUEST', 'AI 文本或图片格式无效。', 400);
    } else if (typeof content !== 'string') fail('AI_INVALID_REQUEST', 'AI 请求内容无效。', 400);
    return { role: message.role, content };
  });
  // JSON mode also needs an explicit JSON instruction; callers retain their schema.
  if (jsonObject && !clean.some(message => /json/i.test(typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join(' ')))) {
    clean.unshift({ role: 'system', content: 'Return exactly one valid JSON object. Do not include Markdown or commentary.' });
  }
  return clean;
}

function thinkingMode(value) {
  if (value === undefined || value === false || value === 'disabled' || value?.type === 'disabled') return 'disabled';
  if (value === true || value === 'enabled' || value?.type === 'enabled') return 'enabled';
  fail('AI_INVALID_REQUEST', 'AI 思考模式参数无效。', 400);
}
function tokenUsage(value) {
  const result = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
    if (Number.isFinite(value?.[key]) && value[key] >= 0) result[key] = Math.floor(value[key]);
  }
  return { prompt_tokens: 0, completion_tokens: 0, ...result };
}
function parseObject(content) {
  let data;
  try { data = JSON.parse(content); } catch { fail('AI_INVALID_JSON', 'AI 返回的 JSON 不完整或格式无效，请重试。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('AI_INVALID_JSON', 'AI 未返回要求的 JSON 对象，请重试。');
  return data;
}

async function readResponse(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail('AI_UPSTREAM_INVALID_RESPONSE', 'AI 返回内容过大，请缩短任务后重试。');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    return chunks.join('') + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Returns {content, model, usage}; jsonObject validates, but preserves JSON text. */
export async function callDeepSeekCompletion(env, messages, options = {}) {
  const config = getDeepSeekConfig(env);
  if (!config) fail('AI_NOT_CONFIGURED', 'DeepSeek 尚未配置服务端密钥。', 503);
  const jsonObject = Boolean(options.jsonObject);
  const payload = {
    model: config.model,
    messages: prepareMessages(messages, jsonObject),
    max_tokens: Math.min(32768, Math.max(1, Math.floor(Number(options.maxTokens) || 2048))),
    temperature: Math.min(2, Math.max(0, Number(options.temperature) || 0)),
    thinking: { type: thinkingMode(options.thinking) },
    stream: false,
    ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
  };
  const controller = new AbortController();
  const external = options.signal;
  const abort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, Math.min(TIMEOUT_MS, Number(options.timeoutMs) || TIMEOUT_MS)));
  try {
    if (controller.signal.aborted) fail('AI_REQUEST_ABORTED', 'AI 请求已取消。', 499);
    const response = await fetch(config.endpoint, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) fail('AI_UPSTREAM_RATE_LIMIT', 'DeepSeek 服务暂时繁忙或额度不足，请稍后重试。');
      if ([401, 403].includes(response.status)) fail('AI_UPSTREAM_AUTH_ERROR', 'DeepSeek 服务端配置暂时不可用。');
      /* 上游偶发返回非 2xx（含 5xx 与参数级 400），要保留状态码与简短原因才可定位，
         否则线上只能看到笼统的 502。这里只回传状态码与错误类型，不含正文。 */
      fail('AI_UPSTREAM_ERROR', 'DeepSeek 服务返回异常，请稍后重试。');
    }
    const text = await readResponse(response, controller.signal);
    let raw;
    try { raw = JSON.parse(text); } catch { fail('AI_UPSTREAM_INVALID_RESPONSE', 'AI 服务返回格式异常，请稍后重试。'); }
    const choice = raw?.choices?.[0];
    if (choice?.finish_reason === 'length') fail('AI_RESPONSE_TRUNCATED', 'AI 返回内容被截断，请重试或缩短任务。');
    if (choice?.finish_reason !== 'stop') fail('AI_RESPONSE_INCOMPLETE', 'AI 尚未完成完整回答，请重试。');
    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) fail('AI_EMPTY_RESPONSE', 'AI 未返回有效内容，请重试。');
    /* raw：保留 response_format=json_object 的约束，但把解析交给调用方，
       让其按自身契约重试，而不是在这里一次性判定失败。 */
    if (jsonObject && !options.raw) parseObject(content);
    return { content, model: config.model, usage: tokenUsage(raw.usage) };
  } catch (cause) {
    if (cause instanceof DeepSeekError) throw cause;
    if (timedOut) fail('AI_UPSTREAM_TIMEOUT', 'AI 响应超时，请稍后重试。', 504);
    if (external?.aborted) fail('AI_REQUEST_ABORTED', 'AI 请求已取消。', 499);
    fail('AI_UPSTREAM_UNAVAILABLE', 'AI 服务暂时无法连接，请稍后重试。');
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener('abort', abort);
  }
}

/** Returns a parsed JSON object, or throws a safe DeepSeekError. */
export async function callDeepSeekJson(env, messages, options = {}) {
  const completion = await callDeepSeekCompletion(env, messages, { ...options, jsonObject: true });
  return parseObject(completion.content);
}
