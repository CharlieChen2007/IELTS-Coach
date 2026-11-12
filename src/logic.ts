import {
  makeId,
  type Attempt,
  type DailyTaskState,
  type FeedbackItem,
  type Mistake,
  type Mode,
  type Practice,
  type Report,
  type ScorePoint,
  type Subject,
} from './contract'
import { repository } from './repository'
import { SAMPLE_REPORTS, findPractice } from './seed'

// ---------------------------------------------------------------------------
// 日期与展示
// ---------------------------------------------------------------------------
export function todayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysAgoKey(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return todayKey(date)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const h = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${m}-${d} ${h}:${min}`
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

// ---------------------------------------------------------------------------
// 评分接口：前端只负责发起与展示，判题规则由各科模块提供
// ---------------------------------------------------------------------------
export interface ScoringAdapter {
  score(attempt: Attempt, practice: Practice | undefined): Promise<Report>
}

/** Demo 适配器：按契约返回各科样例报告；第五天替换为真实模块接口 */
export const sampleScoringAdapter: ScoringAdapter = {
  async score(attempt, practice) {
    return buildReportForAttempt(attempt, practice)
  },
}

export function buildReportForAttempt(attempt: Attempt, practice: Practice | undefined): Report {
  const template = SAMPLE_REPORTS[attempt.exerciseId]
  const fallback = SAMPLE_REPORTS['exr_re_pass_01']
  const base = template ?? fallback
  const sentences = attempt.draftText ? splitSentences(attempt.draftText) : []

  let feedback: FeedbackItem[] = base.feedback.map((item, index) => {
    const baseItem: FeedbackItem = { ...item, id: makeId('feedback') }
    if (attempt.subject === 'writing' && sentences.length > 0) {
      return {
        ...baseItem,
        quote: sentences[index] ?? item.quote,
        location: {
          ...item.location,
          sentenceIndex: index + 1,
          label: `第 ${index + 1} 句 · ${item.location.label.split('· ').slice(1).join('· ') || '正文'}`,
        },
      }
    }
    return baseItem
  })

  const evidence = { ...base.evidence, submittedByUser: !!attempt.submittedAt } as Report['evidence']
  let score = base.score
  if (practice && ['reading','listening'].includes(practice.subject)) {
    const normalize = (v:string) => v.toLowerCase().trim().replace(/[’']/g,"'").replace(/[-\s]+/g,' ').replace(/^45$/, 'forty five')
    const questions = practice.questions.filter(q => q.answer)
    const errors = questions.filter(q => normalize(attempt.answers[q.id] ?? '') !== normalize(q.answer!))
    feedback = errors.map(q => {
      const sample = base.feedback.find(f=>f.location.questionId === q.id)
      const answer = attempt.answers[q.id]?.trim() || '未作答'
      return { id:makeId('feedback'), type:'question', questionType:q.type, severity:'medium',
        location:{...sample?.location,questionId:q.id,label:sample?.location.label ?? q.text},
        quote:q.text, issue:'本次作答：'+answer, why:'题库答案为 '+q.answer+'。',
        suggestion:practice.subject==='listening'?'回听材料并记下支持答案的关键词。':'在对应段落中标出支持答案的原句。' }
    })
    const correct=questions.length-errors.length
    score = {...base.score, correct, total:questions.length, display:correct+'/'+questions.length, firstTryCorrect:null}
  }
  if (attempt.retakeOf && attempt.subject === 'writing' && attempt.draftText) {
    evidence.draftV2 = attempt.draftText
  }

  return {
    ...base,
    score,
    reportId: makeId('report'),
    attemptId: attempt.attemptId,
    userId: attempt.userId,
    exerciseId: attempt.exerciseId,
    subject: attempt.subject,
    mode: attempt.mode,
    status: 'ready',
    createdAt: new Date().toISOString(),
    feedback,
    evidence,
    retakeOf: attempt.retakeOf,
    original: {
      title: attempt.title,
      prompt: practice?.prompt ?? base.original.prompt,
      answers: attempt.answers,
      submittedText: attempt.draftText ?? base.original.submittedText,
    },
  }
}

// ---------------------------------------------------------------------------
// 提交 / 异步评分 / 刷新恢复
// ---------------------------------------------------------------------------
export function createAttempt(params: {
  userId: string
  practice: Practice
  answers?: Record<string, string>
  draftText?: string
  retakeOf?: string
  focus?: string
}): Attempt {
  return {
    attemptId: makeId('attempt'),
    userId: params.userId,
    exerciseId: params.practice.exerciseId,
    subject: params.practice.subject,
    mode: params.practice.mode,
    title: params.practice.title,
    status: 'draft',
    createdAt: new Date().toISOString(),
    answers: params.answers ?? {},
    draftText: params.draftText,
    progress: 0,
    retakeOf: params.retakeOf,
    focus: params.focus,
  }
}

// ---------------------------------------------------------------------------
export function submitAttempt(attempt: Attempt): Attempt {
  const next: Attempt = {
    ...attempt,
    status: 'scoring',
    submittedAt: new Date().toISOString(),
    progress: attempt.progress > 0 ? attempt.progress : 8,
  }
  repository.saveAttempt(next)
  return next
}

/** 返回进度推进后的 attempt；到达 100 时落报告、错题本与每日任务 */
export function tickScoring(attempt: Attempt, step = 17): Attempt {
  if (attempt.status !== 'scoring') return attempt
  const progress = Math.min(100, attempt.progress + step)
  if (progress < 100) {
    const next = { ...attempt, progress }
    repository.saveAttempt(next)
    return next
  }
  const report = buildReportForAttempt(attempt, findPractice(attempt.exerciseId))
  repository.saveReport(report)

  for (const item of report.feedback) {
    if (item.severity === 'low') continue
    const mistake: Mistake = {
      mistakeId: makeId('mistake'),
      attemptId: attempt.attemptId,
      reportId: report.reportId,
      userId: attempt.userId,
      subject: attempt.subject,
      questionType: item.questionType,
      reviewStatus: 'pending',
      createdAt: report.createdAt,
      excerpt: item.quote,
      why: item.why,
      suggestion: item.suggestion,
      locationLabel: item.location.label,
    }
    repository.saveMistake(mistake)
  }

  const daily = repository.getDaily(attempt.userId, todayKey())
  const bucket: keyof Omit<DailyTaskState, 'date'> = attempt.retakeOf || attempt.mode === 'retake' ? 'retake' : 'newPractice'
  if (!daily[bucket].includes(attempt.attemptId)) {
    daily[bucket] = [...daily[bucket], attempt.attemptId]
    repository.saveDaily(attempt.userId, daily)
  }

  const ready: Attempt = { ...attempt, status: 'ready', progress: 100, reportId: report.reportId }
  repository.saveAttempt(ready)
  return ready
}

export function dailyState(userId: string): DailyTaskState {
  return repository.getDaily(userId, todayKey())
}

// ---------------------------------------------------------------------------
// 分数曲线
// ---------------------------------------------------------------------------
export const TREND_GROUPS: { key: string; label: string; unit: string; color: string }[] = [
  { key: 'listening_correct', label: '听力正确数', unit: '题', color: '#a6d7f0' },
  { key: 'speaking_mock_band', label: '完整口语模考', unit: '分', color: '#254b65' },
  { key: 'reading_correct', label: '阅读正确数', unit: '题', color: '#73accd' },
  { key: 'writing_band', label: '写作单篇估分', unit: '分', color: '#397fb5' },
]

export function scorePoints(reports: Report[], metric: string): ScorePoint[] {
  return reports
    .filter((report) => report.status === 'ready' && report.score.trendMetric === metric)
    .filter((report) => metric.endsWith('_band') ? report.score.band !== null : report.score.correct !== null)
    .map((report) => ({
      attemptId: report.attemptId,
      reportId: report.reportId,
      date: report.createdAt,
      value: metric.endsWith('_band') ? (report.score.band ?? 0) : (report.score.correct ?? 0),
      label: metric.endsWith('_band') ? `${report.score.display} 分` : `${report.score.correct} / ${report.score.total} 题`,
      correct: report.score.correct,
      total: report.score.total,
      firstTryCorrect: report.score.firstTryCorrect,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------------
export interface AttemptFilter {
  subject: Subject | 'all'
  mode: Mode | 'all'
  dateFrom: string
  dateTo: string
}

export function filterAttempts(attempts: Attempt[], filter: AttemptFilter): Attempt[] {
  return attempts.filter((attempt) => {
    if (filter.subject !== 'all' && attempt.subject !== filter.subject) return false
    if (filter.mode !== 'all' && attempt.mode !== filter.mode) return false
    const date = attempt.createdAt.slice(0, 10)
    if (filter.dateFrom && date < filter.dateFrom) return false
    if (filter.dateTo && date > filter.dateTo) return false
    return true
  })
}

export interface MistakeFilter {
  subject: Subject | 'all'
  questionType: string
  reviewStatus: 'all' | 'pending' | 'reviewed'
}

export function filterMistakes(mistakes: Mistake[], filter: MistakeFilter): Mistake[] {
  return mistakes.filter((mistake) => {
    if (filter.subject !== 'all' && mistake.subject !== filter.subject) return false
    if (filter.questionType && mistake.questionType !== filter.questionType) return false
    if (filter.reviewStatus !== 'all' && mistake.reviewStatus !== filter.reviewStatus) return false
    return true
  })
}

/** 按未复习错题数量给出首页「去复习」提示 */
export function reviewSummary(mistakes: Mistake[]): { total: number; bySubject: Partial<Record<Subject, number>> } {
  const pending = mistakes.filter((item) => item.reviewStatus === 'pending' && !item.archived)
  const bySubject: Partial<Record<Subject, number>> = {}
  for (const item of pending) bySubject[item.subject] = (bySubject[item.subject] ?? 0) + 1
  return { total: pending.length, bySubject }
}

// ---------------------------------------------------------------------------
// 演示记录：把六模块样例数据铺成一段真实可点的历史，供验收时快速查看各页面
// ---------------------------------------------------------------------------
export function seedDemoHistory(userId: string): number {
  if (repository.listAttempts(userId).length > 0) return 0
  const plan: { exerciseId: string; daysAgo: number }[] = [
    { exerciseId: 'exr_sp_mock_01', daysAgo: 13 },
    { exerciseId: 'exr_re_pass_01', daysAgo: 11 },
    { exerciseId: 'exr_li_sec_01', daysAgo: 9 },
    { exerciseId: 'exr_wr_task2_01', daysAgo: 7 },
    { exerciseId: 'exr_re_retake_01', daysAgo: 6 },
    { exerciseId: 'exr_wr_retake_01', daysAgo: 4 },
    { exerciseId: 'exr_sp_free_01', daysAgo: 3 },
    { exerciseId: 'exr_li_retake_01', daysAgo: 1 },
  ]
  for (const entry of plan) {
    const practice = findPractice(entry.exerciseId)
    if (!practice) continue
    const date = new Date()
    date.setDate(date.getDate() - entry.daysAgo)
    date.setHours(9 + (entry.daysAgo % 8), 20, 0, 0)
    const submittedAt = date.toISOString()
    const attempt: Attempt = {
      ...createAttempt({ userId, practice }),
      createdAt: submittedAt,
      submittedAt,
      status: 'ready',
      progress: 100,
    }
    const report = buildReportForAttempt(attempt, practice)
    report.evidence.demoRecord = true
    report.createdAt = submittedAt
    attempt.reportId = report.reportId
    repository.saveAttempt(attempt)
    repository.saveReport(report)
    for (const item of report.feedback) {
      if (item.severity === 'low') continue
      repository.saveMistake({
        mistakeId: makeId('mistake'),
        attemptId: attempt.attemptId,
        reportId: report.reportId,
        userId,
        subject: attempt.subject,
        questionType: item.questionType,
        reviewStatus: item.severity === 'medium' ? 'reviewed' : 'pending',
        createdAt: submittedAt,
        excerpt: item.quote,
        why: item.why,
        suggestion: item.suggestion,
        locationLabel: item.location.label,
      })
    }
  }
  // 一份未完成草稿：老账号回来应看到「继续写作」
  const writing = findPractice('exr_wr_task2_01')
  if (writing) {
    repository.saveAttempt(createAttempt({
      userId,
      practice: writing,
      draftText: 'Some people think university should be free. In this essay I will discuss both views. First of all, the government pay',
    }))
  }
  return plan.length
}
