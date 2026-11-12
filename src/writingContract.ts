/**
 * 写作模块运行时数据契约 —— 与交接包对齐层
 *
 * 权威来源：tcamp-writing-frontend-handoff-v2/source/lib/demo.ts、lib/writing.ts
 * 交接说明：source/docs/handoff/FRONTEND.md §「当前运行时数据，不能与 D1 提案混用」
 *
 * 重要边界：
 * - docs/fixtures/writing-report.sample.json 是**旧 D1 提案**，不是 Workspace，禁止直接导入。
 * - 可恢复的运行时样例是 docs/handoff/runtime-workspace.sample.json，存储键 `tcamp-writing-demo:v1`。
 * - 本地 UUID 的 userId 不是登录身份，不能作为鉴权或账号隔离依据。
 * - 示例分数（sample/isExample）与本地规则反馈都**不是真实 AI 评估**，不得写入全站分数曲线。
 *
 * 本文件只做「运行时格式 → 站内统一 Report 信封」的单向适配，
 * 不改动写作模块源码，也不重算/覆盖任何已保存的报告快照。
 */
import {
  makeId,
  type FeedbackItem,
  type Recommendation,
  type Report,
  type ReportScore,
} from './contract'

// ---------------------------------------------------------------------------
// 1. 运行时类型（逐字对齐 lib/demo.ts 与 lib/writing.ts）
// ---------------------------------------------------------------------------
export type TopicId = 'transport' | 'education'
export type FeedbackMode = 'essay' | 'language'

/** UTF-16 0 基偏移；start 含、end 不含；paragraph / index 从 1 开始 */
export interface WritingSentence {
  id: string
  start: number
  end: number
  paragraph: number
  index: number
  text: string
  status: 'fix' | 'improve' | 'keep'
  reason: string
  suggestion: string
  change: string
}

export interface WritingReport {
  sample: boolean
  fragment: boolean
  count: number
  sentences: WritingSentence[]
  model: string
  upgrades: string[]
}

export interface WritingDraft {
  text: string
  parentId?: string
  applied: Record<string, WritingSentence>
  mode: FeedbackMode
  updatedAt: string
}

export interface WritingSubmission {
  id: string
  practiceId: string
  topicId: TopicId
  version: number
  parentId?: string
  text: string
  mode: FeedbackMode
  createdAt: string
  status: 'pending' | 'done' | 'failed'
  report?: WritingReport
  error?: string
  isExample: boolean
}

export interface WritingWorkspace {
  schemaVersion: 1
  userId: string
  topicId: TopicId
  drafts: Record<TopicId, WritingDraft>
  entries: WritingSubmission[]
}

export const WRITING_STORAGE_KEY = 'tcamp-writing-demo:v1'

// ---------------------------------------------------------------------------
// 2. D1 提案 ↔ 运行时字段映射（FRONTEND.md 的映射表，代码化）
// ---------------------------------------------------------------------------
export const WRITING_FIELD_MAP = [
  { d1: 'questionId', runtime: 'topicId', note: '题目标识，需要适配命名' },
  { d1: 'submissionId', runtime: 'Submission.id', note: '提交标识' },
  { d1: 'parentSubmissionId', runtime: 'parentId', note: '二稿来源' },
  { d1: 'submittedAt', runtime: 'createdAt', note: '当前没有独立 completedAt' },
  { d1: 'feedbackMode: essay / language_only', runtime: 'mode: essay / language', note: '枚举不同' },
  { d1: 'status: queued / processing / completed / timed_out / failed', runtime: 'status: pending / done / failed', note: 'timed_out 并入 failed，error 为说明文本' },
  { d1: 'sentenceId / startUtf16 / endUtf16', runtime: 'id / start / end', note: '同为 UTF-16 语义' },
  { d1: 'needs_revision / could_improve / keep', runtime: 'fix / improve / keep', note: '需要显式映射' },
  { d1: 'draftId / draftRevision / jobId / reportId', runtime: '—', note: '尚未实现，不得虚构补值并称为服务端 ID' },
  { d1: 'feedbackSource / scores / taskCoverage', runtime: 'sample + mode + getDiagnosis()', note: '不是 D1 报告结构' },
] as const

/** 三类批注语义：运行时状态 → D1 提案值 → 站内 severity → 全站视觉状态 */
export const SENTENCE_STATUS_MAP = {
  fix: { d1: 'needs_revision', severity: 'high', label: '需要修改', tone: 'fix' },
  improve: { d1: 'could_improve', severity: 'medium', label: '可以加强', tone: 'improve' },
  keep: { d1: 'keep', severity: 'low', label: '可保留', tone: 'keep' },
} as const satisfies Record<WritingSentence['status'], {
  d1: string; severity: FeedbackItem['severity']; label: string; tone: string
}>

/** 反馈来源：示例讲解 / 本地规则反馈 / 真实评估，三者不得相互替代 */
export type FeedbackSource = 'sample' | 'rule' | 'real'

export function describeFeedbackSource(submission: WritingSubmission): FeedbackSource {
  if (submission.report?.sample && submission.mode !== 'language') return 'sample'
  return 'rule'
}

export const FEEDBACK_SOURCE_LABEL: Record<FeedbackSource, string> = {
  sample: '示例讲解（预置演示，不是真实估分）',
  rule: '本地规则反馈（不估分、不做语义诊断）',
  real: '真实 AI 评估',
}

// ---------------------------------------------------------------------------
// 3. 四项必须保留的约束
// ---------------------------------------------------------------------------
export const WRITING_INVARIANTS = [
  '首稿不可变：每个 version 保存独立快照，二稿另存，不覆盖 parent.text',
  '重复句锚点：按 UTF-16 start/end 定位，禁止全局字符串替换',
  '手改冲突保护：应用建议前校验整份基准文本，冲突即拒绝并提示手动处理',
  '重试复用提交：pending 恢复为 failed 后复用同一份原稿重试，不新建空提交',
] as const

/** 锚点校验：必须满足 submission.text.slice(start, end) === sentence.text */
export function validateAnchor(text: string, sentence: WritingSentence): boolean {
  if (sentence.start < 0 || sentence.end <= sentence.start || sentence.end > text.length) return false
  if (sentence.paragraph < 1 || sentence.index < 1) return false
  return text.slice(sentence.start, sentence.end) === sentence.text
}

/**
 * 手改冲突保护（等价于 demo.ts 的 safelyApply 前置校验）：
 * 先按已应用建议从后往前重建「期望的当前草稿」，再确认句子锚点仍然有效。
 * 返回 null 表示检测到手动改动或锚点漂移，必须交给用户手动处理。
 */
export function assertNoManualConflict(
  draftText: string,
  parentText: string,
  applied: Record<string, WritingSentence>,
  sentence: WritingSentence,
): boolean {
  let expected = parentText
  for (const item of Object.values(applied).sort((a, b) => b.start - a.start)) {
    expected = expected.slice(0, item.start) + item.suggestion + expected.slice(item.end)
  }
  if (draftText !== expected) return false
  return validateAnchor(parentText, sentence) && !applied[sentence.id]
}

// ---------------------------------------------------------------------------
// 4. 运行时提交 → 站内统一 Report 信封
// ---------------------------------------------------------------------------
export interface AdaptOptions {
  userId: string
  /** 只有明确来自真实评估且已给出分数时才允许写入分数字段 */
  realAssessment?: { band: number; dimensions?: { key: string; label: string; score: number; comment: string }[] }
}

export function adaptWritingSubmission(submission: WritingSubmission, options: AdaptOptions): Report {
  const writingReport = submission.report
  const sentences = writingReport?.sentences ?? []
  const source = options.realAssessment ? 'real' : describeFeedbackSource(submission)
  const sourceLabel = FEEDBACK_SOURCE_LABEL[source]

  const feedback: FeedbackItem[] = sentences.map<FeedbackItem>((sentence) => {
    const mapped = SENTENCE_STATUS_MAP[sentence.status]
    return {
      id: `fb_${submission.id}:s:${sentence.start}`,
      type: 'sentence',
      location: {
        label: `第 ${sentence.paragraph} 段第 ${sentence.index} 句 · ${mapped.label} · UTF-16 [${sentence.start}, ${sentence.end})`,
        paragraph: sentence.paragraph,
        sentenceIndex: sentence.index,
        startUtf16: sentence.start,
        endUtf16: sentence.end,
      },
      quote: sentence.text,
      issue: sentence.change,
      why: sentence.reason,
      suggestion: sentence.suggestion === sentence.text
        ? `${sentence.change}（本地预览不自动改写原意，请自行判断是否采纳）`
        : `采用建议：${sentence.change}`,
      revised: sentence.suggestion === sentence.text ? undefined : sentence.suggestion,
      questionType: sentence.status === 'fix' ? '语法准确性' : sentence.status === 'improve' ? '论证与表达' : '可保留表达',
      severity: mapped.severity,
    }
  })

  const firstFix = sentences.find((item) => item.status === 'fix') ?? sentences.find((item) => item.status === 'improve')
  const recommendations: Recommendation[] = (writingReport?.upgrades ?? []).map((upgrade, i) => ({
    targetType: 'skill',
    targetId: `tsk_writing_${submission.topicId}_${i + 1}`,
    label: upgrade.split('：')[0] || `升级点 ${i + 1}`,
    reason: `${upgrade}。来源：${sourceLabel}；这是下一步最值得先改的一处，改完可直接进入二稿对比。`,
    cta: '针对性复练',
  }))
  if (recommendations.length === 0 && firstFix) {
    recommendations.push({
      targetType: 'questionType',
      targetId: firstFix.status,
      label: '先打磨被标注的句子',
      reason: `第 ${firstFix.paragraph} 段有明确标注：${firstFix.reason}`,
      cta: '去复练',
    })
  }

  const score: ReportScore = options.realAssessment
    ? {
      band: options.realAssessment.band,
      display: options.realAssessment.band.toFixed(1),
      trendMetric: 'writing_band',
      correct: null,
      total: null,
      firstTryCorrect: null,
    }
    : {
      band: null,
      display: '不估分',
      trendMetric: 'writing_band',
      correct: null,
      total: null,
      firstTryCorrect: null,
    }

  return {
    reportId: makeId('report'),
    attemptId: `atm_${submission.id}`,
    userId: options.userId,
    subject: 'writing',
    mode: 'task2',
    exerciseId: `exr_wr_${submission.topicId}`,
    status: submission.status === 'done' ? 'ready' : 'scoring',
    createdAt: submission.createdAt,
    score,
    dimensions: options.realAssessment?.dimensions ?? [
      { key: 'TR', label: '任务回应', score: 0, comment: source === 'real' ? '由真实评估给出' : '当前来源不提供估分，需真实 AI 语义评估' },
      { key: 'CC', label: '连贯与衔接', score: 0, comment: '逐段检查推理与连接' },
      { key: 'LR', label: '词汇表达', score: 0, comment: '根据句子建议检查用词' },
      { key: 'GRA', label: '语法多样性', score: 0, comment: source === 'sample' ? '示例四维为预置演示值，不作为真实成绩' : '只检查已支持的语法规则' },
    ],
    feedback,
    highlights: writingReport?.upgrades ?? [],
    recommendations,
    evidence: {
      feedbackSource: source,
      sourceLabel,
      isExample: submission.isExample,
      sample: writingReport?.sample ?? false,
      fragment: writingReport?.fragment ?? false,
      wordCount: writingReport?.count ?? null,
      underLength: (writingReport?.count ?? 250) < 250,
      version: submission.version,
      parentId: submission.parentId,
      practiceId: submission.practiceId,
      /** 保留完整句子锚点，供二稿与三栏对比使用；不可丢弃 start/end */
      sentences: sentences.map((s) => ({ ...s })),
      upgradedEssay: writingReport?.model,
      draftV2: submission.version > 1 ? submission.text : undefined,
    },
    original: {
      title: `Academic Task 2 · ${submission.topicId === 'transport' ? '公共交通与教育' : '大学教育的目的'} · 第 ${submission.version} 稿`,
      prompt: submission.topicId === 'transport'
        ? 'Some people believe that public transport should be free for all students. To what extent do you agree or disagree?'
        : 'Some people think that universities should prepare students for employment, while others believe that universities should focus on knowledge for its own sake. Discuss both views and give your own opinion.',
      answers: {},
      submittedText: submission.text,
    },
    retakeOf: submission.parentId ? `atm_${submission.parentId}` : undefined,
  }
}

/** 只有真实评估且给出分数，才允许进入全站分数曲线（FRONTEND.md 接入建议第 7 条） */
export function isCurveEligible(report: Report): boolean {
  return report.evidence.feedbackSource === 'real' && report.score.band !== null
}
