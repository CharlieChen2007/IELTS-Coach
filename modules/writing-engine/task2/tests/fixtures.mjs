// Shared HTTP test mocks only; no Task 1 test data.
export const env = { DEEPSEEK_API_KEY: 'mock-key-not-a-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
export const response = (data, overrides = {}) => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 20, completion_tokens: 30 }, ...overrides }), { status: 200, headers: { 'Content-Type': 'application/json' } });
