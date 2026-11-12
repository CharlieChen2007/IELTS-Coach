import type { Attempt, Mode, Report } from './contract'
import { todayKey } from './logic'
import { repository } from './repository'

/* 保留词汇旧书签的识别，实际入口由 speakingPath 和 parseHash 转到独立词汇页。 */
const entryPoints = ['studio', 'full', 'quick', 'history', 'practice', 'daily', 'daily-library', 'daily-history', 'vocab', 'campus', 'campus-team']
const sessionId = /^[\w-]{1,100}$/

export function isSpeakingView(value: unknown): value is string {
  return typeof value === 'string' &&
    (entryPoints.includes(value) || /^(exam|dialogue)\/[\w-]{1,100}$/.test(value))
}

export function speakingPath(view: string): string {
  if (view === 'vocab') return 'vocabulary'
  return view === 'studio' ? 'subject/speaking' : 'subject/speaking?view=' + encodeURIComponent(view)
}

let unsaved = false
export function setSpeakingBusy(active: boolean) {
  unsaved = active
}
export function mayLeaveSpeaking() {
  return !unsaved || window.confirm('口语练习仍在进行。离开可能中断本轮作答，确定离开吗？')
}

type Row = Record<string, unknown>
function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Date.now() + 60000
}
function readPairReviews(value: unknown): NonNullable<Report['evidence']['pairReviews']> {
  if (!Array.isArray(value)) return []
  const reviews: NonNullable<Report['evidence']['pairReviews']> = []
  for (const row of value.slice(0, 2)) {
    if (!isRow(row) || !isRow(row.feedback) || (row.round !== 1 && row.round !== 2)
      || (row.role !== 'candidate' && row.role !== 'examiner') || typeof row.question !== 'string') continue
    const { strength, improve, retry } = row.feedback
    if (typeof strength !== 'string' || typeof improve !== 'string' || typeof retry !== 'string') continue
    reviews.push({ round: row.round, role: row.role, question: row.question.slice(0, 1400),
      extraQuestions: Array.isArray(row.extraQuestions) ? row.extraQuestions.filter((q): q is string => typeof q === 'string').slice(0, 5).map(q => q.slice(0, 1000)) : [],
      feedback: { strength: strength.slice(0, 500), improve: improve.slice(0, 500), retry: retry.slice(0, 500) } })
  }
  return reviews
}

/** Mirror completed sessions into the site's records without copying audio or synthesizing a score. */
export function saveSpeakingResult(userId: string, data: unknown, retakeOf?: string): boolean {
  if (!isRow(data) || typeof data.id !== 'string' || !sessionId.test(data.id)
    || !['exam', 'dialogue', 'pair'].includes(String(data.kind))
    || !isTime(data.endedAt) || !isTime(data.startedAt) || data.startedAt > data.endedAt
    || typeof data.turns !== 'number' || !Number.isInteger(data.turns) || data.turns < 1 || data.turns > 100) return false
  const mode: Mode = data.kind === 'dialogue' ? 'free' : data.kind === 'pair' ? 'pair' : data.mode === 'full' ? 'mock' : 'quick'
  const view = data.kind === 'pair' ? 'campus' : (data.kind === 'exam' ? 'exam/' : 'dialogue/') + data.id
  const suffix = 'sp_' + data.kind + '_' + data.id
  const reportId = 'rpt_' + suffix
  const attemptId = 'atm_' + suffix
  const prev = repository.getReport(userId, reportId)
  const priorAttempt = repository.getAttempt(userId, attemptId)
  const band = mode === 'mock' && typeof data.band === 'number' && data.band >= 0 && data.band <= 9 && Number.isInteger(data.band * 2)
    ? data.band : prev?.score.band ?? null
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : '口语练习'
  const ended = new Date(data.endedAt)
  const exerciseId = mode === 'free' ? 'exr_sp_free_01' : mode === 'mock' ? 'exr_sp_mock_01' : 'exr_sp_' + mode
  const turns: NonNullable<Report['evidence']['turns']> = []
  if (Array.isArray(data.responses)) {
    for (const row of data.responses.slice(0, 80)) {
      if (!isRow(row)) continue
      if (typeof row.question === 'string' && row.question.trim()) turns.push({ role: 'examiner', text: row.question.slice(0, 1400) })
      if (typeof row.answer === 'string' && row.answer.trim()) turns.push({ role: 'candidate', text: row.answer.slice(0, 4800) })
    }
  }
  const source = priorAttempt?.retakeOf || (retakeOf && repository.getAttempt(userId, retakeOf)?.subject === 'speaking' ? retakeOf : undefined)
  const reviews = mode === 'pair' ? readPairReviews(data.pairReviews) : []
  const attempt: Attempt = { attemptId, reportId, userId, exerciseId, subject: 'speaking', mode, title,
    createdAt: new Date(data.startedAt).toISOString(), submittedAt: ended.toISOString(), status: 'ready', progress: 100, answers: {}, retakeOf: source }
  const report: Report = { reportId, attemptId, userId, exerciseId, subject: 'speaking', mode, status: 'ready',
    createdAt: ended.toISOString(), retakeOf: source,
    score: { band, display: band === null ? prev?.score.display ?? '已完成' : band.toFixed(1), trendMetric: mode === 'mock' ? 'speaking_mock_band' : '', correct: null, total: null, firstTryCorrect: null },
    feedback: [], dimensions: [], recommendations: [], highlights: [],
    evidence: { ...prev?.evidence, speakingView: view, turnCount: data.turns, turns: turns.length ? turns : prev?.evidence.turns ?? [],
      pairReviews: reviews.length ? reviews : prev?.evidence.pairReviews },
    original: { title, prompt: '', answers: {} } }
  const changed = !prev || JSON.stringify(prev) !== JSON.stringify(report)
  if (changed) repository.saveReport(report)
  if (!priorAttempt) repository.saveAttempt(attempt)
  const daily = repository.getDaily(userId, todayKey(ended))
  const bucket = source ? 'retake' : 'newPractice'
  if (!daily[bucket].includes(attemptId)) {
    repository.saveDaily(userId, { ...daily, [bucket]: [...daily[bucket], attemptId] })
  }
  return changed || !priorAttempt
}
