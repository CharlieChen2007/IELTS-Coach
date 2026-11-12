import { anchorSentences, sha256 } from '../src/text.mjs';
import { CRITERIA } from '../src/contracts.mjs';

// Synthetic contract fixture, not an examiner-rated or real chart sample.
export const essay = `The bar chart compares the percentage of commuters using buses in two cities, A and B, in 2010 and 2020.

Overall, bus use increased in both places during the period, although the proportion in city A remained higher than that in city B.

In city A, the figure rose from 40% in 2010 to 60% in 2020, an increase of 20 percentage points over the decade. City B followed the same upward pattern, with its share growing from 20% to 30%, representing a smaller increase of ten percentage points. At the start of the period, the difference between the two cities was 20 percentage points, while it had widened to 30 points by the final year.

Despite the different absolute increases, the proportional rise was identical in the two cities, at 50% of their initial values. The share in city A was also exactly twice that in city B in each of the two years shown.`;

export const input = () => ({ questionId: 'T1-001', submissionId: 'fixture-first', text: essay, mode: 'essay' });
export function question() {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const image = { imageId: 'image-1', mimeType: 'image/png', sha256: sha256(bytes), dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
  const q = { questionId: 'T1-001', prompt: 'Synthetic testing placeholder; not a real graph.', images: [image] };
  return { ...q, fingerprint: sha256(JSON.stringify([q.questionId, q.prompt, image.sha256])) };
}
export function source() {
  return {
    readability: 'clear', chartTypes: ['bar'], questionQuality: { alignment: 'aligned', instructions: 'standard', issues: [] },
    panels: [{ id: 'p1', kind: 'bar', description: '测试柱状图' }],
    facts: [
      { id: 'f1', panelId: 'p1', kind: 'value', statement: 'A: 40% in 2010, 60% in 2020.', location: '测试数据A', confidence: 'high', approximate: false },
      { id: 'f2', panelId: 'p1', kind: 'value', statement: 'B: 20% in 2010, 30% in 2020.', location: '测试数据B', confidence: 'high', approximate: false },
    ],
    keyFeatures: [{ id: 'k1', description: '两地均上升', factIds: ['f1', 'f2'] }, { id: 'k2', description: 'A始终为B两倍', factIds: ['f1', 'f2'] }], uncertainties: [],
  };
}
export function feedback(request = input()) {
  const anchors = anchorSentences(request.text, request.submissionId);
  return {
    assessmentMode: 'full', assessmentNote: '合成测试结果，非真实评分。', sourceReview: { imageAgreement: 'confirmed', reason: '合成数据一致' },
    overview: { status: 'clear', sentenceIds: [anchors[1].id], reason: '概述有趋势和比较' },
    coverage: ['k1', 'k2'].map(featureId => ({ featureId, status: 'covered', sentenceIds: [anchors[1].id], reason: '覆盖测试要点' })),
    checks: [{ sentenceId: anchors[2].id, quote: '40%', verdict: 'supported', factIds: ['f1'], reason: '与测试值一致', impact: 'none', confidence: 'high' }],
    scores: Object.fromEntries(CRITERIA.map(key => [key, { band: 7, reason: '测试四维估分', evidenceSentenceIds: [anchors[1].id, anchors[2].id], nextStep: '核查关键比较' }])),
    sentences: anchors.map(a => ({ id: a.id, status: 'keep', issueType: 'none', reason: '表达准确', suggestion: a.text, factIds: [], redundantWithSentenceId: null })),
    review: { decision: 'ready', summary: '没有待处理实质问题', resolved: [], remainingIssues: [] },
    modelAnswer: { text: essay, factIds: ['f1', 'f2'], note: '合成示例，非真实图表答案' },
    nextPractice: { skill: 'comparison', instruction: '改用另一组数据写一句倍数比较', successCriteria: ['单位正确', '保持比较对象一致'], evidenceSentenceIds: [anchors.at(-1).id] },
  };
}
export const env = { DEEPSEEK_API_KEY: 'mock-key-not-a-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
export const response = (data, overrides = {}) => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 20, completion_tokens: 30 }, ...overrides }), { status: 200, headers: { 'Content-Type': 'application/json' } });
