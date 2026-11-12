/**
 * 第一天协作契约（代码化）
 * 本文件是全队唯一的字段与编号来源；其余五人按此对接。
 * 详见 docs/CONTRACT.md
 */

// ---------------------------------------------------------------------------
// 1. 唯一编号
// ---------------------------------------------------------------------------
const PREFIX = {
  user: 'usr',
  exercise: 'exr',
  attempt: 'atm',
  report: 'rpt',
  feedback: 'fb',
  mistake: 'mis',
  task: 'tsk',
  // 校园营地（campStore.ts 使用）
  camp: 'cusr',
  post: 'post',
  req: 'req',
  pts: 'pt',
} as const

export type IdPrefix = keyof typeof PREFIX

let seq = 0
/** <prefix>_<base36 时间戳><2 位序号><4 位随机>，URL 安全、可排序、全局唯一 */
export function makeId(prefix: IdPrefix): string {
  seq = (seq + 1) % 1296
  const stamp = Date.now().toString(36)
  const order = seq.toString(36).padStart(2, '0')
  const salt = Math.random().toString(36).slice(2, 6)
  return `${PREFIX[prefix]}_${stamp}${order}${salt}`
}

// ---------------------------------------------------------------------------
// 2. 枚举
// ---------------------------------------------------------------------------
export const SUBJECT_ORDER = ['listening', 'speaking', 'reading', 'writing'] as const
export type Subject = typeof SUBJECT_ORDER[number]
export type Mode = 'mock' | 'quick' | 'pair' | 'free' | 'task2' | 'passage' | 'section' | 'retake'
export type AttemptStatus = 'draft' | 'scoring' | 'ready'
export type ReviewStatus = 'pending' | 'reviewed'

/** 学科色收敛为同一套蓝色深浅：模块差异靠图标与栏目名，不另建主题（DESIGN.md §1） */
export const SUBJECT_META: Record<Subject, { label: string; short: string; color: string; soft: string }> = {
  speaking: { label: '口语', short: 'S', color: '#2f6b8f', soft: '#cfe6f6' },
  writing: { label: '写作', short: 'W', color: '#2f6b8f', soft: '#dbeefa' },
  listening: { label: '听力', short: 'L', color: '#2f6b8f', soft: '#e3f1fd' },
  reading: { label: '阅读', short: 'R', color: '#2f6b8f', soft: '#e6eff6' },
}

export const MODE_LABEL: Record<Mode, string> = {
  mock: '全流程模考',
  quick: '快速演练',
  pair: '双人模拟考',
  free: '自由对话',
  task2: 'Task 2 单篇',
  passage: '篇章精练',
  section: 'Section 精练',
  retake: '针对性复练',
}

// ---------------------------------------------------------------------------
// 3. 领域对象
// ---------------------------------------------------------------------------
export interface UserProfile {
  officialIeltsBand?: number
  userId: string
  nickname: string
  targetBand: number
  createdAt: string
  email?: string
}

export interface Question {
  id: string
  type: string
  text: string
  options?: string[]
  answer?: string
}

export interface AudioSegment {
  startSec: number
  endSec: number
  text: string
}

export interface Practice {
  exerciseId: string
  subject: Subject
  mode: Mode
  title: string
  subtitle: string
  durationMin: number
  questionTypes: string[]
  prompt: string
  questions: Question[]
  material?: {
    passage?: string
    paragraphs?: string[]
    transcript?: string
    audioSegments?: AudioSegment[]
    part1?: string[]
    part2?: { topic: string; cueCard: string[]; prepSec: number; talkSec: number }
    part3?: string[]
  }
}

export interface Attempt {
  attemptId: string
  userId: string
  exerciseId: string
  subject: Subject
  mode: Mode
  title: string
  status: AttemptStatus
  createdAt: string
  submittedAt?: string
  answers: Record<string, string>
  draftText?: string
  reportId?: string
  /** 评分中任务的进度 0-100，刷新后据此恢复 */
  progress: number
  retakeOf?: string
  focus?: string
}

export interface FeedbackLocation {
  label: string
  sentenceIndex?: number
  paragraph?: number
  /** 写作模块 UTF-16 句子锚点：0 基，start 含、end 不含 */
  startUtf16?: number
  endUtf16?: number
  startSec?: number
  endSec?: number
  questionId?: string
}

/** 一条「有依据的反馈」：必须同时给出证据、错因与改法 */
export interface FeedbackItem {
  id: string
  type: 'sentence' | 'question' | 'utterance' | 'audio' | 'paragraph'
  location: FeedbackLocation
  quote: string
  issue: string
  why: string
  suggestion: string
  revised?: string
  questionType: string
  severity: 'high' | 'medium' | 'low'
}

export interface Dimension {
  key: string
  label: string
  score: number
  comment: string
}

/** 「下一步练什么」——每条推荐都要写明理由 */
export interface Recommendation {
  targetType: 'questionType' | 'exercise' | 'skill'
  targetId: string
  label: string
  reason: string
  cta: string
}

export interface ReportScore {
  band: number | null
  display: string
  trendMetric: string
  correct: number | null
  total: number | null
  firstTryCorrect: number | null
}

/** 统一报告信封：四科共用，科目差异放进 evidence */
export interface SpeechEvaluation {
  key: string
  label: string
  state: 'queued' | 'working' | 'waiting-session' | 'ready' | 'error'
  accuracy?: number | null
  fluency?: number | null
  scored?: number
  segments?: number
  words?: { word: string; accuracy: number }[]
  message?: string
  durationMs?: number
}

export interface ListeningAnswer {
  id: string
  number: number
  prompt: string
  options: string[]
  status: 'correct' | 'wrong' | 'missed'
  answer: string
  accepted: string[]
  questionType: string
  reason: string
  explanation: string
  suggestion: string
  quote: string
  start: number | null
  end: number | null
}

export interface Report {
  reportId: string
  attemptId: string
  userId: string
  subject: Subject
  mode: Mode
  exerciseId: string
  status: 'scoring' | 'ready'
  createdAt: string
  score: ReportScore
  dimensions: Dimension[]
  feedback: FeedbackItem[]
  highlights: string[]
  recommendations: Recommendation[]
  evidence: {
    audioUrl?: string
    listeningItems?: ListeningAnswer[]
    transcript?: string
    segments?: AudioSegment[]
    passage?: string
    paragraphs?: string[]
    sentences?: { index: number; text: string }[]
    upgradedEssay?: string
    draftV2?: string
    turns?: { role: 'examiner' | 'candidate'; text: string; atSec?: number }[]
    speechScores?: SpeechEvaluation[]
    pairReviews?: {
      round: number
      role: 'candidate' | 'examiner'
      question: string
      extraQuestions: string[]
      feedback: { strength: string; improve: string; retry: string }
    }[]
    [key: string]: unknown
  }
  /** 当时的题目与作答快照，保证历史记录可完整回放 */
  original: {
    title: string
    prompt: string
    answers: Record<string, string>
    submittedText?: string
  }
  retakeOf?: string
}

export interface Mistake {
  listeningSection?: string
  listeningItem?: string
  listeningUpdated?: string
  archived?: boolean
  mistakeId: string
  attemptId: string
  reportId: string
  userId: string
  subject: Subject
  questionType: string
  reviewStatus: ReviewStatus
  createdAt: string
  excerpt: string
  why: string
  suggestion: string
  locationLabel: string
}

/** 每日两格任务；用 attemptId 集合保证「同一提交只计一次」 */
export interface DailyTaskState {
  date: string
  newPractice: string[]
  retake: string[]
}

export interface ScorePoint {
  attemptId: string
  reportId: string
  date: string
  value: number
  label: string
  correct: number | null
  total: number | null
  firstTryCorrect: number | null
}

// ---------------------------------------------------------------------------
// 4. 数据层接口（第五天可整体替换为真实服务实现）
// ---------------------------------------------------------------------------
export interface Repository {
  getProfile(userId: string): UserProfile | null
  saveProfile(profile: UserProfile): void
  listAttempts(userId: string): Attempt[]
  getAttempt(userId: string, attemptId: string): Attempt | null
  saveAttempt(attempt: Attempt): void
  listReports(userId: string): Report[]
  getReport(userId: string, reportId: string): Report | null
  saveReport(report: Report): void
  listMistakes(userId: string): Mistake[]
  saveMistake(mistake: Mistake): void
  getDaily(userId: string, date: string): DailyTaskState
  saveDaily(userId: string, state: DailyTaskState): void
}
