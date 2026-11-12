export class AlgorithmError extends Error {
  constructor(code, message, { retryable = false, details = [] } = {}) {
    super(message); this.name = 'AlgorithmError'; this.code = code; this.retryable = retryable; this.details = details;
  }
}
export function requireThat(condition, message) {
  /* details 必须带上原因文本：否则重试日志只有空数组，无法定位是哪个约束没过，
     模型也拿不到可执行的修正提示。 */
  if (!condition) throw new AlgorithmError('INVALID_OUTPUT', message, { retryable: true, details: [{ rule: 'hard_constraint', instruction: String(message).slice(0, 600) }] });
}
