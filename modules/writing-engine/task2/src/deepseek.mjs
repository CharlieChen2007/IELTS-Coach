import { AlgorithmError } from './errors.mjs';
import { task2EvaluationSchema } from './task2-contracts.mjs';
/* task1/task2/scoring 各自声明了 AlgorithmError，跨模块 instanceof 恒为 false。
   这里按结构判定，避免调用方包装出来的同构错误被误判成网络故障而丢失错误码。 */
const TOP_LEVEL_FIELDS = Object.keys(task2EvaluationSchema.properties);
const isAlgorithmError = error => Boolean(error) && error.name === 'AlgorithmError' && typeof error.code === 'string' && Array.isArray(error.details);
/* 模型常见的三类语法瑕疵：少闭合括号、多闭合括号、对象/数组末尾多一个逗号。
   这里只做语法层面的修复；内容是否可信仍由调用方 validate 判定，绝不猜业务字段。 */
function scanStructure(text){
  let inStr=false,esc=false;const stack=[];let extraClose=false;
  for(const ch of text){
    if(inStr){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inStr=false;continue;}
    if(ch==='"')inStr=true;
    else if(ch==='{'||ch==='[')stack.push(ch);
    else if(ch==='}'||ch===']'){if(!stack.length)extraClose=true;else stack.pop();}
  }
  return {stack,inStr,extraClose};
}
function stripTrailingCommas(text){
  let out='',inStr=false,esc=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inStr){out+=ch;if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inStr=false;continue;}
    if(ch==='"'){inStr=true;out+=ch;continue;}
    if(ch===','){let j=i+1;while(j<text.length&&/\s/.test(text[j]))j++;if(text[j]==='}'||text[j]===']')continue;}
    out+=ch;
  }
  return out;
}
function closeUnbalanced(text){
  const {stack,inStr,extraClose}=scanStructure(text);
  const needsWork=stack.length>0||inStr||extraClose;
  if(!needsWork&&!/,\s*[}\]]/.test(text))return null;
  let out=stripTrailingCommas(text);
  if(extraClose){
    // 末尾多余的闭合括号：按结构计数截断到最后一个合法位置。
    const {stack:st2}=scanStructure(out);
    if(st2.length)for(let i=st2.length-1;i>=0;i--)out+=st2[i]==='{'?'}':']';
  }else{
    if(inStr)out+='"';
    for(let i=stack.length-1;i>=0;i--)out+=stack[i]==='{'?'}':']';
  }
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
  const usage = { promptTokens: 0, completionTokens: 0 }; let hint = null;
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      /* 重试提示必须是可执行的：把上次缺的顶层字段直接点名，要求一次性写完；
         只给一句「请返回完整对象」时模型会重复同一种省略。 */
      const requestMessages = hint ? [...messages, { role: 'user', content: JSON.stringify({
        validationFailure: hint,
        requiredTopLevelFields: TOP_LEVEL_FIELDS,
        lastInterruptedAt: hint.interruptedAt ?? null,
        action: '上一次输出没有包含全部顶层字段，在 ' + (hint.interruptedAt ? '「' + hint.interruptedAt + '」附近' : '中途') + ' 提前结束了 JSON。这次必须从第一个字段一直写到最后一个字段，' + TOP_LEVEL_FIELDS.join('、') + ' 一个都不能省略。' +
          '如果担心篇幅，就压缩每个字段的文字说明（reason/summary/note 各写一两句），但绝不能省略字段本身；sentences 必须为原稿每一句都给出条目。评分仍需基于原稿，不得为迎合校验而改分。',
      }) }] : messages;
      try {
        const response = await fetcher(config.endpoint, { method: 'POST', redirect: 'error', signal: combined, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: requestMessages, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: attempt === 1 ? 0 : 0.4, stream: false, max_tokens: maxTokens }) });
        if (!response.ok) {
          await response.body?.cancel();
          const code = ({ 400: 'AI_REQUEST_REJECTED', 401: 'AI_KEY_REJECTED', 402: 'AI_BALANCE_INSUFFICIENT', 403: 'AI_ACCESS_DENIED', 404: 'AI_MODEL_UNAVAILABLE', 429: 'AI_RATE_LIMITED' })[response.status] || 'AI_UNAVAILABLE';
          throw new AlgorithmError(code, 'DeepSeek 调用未成功，请检查服务端配置或稍后重试。', { retryable: response.status === 429 || response.status >= 500 });
        }
        const raw = await response.json(); const choice = raw.choices?.[0];
        for (const [out, source] of [['promptTokens', 'prompt_tokens'], ['completionTokens', 'completion_tokens']]) if (Number.isFinite(raw.usage?.[source]) && raw.usage[source] >= 0) usage[out] += raw.usage[source];
        if (choice?.finish_reason !== 'stop') throw new AlgorithmError('INVALID_OUTPUT', '模型输出不完整。', { retryable: true, details: [{ rule: 'finish_reason', observed: String(choice?.finish_reason), completionTokens: raw.usage?.completion_tokens ?? null }] });
        const content = choice.message?.content;
        if (typeof content !== 'string' || !content.trim() || content.length > 400000) throw new AlgorithmError('INVALID_OUTPUT', '模型输出为空或过长。', { retryable: true });
        let json;
        const body = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
        try { json = JSON.parse(body); }
        catch (error) {
          const closed = closeUnbalanced(body);
          if (closed) { try { json = JSON.parse(closed); } catch {} }
          if (json !== undefined) { const fixed = validate(json); return { data: fixed, generation: { requestedModel: config.model, responseModel: typeof raw.model === 'string' ? raw.model.slice(0, 120) : config.model, attempts: attempt, generatedAt: new Date().toISOString(), usage } }; } const at = /position (\d+)/.exec(String(error?.message)); const missing = TOP_LEVEL_FIELDS.filter(key => !content.includes('"' + key + '"')); throw new AlgorithmError('INVALID_OUTPUT', '模型 JSON 语法无效。', { retryable: true, details: [{path:'$',rule:'json_syntax',finishReason:choice.finish_reason,characterCount:content.length,errorPosition:at?Number(at[1]):null,missingFields:missing,interruptedAt:content.slice(-160),instruction:'上一次输出缺少顶层字段或在中途中断。请一次性返回全部顶层字段（' + TOP_LEVEL_FIELDS.join(', ') + '）的完整 JSON；不可猜补缺失的评分或证据。'}] }); }
        const data = validate(json);
        return { data, generation: { requestedModel: config.model, responseModel: typeof raw.model === 'string' ? raw.model.slice(0, 120) : config.model, attempts: attempt, generatedAt: new Date().toISOString(), usage } };
      } catch (error) {
        if (isAlgorithmError(error) && error.code === 'INVALID_OUTPUT' && attempt < 3 && !combined.aborted) {
          const first = error.details?.[0] ?? {};
          hint = { message: error.message.slice(0, 600), violations: error.details.slice(0, 12), interruptedAt: first.interruptedAt ?? null, missingFields: first.missingFields ?? null };
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (combined.aborted) throw new AlgorithmError(signal?.aborted ? 'CANCELLED' : 'AI_TIMEOUT', '批改已取消或超时，未生成有效结果。', { retryable: true });
    if (isAlgorithmError(error)) throw error;
    // 网络层异常不带信息会导致线上无法定位；只暴露底层错误码，不暴露 URL 或凭据。
    const netCode = String(error?.cause?.code || error?.code || error?.name || 'unknown').slice(0, 60);
    throw new AlgorithmError('AI_NETWORK_ERROR', 'AI 响应读取失败或网络暂不可用。', { retryable: true, details: [{ rule: 'network', code: netCode }] });
  } finally { clearTimeout(timer); }
}
