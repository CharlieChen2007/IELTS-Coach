import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorSentences, countWords, revisionBudget, createTask1Engine, createReferenceArtifact, aggregateTask1, evaluateTask1, applyTask1Suggestion, buildSourceMessages } from '../src/task1.mjs';
import { validateAnalysis, validateEvaluation, sourceReady } from '../src/validation.mjs';
import { requestSchema, assertSchema } from '../src/contracts.mjs';
import { getConfig, requestJson } from '../src/deepseek.mjs';
import { parseCsv } from '../src/bank.mjs';
import { input, source, question, feedback, env, response, essay } from './fixtures.mjs';

const context = (i = input(), s = source()) => ({ input: i, source: s, anchors: anchorSentences(i.text, i.submissionId) });
const bad = fn => assert.throws(fn, { code: 'INVALID_OUTPUT' });

test('synthetic fixture satisfies all contracts with evidence and equal weights', () => {
  assertSchema(requestSchema, input()); validateAnalysis(source()); validateEvaluation(feedback(), context());
  const f = feedback(); f.scores.taskAchievement.band = 6.5;
  assert.deepEqual(aggregateTask1(f.scores), { criteria: { taskAchievement: 6.5, coherenceCohesion: 7, lexicalResource: 7, grammaticalRangeAccuracy: 7 }, unroundedMean: 6.875, displayBand: 7 });
  f.scores.taskAchievement.band = null; assert.equal(aggregateTask1(f.scores).displayBand, null);
  f.scores.taskAchievement.band = 7.2; assert.throws(() => aggregateTask1(f.scores), { code: 'INVALID_SCORE' });
});
test('anchors preserve UTF-16 offsets, CRLF, decimals, paragraphs and repeated sentences', () => {
  const text = '  A rose by 3.5%. A rose by 3.5%.\r\n\r\n🚌 B fell.\r\nIt ended at 30%.  ';
  const a = anchorSentences(text, 's'); assert.equal(a.length, 4); assert.deepEqual(a.map(s => s.paragraph), [1, 1, 2, 2]);
  assert.equal(new Set(a.map(s => s.id)).size, 4); a.forEach(s => assert.equal(text.slice(s.start, s.end), s.text));
  assert.equal(countWords("10,000 3.5% don't year-on-year"), 4);
});
test('strict input excludes client model/key/score/draft-role overrides', () => {
  for (const field of ['apiKey', 'model', 'isFirstDraft', 'score']) assert.throws(() => assertSchema(requestSchema, { ...input(), [field]: 'unsafe' }, 'INVALID_INPUT'), { code: 'INVALID_INPUT' });
  assert.throws(() => assertSchema(requestSchema, { ...input(), submissionId: 'x'.repeat(101) }, 'INVALID_INPUT'), { code: 'INVALID_INPUT' });
});
test('source references and confidence gate complete scoring', () => {
  let s = source(); s.keyFeatures[0].factIds = ['missing']; bad(() => validateAnalysis(s)); assert.equal(sourceReady(s), false);
  s = source(); s.facts[0].confidence = 'low'; assert.equal(sourceReady(s), false); bad(() => validateEvaluation(feedback(), context(input(), s)));
  s = source(); s.questionQuality.alignment = 'mismatch'; bad(() => validateEvaluation(feedback(), context(input(), s)));
  s = source(); s.questionQuality.instructions = 'legacy_nonstandard'; assert.equal(sourceReady(s), false);
});
test('overview, coverage, references and actual quotes must agree with scores', () => {
  let f = feedback(); f.overview.status = 'missing'; f.overview.sentenceIds = []; bad(() => validateEvaluation(f, context()));
  f = feedback(); f.coverage.pop(); bad(() => validateEvaluation(f, context()));
  f = feedback(); f.checks[0].quote = 'not in the essay'; bad(() => validateEvaluation(f, context()));
  f = feedback(); f.sentences.pop(); bad(() => validateEvaluation(f, context()));
  f = feedback(); f.checks[0].confidence = 'low'; bad(() => validateEvaluation(f, context()));
  f = feedback(); f.sourceReview.imageAgreement = 'conflict'; bad(() => validateEvaluation(f, context()));
});
test('source unavailable retains optional language scores but no total or model answer', () => {
  const s = source(); s.readability = 'partial'; s.uncertainties = ['图像轴无法确认'];
  const f = feedback(); f.assessmentMode = 'insufficient_source'; f.scores.taskAchievement.band = null;
  f.modelAnswer = { text: '', factIds: [], note: '无法可靠生成图表答案' };
  f.review = { decision: 'revise', summary: '核查来源', resolved: [], remainingIssues: [{ sentenceId: f.sentences[0].id, issueType: 'data_accuracy', action: '先核查清晰原图' }] };
  validateEvaluation(f, context(input(), s)); assert.equal(aggregateTask1(f.scores).unroundedMean, null);
});
test('language mode never leaks full scores', () => {
  const i = { ...input(), mode: 'language' }; const f = feedback(i);
  bad(() => validateEvaluation(f, context(i)));
  f.assessmentMode = 'language_only'; Object.values(f.scores).forEach(s => s.band = null);
  f.modelAnswer = { text: '', factIds: [], note: '只检查语言' };
  f.review = { decision: 'revise', summary: '单项练习', resolved: [], remainingIssues: [{ sentenceId: f.sentences[0].id, issueType: 'comparison', action: '尝试一句比较' }] };
  validateEvaluation(f, context(i));
});
test('revision growth ceiling is anchored to first draft across repeated rounds', () => {
  const words = n => Array(n).fill('word').join(' ');
  const initialText = words(160); const current = { ...input(), text: words(178), revisionContext: { initialText, previousText: words(170), previousFocus: [], round: 3 } };
  assert.equal(revisionBudget(current).positiveGrowthBudget, 2);
  current.text = words(180); assert.equal(revisionBudget(current).positiveGrowthBudget, 0);
  current.text = words(240); assert.equal(revisionBudget(current).positiveGrowthBudget, 0);
  const f = feedback(); f.sentences[0] = { ...f.sentences[0], status: 'improve', issueType: 'cohesion', suggestion: f.sentences[0].suggestion + words(30) };
  bad(() => validateEvaluation(f, context()));
});
test('deletion cannot erase two sentences using circular redundancy', () => {
  const f = feedback(); const [a, b] = f.sentences.slice(2, 4);
  Object.assign(a, { status: 'fix', issueType: 'redundancy', suggestion: '', redundantWithSentenceId: b.id });
  Object.assign(b, { status: 'fix', issueType: 'redundancy', suggestion: '', redundantWithSentenceId: a.id });
  bad(() => validateEvaluation(f, context()));
});
test('ready rejects factual errors, missing key features or pending edits', () => {
  let f = feedback(); f.checks[0].verdict = 'contradicted'; f.checks[0].impact = 'major'; bad(() => validateEvaluation(f, context()));
  f = feedback(); f.coverage[0].status = 'missing'; f.coverage[0].sentenceIds = []; bad(() => validateEvaluation(f, context()));
  f = feedback(); f.review.resolved = ['imaginary earlier improvement']; bad(() => validateEvaluation(f, context()));
});
test('CSV handles BOM-independent quoted multiline and escaped cells', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,y","two\nlines"\r\n"a""b",z'), [['a', 'b'], ['x,y', 'two\nlines'], ['a"b', 'z']]);
  assert.throws(() => parseCsv('"unterminated'), { code: 'BANK_INVALID' });
});
test('source messages contain image and question, never student essay', () => {
  const messages = buildSourceMessages(question());
  assert.equal(messages[1].content[1].type, 'image_url'); assert.equal(JSON.stringify(messages).includes(essay), false);
});
test('source cache deduplicates calls, protects from mutation, score role is trusted separate metadata', async () => {
  let calls = 0;
  const engine = createTask1Engine({ env, fetcher: async (_url, init) => { calls++; const body = JSON.parse(init.body); const data = JSON.parse(body.messages[1].content[0].text); return response(data.essay ? feedback() : source()); } });
  const [a, b] = await Promise.all([engine.analyze(question()), engine.analyze(question())]); assert.equal(calls, 1);
  a.analysis.facts[0].statement = 'mutated'; assert.notEqual(b.analysis.facts[0].statement, a.analysis.facts[0].statement);
  const evaluate = engine.evaluate; const report = await evaluate(input(), question(), { role: 'first', recordId: 'server-record-1' });
  assert.equal(calls, 2); assert.equal(report.scoreRecord.firstDraftCandidate, true); assert.equal(report.assessment.statisticallyCalibrated, false);
  assert.equal((await engine.evaluate(input(), question())).scoreRecord.firstDraftCandidate, false);
  b.analysis.facts[0].statement = 'tamper'; await assert.rejects(() => evaluateTask1(input(), question(), b, { env }), { code: 'SOURCE_STALE' });
});
test('invalid question or trusted attempt rejects before any paid request', async () => {
  let calls = 0; const engine = createTask1Engine({ env, fetcher: async () => { calls++; return response(source()); } });
  await assert.rejects(() => engine.evaluate({ ...input(), questionId: 'T1-002' }, question()), { code: 'INVALID_INPUT' });
  await assert.rejects(() => engine.evaluate(input(), question(), { role: 'first', recordId: 42 }), { code: 'INVALID_ATTEMPT' });
  const i = { ...input(), revisionContext: { initialText: essay, previousText: essay, previousFocus: [], round: 2 } };
  await assert.rejects(() => engine.evaluate(i, question(), { role: 'first', recordId: 'first' }), { code: 'INVALID_ATTEMPT' });
  assert.equal(calls, 0);
});
test('single adoption changes only selected sentence, duplicates and manual changes conflict', async () => {
  const engine = createTask1Engine({ env, fetcher: async (_url, init) => response(JSON.parse(JSON.parse(init.body).messages[1].content[0].text).essay ? feedback() : source()) });
  const report = await engine.evaluate(input(), question()); const [a,b] = report.feedback.sentences.slice(2,4);
  a.status = b.status = 'improve'; a.suggestion = a.text.replace('rose', 'climbed'); b.suggestion = b.text.replace('followed', 'showed');
  const result = applyTask1Suggestion({ originalText: essay, currentText: essay, report, sentenceId: a.id });
  assert.ok(result.text.includes(a.suggestion)); assert.ok(result.text.includes(b.text));
  assert.throws(() => applyTask1Suggestion({ originalText: essay, currentText: result.text, report, sentenceId: a.id, appliedIds: result.appliedIds }), { code: 'DRAFT_CONFLICT' });
  assert.throws(() => applyTask1Suggestion({ originalText: essay, currentText: result.text + 'Manual.', report, sentenceId: b.id, appliedIds: result.appliedIds }), { code: 'DRAFT_CONFLICT' });
});
test('invalid model JSON gets at most two corrective retries, counted usage and complete output required', async () => {
  let calls = 0; const r = await requestJson({ config: getConfig(env), messages: [], validate: validateAnalysis, fetcher: async () => response(++calls === 1 ? {} : source()) });
  assert.equal(calls, 2); assert.equal(r.generation.usage.promptTokens, 40);
  calls = 0;
  await assert.rejects(() => requestJson({ config: getConfig(env), messages: [], validate: validateAnalysis, fetcher: async () => { calls++; return response(source(), { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }); } }), { code: 'INVALID_OUTPUT' }); assert.equal(calls, 3);
});
test('authentication errors do not retry or expose provider body', async () => {
  let calls = 0; await assert.rejects(() => requestJson({ config: getConfig(env), messages: [], validate: validateAnalysis, fetcher: async () => { calls++; return new Response('sensitive provider error', { status: 401 }); } }), e => e.code === 'AI_KEY_REJECTED' && !e.message.includes('sensitive'));
  assert.equal(calls, 1);
  assert.throws(() => getConfig({ ...env, DEEPSEEK_BASE_URL: 'https://api.deepseek.com.attacker.invalid' }), { code: 'AI_CONFIG_INVALID' });
});
test('approximate facts cannot rewrite numeric values and unverifiable claims stay unchanged', () => {
  const s = source(); s.facts.forEach(f => { f.approximate = true; f.confidence = 'medium'; });
  const f = feedback(); const item = f.sentences[2]; Object.assign(item, { status: 'fix', issueType: 'data_accuracy', suggestion: item.suggestion.replace('40%', '43%'), factIds: ['f1'] });
  bad(() => validateEvaluation(f, context(input(), s)));
  f.checks[0].verdict = 'unverifiable'; s.facts[0].approximate = false; s.facts[0].confidence = 'high';
  bad(() => validateEvaluation(f, context(input(), s)));
});
test('reference evidence is bound to the exact question and carries explicit review provenance', async () => {
  const q = question(); const ref = { questionId: q.questionId, sourceFingerprint: q.fingerprint, analysis: source(), review: { kind: 'agent_visual_review', id: 'fixture-reference', reviewedAt: '2026-11-08' } };
  const artifact = createReferenceArtifact(q, ref); assert.equal(artifact.humanVerified, false);
  const result = await evaluateTask1(input(), q, artifact, { env, fetcher: async () => response(feedback()) });
  assert.equal(result.source.origin, 'reference'); assert.equal(result.scoreRecord.referenceReviewKind, 'agent_visual_review');
  ref.sourceFingerprint = 'outdated'; assert.throws(() => createReferenceArtifact(q, ref), { code: 'SOURCE_STALE' });
});
test('short response cannot claim a complete grade', () => {
  const i = { ...input(), text: 'Sales rose. The share increased.' }; const a = anchorSentences(i.text, i.submissionId);
  const f = feedback(); f.assessmentMode = 'insufficient_response'; f.overview = { status: 'missing', sentenceIds: [], reason: '短片段' };
  f.coverage.forEach(c => { c.status = 'missing'; c.sentenceIds = []; }); f.checks = [];
  Object.values(f.scores).forEach(s => { s.band = null; s.evidenceSentenceIds = []; });
  f.sentences = a.map(s => ({ id:s.id, status:'keep', issueType:'none', reason:'表达可保留', suggestion:s.text, factIds:[], redundantWithSentenceId:null }));
  f.modelAnswer = { text:'',factIds:[],note:'证据不足' };
  f.review = { decision:'revise',summary:'请完成作答',resolved:[],remainingIssues:[{sentenceId:a[0].id,issueType:'key_features',action:'补充主要特征'}] };
  f.nextPractice.evidenceSentenceIds = [a[0].id]; validateEvaluation(f, context(i));
  f.scores.taskAchievement.band = 5; bad(() => validateEvaluation(f, context(i)));
});
