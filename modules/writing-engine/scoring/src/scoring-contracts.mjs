import { CRITERIA } from './contracts.mjs';
import { TASK2_CRITERIA } from './task2-contracts.mjs';

const str = (max = 200, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const choice = values => ({ type: 'string', enum: values });
const object = (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
const array = (items, max = 100, min = 0) => ({ type: 'array', items, maxItems: max, minItems: min });
const nullable = schema => ({ ...schema, type: [schema.type, 'null'] });
const bool = { type: 'boolean' };
const falseValue = { type: 'boolean', enum: [false] };
const hash = { ...str(64, 64), pattern: '^[a-f0-9]{64}$' };
const timestamp = { ...str(24, 24), pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const id = { ...str(200), pattern: '^[a-zA-Z0-9][a-zA-Z0-9:._-]*$' };
const task = choice(['task1', 'task2']);
const band = { type: 'number', minimum: 0, maximum: 9, multipleOf: 0.5 };
const raw = { type: 'number', minimum: 0, maximum: 9 };
const integer = { type: 'integer', minimum: 0, maximum: 100000 };
const criteria = keys => object(Object.fromEntries(keys.map(k => [k, band])));
const estimateLabel = choice(['not_calibrated_against_examiner_scores']);
const status = choice(['complete', 'partial', 'unavailable', 'incompatible']);

export const scoringSubmissionSchema = object({
  recordId: id, userId: id, assessmentSetId: id, practiceId: id,
  task, questionId: id, submissionId: { ...id, maxLength: 100 }, firstSubmissionId: { ...id, maxLength: 100 },
  attemptNumber: { type: 'integer', minimum: 1, maximum: 10000 },
  mode: choice(['essay', 'language']), text: str(20000), sourceFingerprint: hash,
  submittedAt: timestamp, reportStoredAt: timestamp, lockedReportHash: hash,
  origin: choice(['learner', 'sample', 'model_answer']),
  assistance: choice(['unassisted', 'assisted', 'unknown']),
});

// Full upstream reports use task1-ai-v1 / task2-ai-v2. The adapter checks their
// scoreRecord schema, evidence anchors, source readiness and cross-field identity.
export const scoringRequestSchema = object({
  userId: id, assessmentSetId: id, asOf: timestamp,
  records: array(object({ submission: scoringSubmissionSchema,
    report: { type: 'object', properties: {}, additionalProperties: true, description: 'Trusted persisted task1-ai-v1 or task2-ai-v2 full report; runtime scoring adapter validation required.' },
  }), 10),
});

const scoreFeedback = object({ band, reason: str(1500), evidenceSentenceIds: array(id, 100, 1), nextStep: str(800) });
const provenance = object({
  upstreamDraftRole: choice(['first', 'unverified']),
  draftRoleResolvedFrom: choice(['trusted_persisted_submission']),
  reportSchema: str(), promptVersion: str(64), rubricVersion: str(100),
  requestedModel: str(), responseModel: str(),
  sourceOrigin: choice(['reference', 'rule', 'model']), sourceHumanVerified: bool,
  referenceReviewKind: { type: ['string', 'null'], enum: ['human_review', 'agent_visual_review', null] },
});
const taskResult = keys => object({
  task, questionId: id, submissionId: id, recordId: id, practiceId: id,
  textHash: hash, reportHash: hash, sourceFingerprint: hash,
  submittedAt: timestamp, assessedAt: timestamp, reportStoredAt: timestamp,
  wordCount: integer, underlength: bool, criteria: criteria(keys),
  unroundedMean: raw, displayBand: band,
  weakestCriteria: array(choice(keys), 4, 1),
  criterionFeedback: object(Object.fromEntries(keys.map(k => [k, scoreFeedback]))), provenance,
});
const vector = object(Object.fromEntries(['taskFulfilment', 'coherenceCohesion', 'lexicalResource', 'grammaticalRangeAccuracy'].map(k => [k, raw])));
const writing = object({
  unroundedMean: raw, displayBand: band,
  exact: object({ numerator: integer, denominator: { type: 'integer', minimum: 1, maximum: 100000 } }),
  criteria: vector,
  formula: choice(['(task1_unroundedMean + 2 * task2_unroundedMean) / 3']),
});
const matchingTask = keys => nullable(object({
  questionId: id, submissionId: id, unroundedMean: raw, displayBand: band, criteria: criteria(keys),
  submittedAt: timestamp, provenance,
}));
export const matchingSourceSchema = object({
  schemaVersion: choice(['writing-matching-source-v1']), assessmentId: hash,
  userId: id, assessmentSetId: id, asOf: timestamp, status,
  scope: choice(['academic_writing_first_draft_estimate']), officialResult: falseValue,
  calibrationStatus: estimateLabel, algorithmVersion: str(), policyId: str(),
  writingRaw: nullable(raw), writingBand: nullable(band),
  task1: matchingTask(CRITERIA), task2: matchingTask(TASK2_CRITERIA),
  sampleCounts: object({ task1: { type: 'integer', minimum: 0, maximum: 1 }, task2: { type: 'integer', minimum: 0, maximum: 1 } }),
  qualityFlags: array(str(), 20),
});
export const scoringResultSchema = object({
  schemaVersion: choice(['writing-composite-v1']), algorithmVersion: str(), assessmentId: hash,
  userId: id, assessmentSetId: id, asOf: timestamp, status,
  scope: choice(['academic_writing_first_draft_estimate']), officialResult: falseValue, calibrationStatus: estimateLabel,
  policy: object({ id: str(), maxAgeDays: integer, maxPairGapDays: integer, rounding: str(),
    taskWeights: object({ task1: { type: 'integer', enum: [1] }, task2: { type: 'integer', enum: [2] } }),
    criterionWeights: array({ type: 'number', enum: [0.25] }, 4, 4),
  }),
  tasks: object({ task1: nullable(taskResult(CRITERIA)), task2: nullable(taskResult(TASK2_CRITERIA)) }),
  writing: nullable(writing), feedbackSummary: str(2000), qualityFlags: array(str(), 20),
  coverage: object({ availableTasks: array(task, 2), missingTasks: array(task, 2), inputRecordCount: integer, uniqueRecordCount: integer }),
  excluded: array(object({ task, submissionId: id, reason: str() }), 10),
  matchingSource: matchingSourceSchema,
});
