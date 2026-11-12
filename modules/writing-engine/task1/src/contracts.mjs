import { AlgorithmError } from './errors.mjs';

export const VERSION = 'task1-ai-v1';
export const RUBRIC_VERSION = 'ielts-task1-2023-product-v1';
export const CRITERIA = ['taskAchievement', 'coherenceCohesion', 'lexicalResource', 'grammaticalRangeAccuracy'];
export const CHART_TYPES = ['bar', 'line', 'pie', 'table', 'map', 'process', 'diagram', 'other'];
export const ISSUE_TYPES = ['none', 'data_accuracy', 'overview', 'key_features', 'comparison', 'sequence', 'location', 'unsupported_explanation', 'cohesion', 'lexis', 'grammar', 'redundancy'];
const str = (max = 2000, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const choice = values => ({ type: 'string', enum: values });
const array = (items, max = 100, min = 0) => ({ type: 'array', items, minItems: min, maxItems: max });
const object = (properties, optional = []) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(k => !optional.includes(k)) });
const id = { ...str(120), pattern: '^[a-zA-Z0-9][a-zA-Z0-9:._-]*$' };
const ids = (min = 0) => array(id, 100, min);
const confidence = choice(['high', 'medium', 'low']);
const nullableBand = { type: ['number', 'null'], minimum: 0, maximum: 9, multipleOf: 0.5 };

export const requestSchema = object({
  questionId: { ...id, pattern: '^T1-[0-9]{3}$' }, submissionId: { ...id, maxLength: 100 }, text: str(14000, 1), mode: choice(['essay', 'language']),
  revisionContext: object({ initialText: str(14000), previousText: str(14000), previousFocus: array(str(500), 3), round: { type: 'integer', minimum: 2, maximum: 100 } }),
}, ['revisionContext']);

export const analysisSchema = object({
  readability: choice(['clear', 'partial', 'unreadable']),
  chartTypes: array(choice(CHART_TYPES), 8, 1),
  questionQuality: object({ alignment: choice(['aligned', 'mismatch', 'uncertain']), instructions: choice(['standard', 'legacy_nonstandard', 'invalid']), issues: array(str(600), 12) }),
  panels: array(object({ id, kind: choice(CHART_TYPES), description: str(1000) }), 12),
  facts: array(object({ id, panelId: id, kind: choice(['value', 'trend', 'comparison', 'stage', 'transition', 'location', 'structure', 'unit', 'timeframe']), statement: str(1000), location: str(500), confidence, approximate: { type: 'boolean' } }), 160),
  keyFeatures: array(object({ id, description: str(1000), factIds: ids(1) }), 12),
  uncertainties: array(str(1000), 20),
});

const score = object({ band: nullableBand, reason: str(1500), evidenceSentenceIds: ids(), nextStep: str(800) });
export const evaluationSchema = object({
  assessmentMode: choice(['full', 'language_only', 'insufficient_source', 'insufficient_response']),
  assessmentNote: str(1500), sourceReview: object({ imageAgreement: choice(['confirmed', 'uncertain', 'conflict']), reason: str(1000) }),
  overview: object({ status: choice(['clear', 'partial', 'missing', 'uncertain']), sentenceIds: ids(), reason: str(1200) }),
  coverage: array(object({ featureId: id, status: choice(['covered', 'partial', 'missing', 'uncertain']), sentenceIds: ids(), reason: str(800) }), 12),
  checks: array(object({ sentenceId: id, quote: str(2000), verdict: choice(['supported', 'contradicted', 'unverifiable', 'unsupported_explanation']), factIds: ids(), reason: str(1000), impact: choice(['none', 'minor', 'major']), confidence }), 120),
  scores: object(Object.fromEntries(CRITERIA.map(k => [k, score]))),
  sentences: array(object({ id, status: choice(['keep', 'fix', 'improve']), issueType: choice(ISSUE_TYPES), reason: str(1000), suggestion: str(4000, 0), factIds: ids(), redundantWithSentenceId: { type: ['string', 'null'], maxLength: 120 } }), 100, 1),
  review: object({ decision: choice(['revise', 'ready']), summary: str(1200), resolved: array(str(700), 6), remainingIssues: array(object({ sentenceId: id, issueType: choice(ISSUE_TYPES.slice(1)), action: str(1000) }), 3) }),
  modelAnswer: object({ text: str(6000, 0), factIds: ids(), note: str(1000) }),
  nextPractice: object({ skill: choice(ISSUE_TYPES.slice(1)), instruction: str(1200), successCriteria: array(str(500), 4, 1), evidenceSentenceIds: ids() }),
});

export const scoreRecordSchema = object({
  schemaVersion: choice(['writing-score-source-v1']), task: choice(['task1']), questionId: id, submissionId: id,
  textHash: { ...str(64, 64), pattern: '^[a-f0-9]{64}$' }, sourceFingerprint: { ...str(64, 64), pattern: '^[a-f0-9]{64}$' },
  criteria: object(Object.fromEntries(CRITERIA.map(key => [key, nullableBand]))),
  unroundedMean: { type: ['number', 'null'], minimum: 0, maximum: 9 }, displayBand: nullableBand,
  draftRole: choice(['first', 'revision', 'unverified']), trustedRecordId: { type: ['string', 'null'], maxLength: 200 },
  firstDraftCandidate: { type: 'boolean' }, sourceOfDraftRole: choice(['caller_must_resolve_from_persisted_submission']),
  sourceOrigin: choice(['reference', 'model']), referenceReviewKind: { type: ['string', 'null'], enum: ['agent_visual_review', 'human_review', null] }, sourceHumanVerified: { type: 'boolean' },
  calibrationStatus: choice(['not_calibrated_against_examiner_scores']), promptVersion: str(64), rubricVersion: str(100), assessedAt: str(40),
});

/** Small, dependency-free validator for the JSON Schema subset used above. */
export function validateSchema(schema, value, path = '$') {
  const errors = [];
  const walk = (s, v, p) => {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const valid = types.some(t => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : t === 'integer' ? Number.isSafeInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t);
    if (!valid) { errors.push(`${p}:type`); return; }
    if (v === null) return;
    if (s.enum && !s.enum.includes(v)) errors.push(`${p}:enum`);
    if (typeof v === 'string') {
      if (v.length < (s.minLength ?? 0) || v.length > (s.maxLength ?? Infinity) || s.minLength > 0 && !v.trim()) errors.push(`${p}:length`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${p}:pattern`);
    }
    if (typeof v === 'number' && (v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity) || s.multipleOf && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-8)) errors.push(`${p}:range`);
    if (Array.isArray(v)) {
      if (v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? Infinity)) errors.push(`${p}:items`);
      v.forEach((item, i) => walk(s.items, item, `${p}[${i}]`));
    } else if (typeof v === 'object') {
      for (const k of s.required ?? []) if (!Object.hasOwn(v, k)) errors.push(`${p}.${k}:required`);
      for (const [k, item] of Object.entries(v)) {
        if (!s.properties[k]) { if (s.additionalProperties === false) errors.push(`${p}:unknown_field`); }
        else walk(s.properties[k], item, `${p}.${k}`);
      }
    }
  };
  walk(schema, value, path); return errors;
}
export function assertSchema(schema, value, code = 'INVALID_OUTPUT') {
  const issues = validateSchema(schema, value);
  if (issues.length) throw new AlgorithmError(code, '数据未通过契约校验。', { retryable: code === 'INVALID_OUTPUT', details: issues.slice(0, 16) });
  return value;
}
