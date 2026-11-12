import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreWritingSet, hashScoringReport } from '../src/scoring.mjs';
import { assertSchema } from '../src/contracts.mjs';
import { scoringResultSchema, matchingSourceSchema } from '../src/scoring-contracts.mjs';
import { TASK2_PROMPT_VERSION } from '../../task2/src/task2.mjs';
import { SCORING_POLICY } from '../src/scoring-policy.mjs';

const sample = JSON.parse(readFileSync(new URL('../examples/scoring/input.sample.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(sample);
test('the deployed Task 2 prompt has an exact compatible release for first-draft matching',()=>{
  assert(SCORING_POLICY.task2.compatibleReleases.some(release=>release.reportSchema==='task2-ai-v2.1'&&release.prompt===TASK2_PROMPT_VERSION&&release.rubric==='ielts-task2-2023-product-v2'&&release.requestedModel==='deepseek-flash'));
});
test('Task 2 v1.1 real report is accepted only with its exact compatible version tuple',()=>{
  const input=JSON.parse(readFileSync(new URL('../examples/scoring/task2-v1.1.input.sample.json',import.meta.url),'utf8'));
  assert.equal(scoreWritingSet(input).status,'complete');
  input.records[1].report.scoreRecord.promptVersion='091a6e0c1b785535';
  input.records[1].submission.lockedReportHash=hashScoringReport(input.records[1].report);
  assert.equal(scoreWritingSet(input).excluded[0].reason,'UNSUPPORTED_GRADING_VERSION');
});
const lock = record => { record.submission.lockedReportHash = hashScoringReport(record.report); return record; };
const rejects = (input, code) => assert.throws(() => scoreWritingSet(input), error => error.code === code);
function bands(record, values) {
  const r = record.report, keys = Object.keys(r.scoreRecord.criteria);
  for (const [i, key] of keys.entries()) {
    r.scoreRecord.criteria[key] = values[i]; r.assessment.criteria[key] = values[i]; r.feedback.scores[key].band = values[i];
  }
  const raw = values.reduce((a, b) => a + b, 0) / 4;
  r.scoreRecord.unroundedMean = r.assessment.unroundedMean = raw;
  r.scoreRecord.displayBand = r.assessment.displayBand = Math.round(raw * 2) / 2;
  return lock(record);
}
function partial(record) {
  const r = record.report;
  r.feedback.assessmentMode = record.submission.task === 'task1' ? 'insufficient_source' : 'insufficient_question';
  const key = record.submission.task === 'task1' ? 'taskAchievement' : 'taskResponse';
  r.scoreRecord.criteria[key] = r.assessment.criteria[key] = r.feedback.scores[key].band = null;
  r.scoreRecord.unroundedMean = r.assessment.unroundedMean = r.scoreRecord.displayBand = r.assessment.displayBand = null;
  r.scoreRecord.firstDraftCandidate = false;
  return lock(record);
}

test('real-report integration: 7.5 + 2*7.125 gives 7.25, display 7.5', () => {
  const result = scoreWritingSet(clone());
  assert.equal(result.status, 'complete'); assert.equal(result.writing.unroundedMean, 7.25);
  assert.equal(result.writing.displayBand, 7.5); assert.deepEqual(result.writing.exact, { numerator: 174, denominator: 24 });
  assert.equal(result.tasks.task2.displayBand, 7);
  assertSchema(scoringResultSchema, result); assertSchema(matchingSourceSchema, result.matchingSource);
});
test('criteria are equal-weight; Task 2 contributes twice as much', () => {
  const input = clone(); bands(input.records[0], [4, 5, 6, 7]); bands(input.records[1], [7, 8, 9, 6]);
  const r = scoreWritingSet(input);
  assert.equal(r.tasks.task1.unroundedMean, 5.5); assert.equal(r.tasks.task2.unroundedMean, 7.5);
  assert.equal(r.writing.unroundedMean, 20.5 / 3); assert.equal(r.writing.criteria.taskFulfilment, 6);
  assert.equal(r.writing.criteria.lexicalResource, 8);
});
test('integer half-band arithmetic handles 0..9 and quarter-band boundaries', () => {
  // Exhaust every possible single-task mean (sums of four half-band criteria).
  for (let sum = 0; sum <= 72; sum++) {
    const input = clone(); let remaining = sum;
    const values = Array.from({ length: 4 }, () => { const n = Math.min(18, remaining); remaining -= n; return n / 2; });
    bands(input.records[0], values); bands(input.records[1], values);
    const result = scoreWritingSet(input);
    assert.equal(result.writing.unroundedMean, sum / 8);
    assert.equal(result.writing.displayBand, Math.round(sum / 4) / 2);
  }
});
test('missing Task 1 / Task 2 does not become zero or a projected composite', () => {
  for (const index of [0, 1]) {
    const input = clone(); input.records = [input.records[index]];
    const r = scoreWritingSet(input); assert.equal(r.status, 'partial'); assert.equal(r.writing, null);
    assert.equal(r.matchingSource.writingBand, null); assert.equal(r.coverage.missingTasks.length, 1);
  }
});
test('empty set yields unavailable and no fabricated scores', () => {
  const input = clone(); input.records = []; const r = scoreWritingSet(input);
  assert.equal(r.status, 'unavailable'); assert.equal(r.writing, null); assert.deepEqual(r.matchingSource.sampleCounts, { task1: 0, task2: 0 });
});
test('second drafts and first-submission pointer mismatches are excluded', () => {
  for (const mutate of [s => s.attemptNumber = 2, s => s.firstSubmissionId = 'earlier-submission']) {
    const input = clone(); mutate(input.records[0].submission);
    assert.equal(scoreWritingSet(input).excluded[0].reason, 'NOT_FIRST_DRAFT');
  }
});
test('revision scoreRecord and revision comparison cannot be relabelled first', () => {
  for (const mutate of [r => r.scoreRecord.draftRole = 'revision', r => r.revisionComparison = { available: true }]) {
    const input = clone(); mutate(input.records[0].report); lock(input.records[0]);
    assert.equal(scoreWritingSet(input).excluded[0].reason, 'NOT_FIRST_DRAFT');
  }
});
test('unverified upstream role resolves only from persisted first-submission metadata', () => {
  const r = scoreWritingSet(clone()); assert.equal(r.tasks.task1.provenance.upstreamDraftRole, 'unverified');
  const input = clone(); const first = input.records[0]; first.report.scoreRecord.draftRole = 'first';
  first.report.scoreRecord.trustedRecordId = first.submission.recordId; first.report.scoreRecord.firstDraftCandidate = true; lock(first);
  assert.equal(scoreWritingSet(input).status, 'complete');
  first.report.scoreRecord.trustedRecordId = 'wrong-id'; lock(first); rejects(input, 'REPORT_MISMATCH');
});
test('sample, model answer, assisted and unknown-origin assistance cannot establish baseline', () => {
  for (const [field, value, expected] of [['origin', 'sample', 'NON_LEARNER_RESPONSE'], ['origin', 'model_answer', 'NON_LEARNER_RESPONSE'], ['assistance', 'assisted', 'ASSISTED_RESPONSE'], ['assistance', 'unknown', 'ASSISTANCE_UNVERIFIED']]) {
    const input = clone(); input.records[0].submission[field] = value;
    assert.equal(scoreWritingSet(input).excluded[0].reason, expected);
  }
});
test('language mode and incomplete source reports do not produce composite', () => {
  const input = clone(); input.records[0].submission.mode = 'language';
  assert.equal(scoreWritingSet(input).excluded[0].reason, 'NOT_ESSAY');
  for (const index of [0, 1]) { const next = clone(); partial(next.records[index]);
    const r = scoreWritingSet(next); assert.equal(r.status, 'partial'); assert.equal(r.excluded[0].reason, 'INCOMPLETE_ASSESSMENT'); }
});
test('rejects forged full assessment with a missing criterion', () => {
  const input = clone(); input.records[0].report.scoreRecord.criteria.taskAchievement = null; lock(input.records[0]); rejects(input, 'INCOMPLETE_FULL_SCORE');
});
test('different users and assessment sets fail closed', () => {
  const input = clone(); input.records[0].submission.userId = 'someone-else'; rejects(input, 'USER_MISMATCH');
  const other = clone(); other.records[0].submission.assessmentSetId = 'other-set'; rejects(other, 'SET_MISMATCH');
});
test('text, question fingerprint, submission ID and record identity are bound', () => {
  for (const mutate of [s => s.text += ' Changed.', s => s.sourceFingerprint = 'a'.repeat(64), s => s.questionId = 'T1-002', s => s.submissionId = 'different-id']) {
    const input = clone(); mutate(input.records[0].submission); rejects(input, 'REPORT_MISMATCH');
  }
});
test('locked report prevents silently substituting a regrade', () => {
  const input = clone(); input.records[0].report.scoreRecord.displayBand = 9; rejects(input, 'REPORT_HASH_MISMATCH');
});
test('recomputes all means and checks feedback bands instead of trusting totals', () => {
  for (const mutate of [r => r.scoreRecord.unroundedMean = 8, r => r.assessment.displayBand = 9, r => r.feedback.scores.taskAchievement.band = 9]) {
    const input = clone(); mutate(input.records[0].report); lock(input.records[0]); rejects(input, 'REPORT_MISMATCH');
  }
});
test('rejects numeric strings, out of range scores and non half-band values', () => {
  for (const value of ['7', 9.5, -0.5, 6.25]) { const input = clone(); input.records[0].report.scoreRecord.criteria.taskAchievement = value; lock(input.records[0]); rejects(input, 'INVALID_SCORE_RECORD'); }
});
test('criteria evidence must point at unchanged current-text anchors', () => {
  const input = clone(); input.records[0].report.feedback.scores.taskAchievement.evidenceSentenceIds = ['unrelated']; lock(input.records[0]); rejects(input, 'INVALID_EVIDENCE');
  const next = clone(); next.records[0].report.feedback.sentences[0].start++; lock(next.records[0]); rejects(next, 'REPORT_MISMATCH');
  const malformed = clone(); malformed.records[0].report.feedback.sentences[0] = null; lock(malformed.records[0]); rejects(malformed, 'INVALID_EVIDENCE');
});
test('uncertain graph and unclear task prompt cannot support full scores', () => {
  const input = clone(); input.records[0].report.feedback.sourceReview.imageAgreement = 'uncertain'; lock(input.records[0]); rejects(input, 'SOURCE_NOT_READY');
  const next = clone(); next.records[1].report.source.analysis.promptQuality = 'ambiguous'; lock(next.records[1]); rejects(next, 'SOURCE_NOT_READY');
});
test('underlength is a flag, no invented fixed deduction on top of upstream grade', () => {
  const input = clone(); const record = input.records[0];
  // Use an excerpt and re-anchor only for this synthetic boundary test.
  const retained = record.report.feedback.sentences.slice(0, 4);
  record.submission.text = record.submission.text.slice(0, retained.at(-1).end);
  const words = record.submission.text.match(/[A-Za-z]+(?:[’\x27\-][A-Za-z]+)*|\d+(?:[,.]\d+)*(?:%|[A-Za-z]+)?/g).length;
  record.report.textHash = record.report.scoreRecord.textHash = hashText(record.submission.text);
  record.report.wordCount = words; record.report.underlength = true; record.report.feedback.sentences = retained;
  for (const score of Object.values(record.report.feedback.scores)) score.evidenceSentenceIds = [retained[0].id];
  lock(record); const r = scoreWritingSet(input); assert.equal(r.tasks.task1.unroundedMean, 7.5); assert.ok(r.qualityFlags.includes('TASK1_UNDERLENGTH'));
});
import { sha256 as hashText } from '../src/text.mjs';
test('unsupported rubric, prompt, report schema or requested model is excluded', () => {
  for (const mutate of [r => r.scoreRecord.promptVersion = 'future', r => r.scoreRecord.rubricVersion = 'future', r => r.schemaVersion = 'future', r => r.generation.requestedModel = 'different-model']) {
    const input = clone(); mutate(input.records[0].report); lock(input.records[0]); assert.equal(scoreWritingSet(input).excluded[0].reason, 'UNSUPPORTED_GRADING_VERSION');
  }
});
test('different response models retain task scores but withhold composite', () => {
  const input = clone(); input.records[1].report.generation.responseModel = 'new-alias'; lock(input.records[1]);
  const r = scoreWritingSet(input); assert.equal(r.status, 'incompatible'); assert.equal(r.writing, null); assert.ok(r.tasks.task1 && r.tasks.task2);
});
test('exact duplicate records are idempotent; input ordering does not affect result', () => {
  const input = clone(), expected = scoreWritingSet(input); input.records.reverse(); assert.deepEqual(scoreWritingSet(input), expected);
  input.records.push(structuredClone(input.records[0])); const r = scoreWritingSet(input);
  assert.equal(r.assessmentId, expected.assessmentId); assert.deepEqual(r.matchingSource, expected.matchingSource); assert.equal(r.coverage.uniqueRecordCount, 2);
});
test('conflicting regrades and ambiguous multiple Task 1 submissions are rejected', () => {
  const input = clone(), alternate = structuredClone(input.records[0]); bands(alternate, [9, 9, 9, 9]); input.records.push(alternate); rejects(input, 'RECORD_CONFLICT');
  const next = clone(); const different = structuredClone(next.records[0]);
  different.submission.recordId = 'new-record'; different.submission.submissionId = different.submission.firstSubmissionId = 'new-submission';
  different.report.submissionId = different.report.scoreRecord.submissionId = 'new-submission';
  const old = next.records[0].submission.submissionId;
  for (const f of Object.values(different.report.feedback.scores)) f.evidenceSentenceIds = f.evidenceSentenceIds.map(id => id.replace(old, 'new-submission'));
  different.report.feedback.sentences.forEach(s => s.id = s.id.replace(old, 'new-submission')); lock(different); next.records.push(different); rejects(next, 'AMBIGUOUS_TASK_SELECTION');
});
test('UTC timestamps reject impossible dates and future records', () => {
  const input = clone(); input.asOf = '2026-02-30T01:00:00.000Z'; rejects(input, 'INVALID_TIMESTAMP');
  const next = clone(); next.records[0].submission.reportStoredAt = '2027-01-01T01:00:00.000Z'; rejects(next, 'FUTURE_RECORD');
});
test('cache generation may predate submission; freshness uses submission time', () => {
  const input = clone(); input.records[0].submission.submittedAt = '2026-11-09T00:30:00.000Z'; input.records[0].submission.reportStoredAt = '2026-11-09T00:30:01.000Z';
  assert.equal(scoreWritingSet(input).status, 'complete');
});
test('90-day age cutoff and 7-day pairing cutoff are explicit product boundaries', () => {
  const input = clone(); input.asOf = new Date(Date.parse(input.records[1].submission.submittedAt) + 90 * 86400000).toISOString();
  assert.equal(scoreWritingSet(input).tasks.task2 !== null, true);
  input.asOf = new Date(Date.parse(input.asOf) + 1).toISOString(); assert.equal(scoreWritingSet(input).status, 'unavailable');
  const next = clone(); next.asOf = '2026-11-20T01:00:00.000Z';
  next.records[1].submission.submittedAt = new Date(Date.parse(next.records[0].submission.submittedAt) + 7 * 86400000).toISOString();
  next.records[1].submission.reportStoredAt = next.records[1].submission.submittedAt;
  assert.equal(scoreWritingSet(next).status, 'complete');
  next.records[1].submission.submittedAt = new Date(Date.parse(next.records[1].submission.submittedAt) + 1).toISOString(); next.records[1].submission.reportStoredAt = next.records[1].submission.submittedAt;
  assert.equal(scoreWritingSet(next).status, 'incompatible');
});
test('output is detached and contains no essay or subjective confidence probability', () => {
  const input = clone(), before = structuredClone(input), result = scoreWritingSet(input);
  assert.deepEqual(input, before); assert.equal(result.officialResult, false);
  const serialized = JSON.stringify(result.matchingSource); assert.ok(!serialized.includes(input.records[0].submission.text));
  assert.ok(!serialized.includes('nextStep')); assert.ok(!serialized.includes('confidence'));
  result.tasks.task1.criteria.taskAchievement = 0; assert.deepEqual(input, before);
});
test('report hash is key-order invariant and rejects unsupported JSON values', () => {
  assert.equal(hashScoringReport({ a: 1, b: 2 }), hashScoringReport({ b: 2, a: 1 }));
  for (const value of [NaN, { a: undefined }, new Date(), [Infinity]]) assert.throws(() => hashScoringReport(value), e => e.code === 'INVALID_JSON');
  const cycle = {}; cycle.self = cycle; assert.throws(() => hashScoringReport(cycle), e => e.code === 'INVALID_JSON');
});
