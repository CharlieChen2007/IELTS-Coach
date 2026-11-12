import { AlgorithmError } from './errors.mjs';
/* task1/task2/scoring 各自声明了 AlgorithmError，跨模块 instanceof 恒为 false。
   这里按结构判定，避免调用方包装出来的同构错误被误判成网络故障而丢失错误码。 */
const isAlgorithmError = error => Boolean(error) && error.name === 'AlgorithmError' && typeof error.code === 'string' && Array.isArray(error.details);
/* 模型偶尔少写一个闭合括号，导致整段 JSON 层级错位、解析在结尾报错。
   这里只做语法层面的补齐；内容是否可信仍由调用方 validate 判定，不猜任何业务字段。 */
function closeUnbalanced(text) {
  let inStr = false, esc = false; const stack = [];
  for (const ch of text) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') { if (!stack.length) return null; stack.pop(); }
  }
  if (!stack.length && !inStr) return null;
  let out = text;
  if (inStr) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}


export function getConfig(env) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new AlgorithmError('AI_NOT_CONFIGURED', '缺少服务端 DEEPSEEK_API_KEY。');
  let base;
  try { base = new URL(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'); } catch { throw new AlgorithmError('AI_CONFIG_INVALID', 'DeepSeek 地址格式错误。'); }
  if (base.protocol !== 'https:' || base.hostname !== 'api.deepseek.com' || base.port || base.username || base.password || base.search || base.hash || !['/', '/v1', '/v1/'].includes(base.pathname)) throw new AlgorithmError('AI_CONFIG_INVALID', '仅允许 DeepSeek 官方 HTTPS 接口。');
  const model = env.DEEPSEEK_MODEL || 'deepseek-flash';
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new AlgorithmError('AI_CONFIG_INVALID', '模型名格式错误。');
  const ms = Number(env.DEEPSEEK_TIMEOUT_MS ?? 120000);
  return { apiKey, endpoint: base.href.replace(/\/$/, '') + '/chat/completions', model, timeoutMs: Number.isFinite(ms) ? Math.max(5000, Math.min(180000, ms)) : 120000 };
}

export async function requestJson({ config, messages, validate, maxTokens = 14000, fetcher = fetch, signal }) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const usage = { promptTokens: 0, completionTokens: 0 }; let hint = '';
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const requestMessages = hint ? [...messages, { role: 'user', content: JSON.stringify({ validationFailure: hint, action: '重新检查原始素材，按 system 的 JSON 契约返回完整对象；不得补造图像数据或改变评分以迎合要求。' }) }] : messages;
      try {
        const response = await fetcher(config.endpoint, { method: 'POST', redirect: 'error', signal: combined, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: requestMessages, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0, stream: false, max_tokens: maxTokens }) });
        if (!response.ok) {
          await response.body?.cancel();
          const code = ({ 400: 'AI_REQUEST_REJECTED', 401: 'AI_KEY_REJECTED', 402: 'AI_BALANCE_INSUFFICIENT', 403: 'AI_ACCESS_DENIED', 404: 'AI_MODEL_UNAVAILABLE', 429: 'AI_RATE_LIMITED' })[response.status] || 'AI_UNAVAILABLE';
          throw new AlgorithmError(code, 'DeepSeek 调用未成功，请检查服务端配置或稍后重试。', { retryable: response.status === 429 || response.status >= 500 });
        }
        const raw = await response.json(); const choice = raw.choices?.[0];
        for (const [out, source] of [['promptTokens', 'prompt_tokens'], ['completionTokens', 'completion_tokens']]) if (Number.isFinite(raw.usage?.[source]) && raw.usage[source] >= 0) usage[out] += raw.usage[source];
        if (choice?.finish_reason !== 'stop') throw new AlgorithmError('INVALID_OUTPUT', '模型输出不完整。', { retryable: true });
        const content = choice.message?.content;
        if (typeof content !== 'string' || !content.trim() || content.length > 400000) throw new AlgorithmError('INVALID_OUTPUT', '模型输出为空或过长。', { retryable: true });
        let json;
        const body = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
        try { json = JSON.parse(body); }
        catch (error) {
          const closed = closeUnbalanced(body);
          if (closed) { try { json = JSON.parse(closed); } catch {} }
          if (json !== undefined) { const fixed = validate(json); return { data: fixed, generation: { requestedModel: config.model, responseModel: typeof raw.model === 'string' ? raw.model.slice(0, 120) : config.model, attempts: attempt, generatedAt: new Date().toISOString(), usage } }; } const at = /position (\d+)/.exec(String(error?.message)); throw new AlgorithmError('INVALID_OUTPUT', '模型 JSON 语法无效。', { retryable: true, details: ['position=' + (at ? at[1] : 'unknown'), 'interruptedAt=' + content.slice(-160), '请重新返回完整合法 JSON，并根据中断处的上下文补齐剩余字段。'] }); }
        const data = validate(json);
        return { data, generation: { requestedModel: config.model, responseModel: typeof raw.model === 'string' ? raw.model.slice(0, 120) : config.model, attempts: attempt, generatedAt: new Date().toISOString(), usage } };
      } catch (error) {
        if (isAlgorithmError(error) && error.code === 'INVALID_OUTPUT' && attempt < 3 && !combined.aborted) { hint = [error.message, ...error.details].join(' ').slice(0, 1800); continue; }
        throw error;
      }
    }
  } catch (error) {
    if (combined.aborted) throw new AlgorithmError(signal?.aborted ? 'CANCELLED' : 'AI_TIMEOUT', '批改已取消或超时，未生成有效结果。', { retryable: true });
    if (isAlgorithmError(error)) throw error;
    throw new AlgorithmError('AI_NETWORK_ERROR', 'AI 响应读取失败或网络暂不可用。', { retryable: true });
  } finally { clearTimeout(timer); }
}
