import { readFile } from 'node:fs/promises';
import { AlgorithmError } from './errors.mjs';
import { assertSchema, requestSchema, analysisSchema, evaluationSchema, scoreRecordSchema, VERSION, RUBRIC_VERSION, CRITERIA } from './contracts.mjs';
import { anchorSentences, countWords, sha256, revisionBudget } from './text.mjs';
import { validateAnalysis, validateEvaluation, sourceReady } from './validation.mjs';
import { getConfig, requestJson } from './deepseek.mjs';

const sourcePrompt = await readFile(new URL('../prompts/task1-source.md', import.meta.url), 'utf8');
const evaluationPrompt = await readFile(new URL('../prompts/task1-evaluate.md', import.meta.url), 'utf8');
export const PROMPT_VERSION = sha256(sourcePrompt + evaluationPrompt).slice(0, 16);
export { AlgorithmError, anchorSentences, countWords, revisionBudget };

function checkQuestion(question) {
  if (!question || !/^T1-\d{3}$/.test(question.questionId) || typeof question.prompt !== 'string' || !question.prompt.trim() || question.prompt.length > 10000 || !Array.isArray(question.images) || !question.images.length || question.images.length > 6) throw new AlgorithmError('INVALID_QUESTION', '需要服务端题库题干和图像。');
  for (const image of question.images) {
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 12 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl)) throw new AlgorithmError('INVALID_QUESTION', '图表必须由可信题库加载为 PNG data URL。');
    const bytes = Buffer.from(image.dataUrl.split(',')[1], 'base64');
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || sha256(bytes) !== image.sha256) throw new AlgorithmError('INVALID_QUESTION', '图表内容与校验值不一致。');
  }
  const expected = sha256(JSON.stringify([question.questionId, question.prompt, ...question.images.map(i => i.sha256)]));
  if (question.fingerprint !== expected) throw new AlgorithmError('INVALID_QUESTION', '题干与图像指纹不匹配。');
  return question;
}
const imageBlocks = question => question.images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'original' } }));
const factsForModel = artifact => artifact.analysis;

export function buildSourceMessages(question) {
  return [{ role: 'system', content: sourcePrompt }, { role: 'user', content: [{ type: 'text', text: JSON.stringify({ questionId: question.questionId, prompt: question.prompt, sourceTypeHint: question.sourceTypeHint ?? '', schema: analysisSchema }) }, ...imageBlocks(question)] }];
}
export function buildEvaluationMessages(input, question, artifact) {
  return [{ role: 'system', content: evaluationPrompt }, { role: 'user', content: [{ type: 'text', text: JSON.stringify({ questionId: question.questionId, prompt: question.prompt, sourceAnalysis: factsForModel(artifact), sourceReady: sourceReady(artifact.analysis), mode: input.mode, essay: input.text, sentences: anchorSentences(input.text, input.submissionId), wordCount: countWords(input.text), budget: revisionBudget(input), revisionContext: input.revisionContext ?? null, schema: evaluationSchema }) }, ...imageBlocks(question)] }];
}

export async function analyzeTask1Question(question, { env = process.env, fetcher = fetch, signal } = {}) {
  checkQuestion(question); const config = getConfig(env);
  const response = await requestJson({ config, messages: buildSourceMessages(question), validate: validateAnalysis, maxTokens: 10000, fetcher, signal });
  return { schemaVersion: VERSION, kind: 'task1-source-analysis', questionId: question.questionId, sourceFingerprint: question.fingerprint, promptVersion: PROMPT_VERSION, analysisId: sha256(JSON.stringify([question.fingerprint, config.model, PROMPT_VERSION, response.data])), analysis: response.data, generation: response.generation, humanVerified: false };
}

function validateArtifact(artifact, question, model) {
  const reference = artifact?.origin === 'reference';
  if (artifact?.schemaVersion !== VERSION || artifact?.questionId !== question.questionId || artifact?.sourceFingerprint !== question.fingerprint || artifact?.promptVersion !== PROMPT_VERSION || !reference && artifact?.generation?.requestedModel !== model) throw new AlgorithmError('SOURCE_STALE', '读图结果与当前题目、模型或提示词版本不匹配，请重新读图。');
  validateAnalysis(artifact.analysis);
  const fingerprint = sha256(JSON.stringify([question.fingerprint, reference ? 'reference' : model, PROMPT_VERSION, artifact.analysis]));
  if (artifact.analysisId !== fingerprint) throw new AlgorithmError('SOURCE_STALE', '读图结果内容已经变化，不能沿用旧分析编号。');
}

/** Trusted server resource only; never accept a client-supplied fact sheet. */
export function createReferenceArtifact(question, reference) {
  checkQuestion(question); validateAnalysis(reference.analysis);
  if (reference.questionId !== question.questionId || reference.sourceFingerprint !== question.fingerprint || !['agent_visual_review', 'human_review'].includes(reference.review?.kind) || !reference.review?.id || !reference.review?.reviewedAt) throw new AlgorithmError('SOURCE_STALE', '参考事实与当前题图指纹或审核元数据不匹配。');
  return { schemaVersion: VERSION, kind: 'task1-source-analysis', origin: 'reference', questionId: question.questionId, sourceFingerprint: question.fingerprint, promptVersion: PROMPT_VERSION, analysisId: sha256(JSON.stringify([question.fingerprint, 'reference', PROMPT_VERSION, reference.analysis])), analysis: structuredClone(reference.analysis), generation: { requestedModel: null, responseModel: null, attempts: 0, generatedAt: reference.review.reviewedAt, usage: { promptTokens: 0, completionTokens: 0 } }, review: structuredClone(reference.review), humanVerified: reference.review.kind === 'human_review' };
}

export function aggregateTask1(scores) {
  const vector = Object.fromEntries(CRITERIA.map(k => [k, scores[k].band]));
  if (Object.values(vector).some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > 9 || v * 2 !== Math.round(v * 2)))) throw new AlgorithmError('INVALID_SCORE', '四维分数必须为0–9、0.5步长或null。');
  if (Object.values(vector).some(v => v === null)) return { criteria: vector, unroundedMean: null, displayBand: null };
  const unroundedMean = Object.values(vector).reduce((sum, v) => sum + v, 0) / 4;
  return { criteria: vector, unroundedMean, displayBand: Math.round(unroundedMean * 2) / 2 };
}

function checkAttempt(input, trustedAttempt = { role: 'unverified', recordId: null }) {
  if (!trustedAttempt || !['first', 'revision', 'unverified'].includes(trustedAttempt.role) || trustedAttempt.role !== 'unverified' && (typeof trustedAttempt.recordId !== 'string' || !trustedAttempt.recordId.trim() || trustedAttempt.recordId.length > 200)) throw new AlgorithmError('INVALID_ATTEMPT', '稿次元数据必须来自调用方可信提交记录。');
  if (trustedAttempt.recordId != null && (typeof trustedAttempt.recordId !== 'string' || !trustedAttempt.recordId.trim() || trustedAttempt.recordId.length > 200)) throw new AlgorithmError('INVALID_ATTEMPT', '提交记录编号无效。');
  if (input.revisionContext && trustedAttempt.role === 'first') throw new AlgorithmError('INVALID_ATTEMPT', '带复批上下文的提交不能声明为首稿。');
}

function checkInput(rawInput, question, trustedAttempt) {
  const input = assertSchema(requestSchema, rawInput, 'INVALID_INPUT'); checkQuestion(question); checkAttempt(input, trustedAttempt);
  if (input.questionId !== question.questionId || countWords(input.text) > 1200) throw new AlgorithmError('INVALID_INPUT', '题号不一致或作文超过本版本1200词的处理上限。');
  const anchors = anchorSentences(input.text, input.submissionId);
  if (!anchors.length || anchors.length > 100) throw new AlgorithmError('INVALID_INPUT', '需要1–100个可定位的句子。');
  return { input, anchors };
}

export function buildTask1Result(input, question, artifact, feedback, generation, trustedAttempt = { role: 'unverified', recordId: null }) {
  checkAttempt(input, trustedAttempt);
  const aggregate = feedback.assessmentMode === 'full' ? aggregateTask1(feedback.scores) : { criteria: Object.fromEntries(CRITERIA.map(k => [k, feedback.scores[k].band])), unroundedMean: null, displayBand: null };
  const anchors = anchorSentences(input.text, input.submissionId), map = new Map(feedback.sentences.map(s => [s.id, s]));
  const issueCounts = Object.fromEntries([...new Set(feedback.sentences.filter(s => s.issueType !== 'none').map(s => s.issueType))].map(type => [type, feedback.sentences.filter(s => s.issueType === type).length]));
  const essayHash = sha256(input.text);
  return {
    schemaVersion: VERSION, task: 'task1', questionId: question.questionId, submissionId: input.submissionId,
    textHash: essayHash, wordCount: countWords(input.text), underlength: countWords(input.text) < 150,
    source: { origin: artifact.origin ?? 'model', sourceFingerprint: question.fingerprint, analysisId: artifact.analysisId, analysis: artifact.analysis, generation: artifact.generation, humanVerified: artifact.humanVerified === true, review: artifact.review ?? null },
    feedback: { ...feedback, sentences: anchors.map(anchor => ({ ...anchor, ...map.get(anchor.id) })) },
    assessment: { ...aggregate, scope: 'single_task_practice_estimate', officialResult: false, rubricVersion: RUBRIC_VERSION, criterionWeights: [0.25, 0.25, 0.25, 0.25], displayRounding: 'nearest_half_band_product_display', statisticallyCalibrated: false },
    scoreRecord: assertSchema(scoreRecordSchema, { schemaVersion: 'writing-score-source-v1', task: 'task1', questionId: question.questionId, submissionId: input.submissionId, textHash: essayHash, sourceFingerprint: question.fingerprint, criteria: aggregate.criteria, unroundedMean: aggregate.unroundedMean, displayBand: aggregate.displayBand, draftRole: trustedAttempt.role, trustedRecordId: trustedAttempt.recordId ?? null, firstDraftCandidate: trustedAttempt.role === 'first' && aggregate.unroundedMean !== null, sourceOfDraftRole: 'caller_must_resolve_from_persisted_submission', sourceOrigin: artifact.origin ?? 'model', referenceReviewKind: artifact.review?.kind ?? null, sourceHumanVerified: artifact.humanVerified === true, calibrationStatus: 'not_calibrated_against_examiner_scores', promptVersion: PROMPT_VERSION, rubricVersion: RUBRIC_VERSION, assessedAt: generation.generatedAt }),
    featureSignals: { chartTypes: artifact.analysis.chartTypes, sourceTopicHint: question.topicHint ?? null, overview: feedback.overview.status, coverage: feedback.coverage.map(c => ({ featureId: c.featureId, status: c.status })), issueCounts, confirmedFactErrors: feedback.checks.filter(c => c.verdict === 'contradicted').length, unresolvedFactChecks: feedback.checks.filter(c => c.verdict === 'unverifiable').length },
    revisionBudget: revisionBudget(input), generation,
  };
}

export async function evaluateTask1(rawInput, question, artifact, options = {}) {
  const { input, anchors } = checkInput(rawInput, question, options.trustedAttempt);
  const config = getConfig(options.env ?? process.env); validateArtifact(artifact, question, config.model);
  const response = await requestJson({ config, messages: buildEvaluationMessages(input, question, artifact), validate: data => validateEvaluation(data, { input, source: artifact.analysis, anchors }), fetcher: options.fetcher ?? fetch, signal: options.signal });
  return buildTask1Result(input, question, artifact, response.data, response.generation, options.trustedAttempt);
}

/** Optional process-local source cache. Persist artifacts in your own trusted store. */
export function createTask1Engine(options = {}) {
  const cache = new Map();
  const analyze = async (question, { refresh = false } = {}) => {
      checkQuestion(question); const config = getConfig(options.env ?? process.env);
      const key = `${question.fingerprint}:${config.model}:${PROMPT_VERSION}`;
      if (refresh) cache.delete(key);
      if (!cache.has(key)) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        const promise = analyzeTask1Question(question, options);
        cache.set(key, promise);
        promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
      }
      return structuredClone(await cache.get(key));
  };
  return {
    analyze,
    async evaluate(input, question, trustedAttempt) {
      checkInput(input, question, trustedAttempt);
      const analysis = await analyze(question);
      return evaluateTask1(input, question, analysis, { ...options, trustedAttempt });
    },
    clearSourceCache() { cache.clear(); },
  };
}

export function applyTask1Suggestion({ originalText, currentText, report, sentenceId, appliedIds = [] }) {
  if (sha256(originalText) !== report.textHash || new Set(appliedIds).size !== appliedIds.length) throw new AlgorithmError('DRAFT_CONFLICT', '原稿或已采用记录不匹配。');
  const byId = new Map(report.feedback.sentences.map(s => [s.id, s]));
  for (const item of byId.values()) {
    if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > originalText.length || originalText.slice(item.start, item.end) !== item.text) throw new AlgorithmError('DRAFT_CONFLICT', '批注锚点与原稿不一致。');
  }
  const selected = byId.get(sentenceId);
  if (!selected || selected.status === 'keep' || appliedIds.includes(sentenceId) || appliedIds.some(id => !byId.has(id))) throw new AlgorithmError('DRAFT_CONFLICT', '建议无效或已经采用。');
  const render = ids => ids.map(id => byId.get(id)).sort((a, b) => b.start - a.start).reduce((text, item) => text.slice(0, item.start) + item.suggestion + text.slice(item.end), originalText);
  if (render(appliedIds) !== currentText) throw new AlgorithmError('DRAFT_CONFLICT', '草稿有手动改动，不能安全自动替换。');
  return { text: render([...appliedIds, sentenceId]), appliedIds: [...appliedIds, sentenceId] };
}
