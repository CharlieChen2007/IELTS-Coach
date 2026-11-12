import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertSchema, scoreRecordSchema, analysisSchema, CRITERIA } from './contracts.mjs';
import { task2ScoreRecordSchema, task2AnalysisSchema, TASK2_CRITERIA } from './task2-contracts.mjs';
import { sourceReady } from './validation.mjs';
import { AlgorithmError } from './errors.mjs';
import { sha256, countWords, anchorSentences } from './text.mjs';
import { scoringRequestSchema, scoringResultSchema } from './scoring-contracts.mjs';
import { SCORING_VERSION, SCORING_ALGORITHM_VERSION, SCORING_POLICY } from './scoring-policy.mjs';

export { SCORING_VERSION, SCORING_ALGORITHM_VERSION, SCORING_POLICY };
const DAY = 86_400_000;
const TASKS = ['task1', 'task2'];
const KEYS = { task1: CRITERIA, task2: TASK2_CRITERIA };
const LABELS = { taskAchievement: '任务完成', taskResponse: '任务回应', coherenceCohesion: '连贯与衔接', lexicalResource: '词汇', grammaticalRangeAccuracy: '语法' };
const ensure = (condition, code, message) => { if (!condition) throw new AlgorithmError(code, message); };

/** Stable JSON digest for integrity/idempotence, NOT a signature or authentication. */
export function hashScoringReport(value) {
  const ancestors = new Set();
  let nodes = 0;
  function canonical(v, depth = 0) {
    ensure(++nodes <= 100000 && depth <= 64, 'INVALID_JSON', '报告超出 JSON 大小或深度限制。');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') { ensure(Number.isFinite(v), 'INVALID_JSON', 'JSON 不能包含非有限数值。'); return JSON.stringify(v); }
    ensure(v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null), 'INVALID_JSON', '仅支持普通 JSON 数据。');
    ensure(!ancestors.has(v), 'INVALID_JSON', 'JSON 不能包含循环引用。');
    ancestors.add(v);
    const result = Array.isArray(v)
      ? '[' + Array.from(v, item => canonical(item, depth + 1)).join(',') + ']'
      : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k], depth + 1)).join(',') + '}';
    ancestors.delete(v);
    return result;
  }
  const json = canonical(value);
  ensure(Buffer.byteLength(json) <= 2_000_000, 'INVALID_JSON', '单份数据不能超过 2 MB。');
  return createHash('sha256').update(json).digest('hex');
}

function time(value, label) {
  const n = Date.parse(value);
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(n) && new Date(n).toISOString() === value,
    'INVALID_TIMESTAMP', `${label} 必须是有效 UTC 时间（ISO 毫秒格式）。`);
  return n;
}
function same(actual, expected, label) {
  ensure(isDeepStrictEqual(actual, expected), 'REPORT_MISMATCH', `${label} 与已保存的提交／报告不一致。`);
}

function inspectRecord({ submission: s, report: r }, input) {
  ensure(s.userId === input.userId, 'USER_MISMATCH', '不能混合不同用户的评分。');
  ensure(s.assessmentSetId === input.assessmentSetId, 'SET_MISMATCH', '不能混合不同测评组的评分。');
  const submittedAt = time(s.submittedAt, 'submittedAt'), storedAt = time(s.reportStoredAt, 'reportStoredAt');
  ensure(storedAt >= submittedAt, 'INVALID_TIMESTAMP', '报告保存时间不能早于当前提交。');
  ensure(storedAt <= time(input.asOf, 'asOf'), 'FUTURE_RECORD', '计算时点不能早于报告保存时间。');
  const hash = hashScoringReport(r);
  ensure(hash === s.lockedReportHash, 'REPORT_HASH_MISMATCH', '报告与服务端锁定的评分版本不同。');
  const recordSchema = s.task === 'task1' ? scoreRecordSchema : task2ScoreRecordSchema;
  const rec = assertSchema(recordSchema, r.scoreRecord, 'INVALID_SCORE_RECORD');
  for (const field of ['task', 'questionId', 'submissionId']) {
    same(r[field], s[field], field); same(rec[field], s[field], `scoreRecord.${field}`);
  }
  ensure(new RegExp(s.task === 'task1' ? '^T1-[0-9]{3}$' : '^T2-[0-9]{3}$').test(s.questionId), 'INVALID_INPUT', '题目编号不属于当前任务。');
  same(r.textHash, sha256(s.text), 'textHash'); same(rec.textHash, r.textHash, 'scoreRecord.textHash');
  same(rec.sourceFingerprint, s.sourceFingerprint, '题目指纹'); same(r.source?.sourceFingerprint, s.sourceFingerprint, '报告题目指纹');
  if (rec.trustedRecordId !== null) same(rec.trustedRecordId, s.recordId, 'trustedRecordId');
  const assessedAt = time(rec.assessedAt, 'assessedAt');
  same(r.generation?.generatedAt, rec.assessedAt, 'generatedAt');
  ensure(assessedAt <= storedAt, 'INVALID_TIMESTAMP', '模型生成时间不能晚于报告保存时间。');
  // Cached grading can predate a new submission; freshness uses submittedAt.
  const omitted = reason => ({ excluded: { task: s.task, submissionId: s.submissionId, reason } });
  if (s.origin !== 'learner') return omitted('NON_LEARNER_RESPONSE');
  if (s.assistance !== 'unassisted') return omitted(s.assistance === 'assisted' ? 'ASSISTED_RESPONSE' : 'ASSISTANCE_UNVERIFIED');
  if (s.attemptNumber !== 1 || s.firstSubmissionId !== s.submissionId || rec.draftRole === 'revision' || r.revisionComparison?.available === true) return omitted('NOT_FIRST_DRAFT');
  if (s.mode !== 'essay') return omitted('NOT_ESSAY');
  if (time(input.asOf, 'asOf') - submittedAt > SCORING_POLICY.maxAgeDays * DAY) return omitted('STALE_SUBMISSION');

  const expected = SCORING_POLICY[s.task];
  const compatible=expected.compatibleReleases??[expected];
  if (!compatible.some(release=>r.schemaVersion===release.reportSchema&&rec.rubricVersion===release.rubric&&rec.promptVersion===release.prompt&&r.generation?.requestedModel===release.requestedModel)) return omitted('UNSUPPORTED_GRADING_VERSION');
  const modes = s.task === 'task1' ? ['full', 'language_only', 'insufficient_source', 'insufficient_response'] : ['full', 'language_only', 'insufficient_question', 'insufficient_response'];
  ensure(modes.includes(r.feedback?.assessmentMode), 'INVALID_REPORT', '评分范围无效。');
  const full = r.feedback.assessmentMode === 'full';
  const keys = KEYS[s.task];
  const values = keys.map(key => rec.criteria[key]);
  ensure(!full || values.every(value => value !== null), 'INCOMPLETE_FULL_SCORE', '完整评分不能缺少维度。');
  const raw = full ? values.reduce((sum, value) => sum + value, 0) / 4 : null;
  const band = raw === null ? null : Math.round(raw * 2) / 2;
  same(rec.unroundedMean, raw, 'scoreRecord.unroundedMean'); same(rec.displayBand, band, 'scoreRecord.displayBand');
  same(rec.firstDraftCandidate, rec.draftRole === 'first' && full, 'firstDraftCandidate');
  same(r.assessment?.criteria, rec.criteria, 'assessment.criteria');
  same(r.assessment?.unroundedMean, raw, 'assessment.unroundedMean'); same(r.assessment?.displayBand, band, 'assessment.displayBand');
  same(r.assessment?.rubricVersion, rec.rubricVersion, 'assessment.rubricVersion');
  same(r.assessment?.criterionWeights, [.25, .25, .25, .25], 'criterionWeights');
  same(r.assessment?.scope, 'single_task_practice_estimate', 'scope');
  same(r.assessment?.officialResult, false, 'officialResult'); same(r.assessment?.statisticallyCalibrated, false, 'statisticallyCalibrated');
  same(r.assessment?.displayRounding, 'nearest_half_band_product_display', 'displayRounding');
  if (!full) return omitted('INCOMPLETE_ASSESSMENT');

  const words = countWords(s.text), underlength = words < (s.task === 'task1' ? 150 : 250);
  same(r.wordCount, words, 'wordCount'); same(r.underlength, underlength, 'underlength');
  ensure(words >= 40, 'INSUFFICIENT_RESPONSE', '片段不能进入综合水平。');
  if (s.task === 'task1') {
    assertSchema(analysisSchema, r.source.analysis, 'INVALID_SOURCE');
    ensure(sourceReady(r.source.analysis) && r.feedback.sourceReview?.imageAgreement === 'confirmed', 'SOURCE_NOT_READY', '题图或来源不确定，不能进入完整评分。');
    same(r.source.origin, rec.sourceOrigin, 'sourceOrigin');
    same(r.source.review?.kind ?? null, rec.referenceReviewKind, 'referenceReviewKind');
    same(r.source.humanVerified, rec.sourceHumanVerified, 'sourceHumanVerified');
  } else {
    assertSchema(task2AnalysisSchema, r.source.analysis, 'INVALID_SOURCE');
    ensure(r.source.analysis.promptQuality === 'clear', 'SOURCE_NOT_READY', '题干不清，不能进入完整评分。');
    same(r.source.questionId, s.questionId, 'source.questionId');
    same(r.source.promptVersion, rec.promptVersion, 'source.promptVersion');
    same(r.source.analysisMethod, rec.sourceOrigin, 'sourceOrigin');
    same(rec.referenceReviewKind, null, 'referenceReviewKind'); same(rec.sourceHumanVerified, false, 'sourceHumanVerified');
  }
  ensure(typeof r.generation.responseModel === 'string' && r.generation.responseModel.trim().length > 0 && r.generation.responseModel.length <= 200, 'INVALID_REPORT', '缺少模型返回名称。');

  const anchors = anchorSentences(s.text, s.submissionId);
  ensure(Array.isArray(r.feedback.sentences) && r.feedback.sentences.every(s => s !== null && typeof s === 'object' && !Array.isArray(s)), 'INVALID_EVIDENCE', '缺少原文句子锚点或锚点结构无效。');
  same(r.feedback.sentences.map(({ id, start, end, paragraph, index, text }) => ({ id, start, end, paragraph, index, text })), anchors, '原文句子锚点');
  const anchorIds = new Set(anchors.map(a => a.id));
  const criterionFeedback = {};
  for (const key of keys) {
    const f = r.feedback.scores?.[key];
    same(f?.band, rec.criteria[key], `feedback.scores.${key}`);
    ensure(Array.isArray(f.evidenceSentenceIds) && f.evidenceSentenceIds.length > 0 && new Set(f.evidenceSentenceIds).size === f.evidenceSentenceIds.length && f.evidenceSentenceIds.every(id => anchorIds.has(id)), 'INVALID_EVIDENCE', '评分证据未指向当前首稿。');
    ensure(typeof f.reason === 'string' && f.reason.trim() && typeof f.nextStep === 'string' && f.nextStep.trim(), 'INVALID_EVIDENCE', '评分必须包含理由和改进方向。');
    criterionFeedback[key] = { band: f.band, reason: f.reason, evidenceSentenceIds: [...f.evidenceSentenceIds], nextStep: f.nextStep };
  }
  return { task: {
    task: s.task, questionId: s.questionId, submissionId: s.submissionId, recordId: s.recordId, practiceId: s.practiceId,
    textHash: r.textHash, reportHash: hash, sourceFingerprint: s.sourceFingerprint,
    submittedAt: s.submittedAt, assessedAt: rec.assessedAt, reportStoredAt: s.reportStoredAt,
    wordCount: words, underlength, criteria: structuredClone(rec.criteria), unroundedMean: raw, displayBand: band,
    weakestCriteria: keys.filter(key => rec.criteria[key] === Math.min(...values)), criterionFeedback,
    provenance: {
      upstreamDraftRole: rec.draftRole, draftRoleResolvedFrom: 'trusted_persisted_submission',
      reportSchema: r.schemaVersion, promptVersion: rec.promptVersion, rubricVersion: rec.rubricVersion,
      requestedModel: r.generation.requestedModel, responseModel: r.generation.responseModel,
      sourceOrigin: rec.sourceOrigin, sourceHumanVerified: rec.sourceHumanVerified, referenceReviewKind: rec.referenceReviewKind,
    },
  } };
}

/** Server-only: supply authenticated, persisted records; never browser-provided scores. */
export function scoreWritingSet(input) {
  assertSchema(scoringRequestSchema, input, 'INVALID_INPUT');
  time(input.asOf, 'asOf');
  const unique = new Map(), recordIds = new Map(), submissionIds = new Map();
  for (const record of input.records) {
    const digest = hashScoringReport(record);
    for (const [map, key] of [[recordIds, record.submission.recordId], [submissionIds, record.submission.submissionId]]) {
      ensure(!map.has(key) || map.get(key) === digest, 'RECORD_CONFLICT', '同一提交存在多个评分／元数据版本；请从服务端选择锁定报告，不能择高分。');
      map.set(key, digest);
    }
    unique.set(digest, record);
  }
  const tasks = { task1: null, task2: null }, excluded = [];
  for (const [, record] of [...unique].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const inspected = inspectRecord(record, input);
    if (inspected.excluded) { excluded.push(inspected.excluded); continue; }
    const result = inspected.task;
    ensure(tasks[result.task] === null, 'AMBIGUOUS_TASK_SELECTION', '同一测评组有多份合格的同类任务，请由服务端固定各一份首稿。');
    tasks[result.task] = result;
  }
  const availableTasks = TASKS.filter(task => tasks[task] !== null), missingTasks = TASKS.filter(task => tasks[task] === null);
  const flags = ['UNCALIBRATED_AI_ESTIMATE'];
  if (availableTasks.length) flags.push('ONE_SAMPLE_PER_AVAILABLE_TASK');
  if (missingTasks.length) flags.push('MISSING_TASK');
  for (const task of availableTasks) if (tasks[task].underlength) flags.push(`${task.toUpperCase()}_UNDERLENGTH`);
  if (tasks.task1 && !tasks.task1.provenance.sourceHumanVerified) flags.push('TASK1_SOURCE_NOT_HUMAN_VERIFIED');
  let writing = null, status = availableTasks.length === 0 ? 'unavailable' : missingTasks.length ? 'partial' : 'complete';
  if (status === 'complete') {
    if (Math.abs(time(tasks.task1.submittedAt, 'submittedAt') - time(tasks.task2.submittedAt, 'submittedAt')) > SCORING_POLICY.maxPairGapDays * DAY) flags.push('PAIR_GAP_EXCEEDED');
    if (tasks.task1.provenance.responseModel !== tasks.task2.provenance.responseModel) flags.push('RESPONSE_MODEL_MISMATCH');
    if (flags.includes('PAIR_GAP_EXCEEDED') || flags.includes('RESPONSE_MODEL_MISMATCH')) status = 'incompatible';
    else {
      // Each upstream criterion is a half-band. Sum integer half-band units;
      // divide once at the end. Do not average already rounded task bands.
      const units1 = CRITERIA.reduce((sum, key) => sum + tasks.task1.criteria[key] * 2, 0);
      const units2 = TASK2_CRITERIA.reduce((sum, key) => sum + tasks.task2.criteria[key] * 2, 0);
      const numerator = units1 + 2 * units2, denominator = 24;
      const weighted = (a, b) => (a * 2 + 2 * b * 2) / 6;
      writing = {
        unroundedMean: numerator / denominator,
        displayBand: Math.floor((2 * numerator + denominator / 2) / denominator) / 2,
        exact: { numerator, denominator },
        criteria: {
          taskFulfilment: weighted(tasks.task1.criteria.taskAchievement, tasks.task2.criteria.taskResponse),
          ...Object.fromEntries(CRITERIA.slice(1).map(key => [key, weighted(tasks.task1.criteria[key], tasks.task2.criteria[key])])),
        },
        formula: '(task1_unroundedMean + 2 * task2_unroundedMean) / 3',
      };
    }
  }
  const qualityFlags = [...new Set(flags)].sort();
  const assessmentId = hashScoringReport({ version: SCORING_ALGORITHM_VERSION, policy: SCORING_POLICY, userId: input.userId, assessmentSetId: input.assessmentSetId, asOf: input.asOf, records: [...unique.keys()].sort() });
  const identity = { assessmentId, userId: input.userId, assessmentSetId: input.assessmentSetId, asOf: input.asOf, status, scope: 'academic_writing_first_draft_estimate', officialResult: false, calibrationStatus: 'not_calibrated_against_examiner_scores' };
  const taskForMatching = t => t === null ? null : { questionId: t.questionId, submissionId: t.submissionId, unroundedMean: t.unroundedMean, displayBand: t.displayBand, criteria: structuredClone(t.criteria), submittedAt: t.submittedAt, provenance: structuredClone(t.provenance) };
  const summary = status === 'complete' ? `写作综合练习估分 ${writing.displayBand.toFixed(1)}，由两份首稿的未取整分数按 1:2 汇总。`
    : status === 'incompatible' ? '两类任务均有评分，但提交间隔或模型返回版本不符合配对规则，暂不形成综合分。'
    : status === 'partial' ? `已获得 ${availableTasks.join('、')} 首稿评分；缺少合格的 ${missingTasks.join('、')}，综合分暂为空。` : '当前没有可用于水平评估的合格首稿。';
  const focus = availableTasks.map(task => `${task} 的相对薄弱维度：${tasks[task].weakestCriteria.map(k => LABELS[k]).join('、')}。`).join('');
  const result = {
    schemaVersion: SCORING_VERSION, algorithmVersion: SCORING_ALGORITHM_VERSION, ...identity,
    policy: { id: SCORING_POLICY.id, maxAgeDays: SCORING_POLICY.maxAgeDays, maxPairGapDays: SCORING_POLICY.maxPairGapDays, rounding: SCORING_POLICY.rounding, taskWeights: { task1: 1, task2: 2 }, criterionWeights: [.25, .25, .25, .25] },
    tasks, writing, feedbackSummary: summary + focus + '本结果仅覆盖本组写作样本，尚未与考官评分校准。', qualityFlags,
    coverage: { availableTasks, missingTasks, inputRecordCount: input.records.length, uniqueRecordCount: unique.size }, excluded,
    matchingSource: {
      schemaVersion: 'writing-matching-source-v1', ...identity, algorithmVersion: SCORING_ALGORITHM_VERSION, policyId: SCORING_POLICY.id,
      writingRaw: writing?.unroundedMean ?? null, writingBand: writing?.displayBand ?? null,
      task1: taskForMatching(tasks.task1), task2: taskForMatching(tasks.task2),
      sampleCounts: { task1: tasks.task1 === null ? 0 : 1, task2: tasks.task2 === null ? 0 : 1 }, qualityFlags: [...qualityFlags],
    },
  };
  return assertSchema(scoringResultSchema, result, 'INVALID_RESULT');
}
