export class AlgorithmError extends Error {
  constructor(code, message, { retryable = false, details = [] } = {}) {
    super(message); this.name = 'AlgorithmError'; this.code = code; this.retryable = retryable; this.details = details;
  }
}
export function requireThat(condition, message) {
  if (!condition) throw new AlgorithmError('INVALID_OUTPUT', message, { retryable: true });
}
