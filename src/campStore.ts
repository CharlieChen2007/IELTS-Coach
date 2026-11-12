/**
 * 校园营地 · 数据契约与本地存储
 *
 * 设计原则（与 contract.ts 一致）：
 *   - 所有实体都有稳定编号，便于云端 upsert 与跨端同步；
 *   - 本文件只负责「结构 + 读写」，不含 UI；
 *   - 与云数据库对接时，一张表对应一个集合（见 docs 注释）。
 *
 * 编号前缀：camp_ 营地、cusr_ 营地成员、post_ 搭子帖、req_ 申请、pt_ 积分流水
 */
import { makeId } from './contract'

const CAMP_KEY = 'ielts_camp_v1'

// ---------------------------------------------------------------------------
// 实体
// ---------------------------------------------------------------------------

/** 校园认证信息：认证后「校园认证」按钮变为「校园营地」 */
export interface CampusProfile {
  userId: string
  school: string
  /** 校区（新明 = 校区，按需求原文保留字段） */
  campus: string
  grade: string
  major: string
  className: string
  studentNo: string
  verifiedAt: string
}

/** 一条学习活动产生的积分流水 */
export interface PointsEntry {
  id: string
  userId: string
  school: string
  /** 来源：练习完成 / 复练 / 复习错题 / 每日任务 */
  kind: 'practice' | 'retake' | 'review' | 'daily'
  /** 难度 1-3，越高积分越多 */
  difficulty: 1 | 2 | 3
  points: number
  label: string
  createdAt: string
}

export interface CampUser {
  userId: string
  nickname: string
  school: string
  grade: string
  major: string
  className: string
  targetBand: number
  points: number
  /** 个人画像：需求标签（由问卷生成） */
  tags: string[]
  /** 是否已生成个人画像 */
  hasPortrait: boolean
  updatedAt: string
}

/** 搭子帖：用户主动发布「寻找搭子」 */
export interface CampPost {
  postId: string
  userId: string
  nickname: string
  school: string
  /** 想练的科目 */
  subjects: string[]
  /** 目标分区间 */
  bandGoal: string
  /** 每周可练时段 */
  schedule: string
  intro: string
  tags: string[]
  createdAt: string
}

/** 搭子申请：需要对方接受/拒绝 */
export interface CampRequest {
  requestId: string
  fromUserId: string
  fromNickname: string
  toUserId: string
  /** 匹配度 0-100，由画像相似度算出 */
  score: number
  reason: string
  message: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export interface CampStore {
  profile?: CampusProfile
  points: PointsEntry[]
  posts: CampPost[]
  requests: CampRequest[]
  /** 已建立的搭子关系（接受申请后产生） */
  partners: string[]
  /** 营地内其他成员（演示数据 + 同校真实用户） */
  members: CampUser[]
  /** 个人画像问卷答案 */
  portrait?: Record<string, string>
}

// ---------------------------------------------------------------------------
// 积分规则
// ---------------------------------------------------------------------------
export const DIFFICULTY: Record<1 | 2 | 3, { label: string; points: number }> = {
  1: { label: '基础', points: 10 },
  2: { label: '进阶', points: 25 },
  3: { label: '挑战', points: 50 },
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------
type CampStores = Record<string, CampStore>

function readAll(): CampStores {
  try {
    const raw = localStorage.getItem(CAMP_KEY)
    return raw ? (JSON.parse(raw) as CampStores) : {}
  } catch {
    return {}
  }
}

function writeAll(all: CampStores): void {
  try {
    localStorage.setItem(CAMP_KEY, JSON.stringify(all))
  } catch {
    /* 隐私模式下静默失败，不阻断页面 */
  }
}

export function emptyCamp(): CampStore {
  return { points: [], posts: [], requests: [], partners: [], members: [] }
}

export function readCamp(userId: string): CampStore {
  return readAll()[userId] ?? emptyCamp()
}

export function writeCamp(userId: string, store: CampStore): void {
  const all = readAll()
  all[userId] = store
  writeAll(all)
}

export function updateCamp(userId: string, patch: (store: CampStore) => CampStore): CampStore {
  const next = patch(readCamp(userId))
  writeCamp(userId, next)
  return next
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------
export function addPoints(userId: string, school: string, input: Omit<PointsEntry, 'id' | 'userId' | 'school' | 'createdAt'>): PointsEntry {
  const entry: PointsEntry = {
    ...input,
    id: makeId('pts'),
    userId,
    school,
    createdAt: new Date().toISOString(),
  }
  updateCamp(userId, (store) => ({ ...store, points: [entry, ...store.points].slice(0, 200) }))
  return entry
}

export function totalPoints(store: CampStore): number {
  return store.points.reduce((sum, item) => sum + item.points, 0)
}

/** 同一学校内按积分排名 */
export interface RankRow {
  userId: string
  nickname: string
  points: number
  rank: number
  isMe: boolean
}

export function rankOf(store: CampStore, userId: string, nickname: string): RankRow[] {
  const myPoints = totalPoints(store)
  const rows = [
    ...store.members.filter((m) => m.userId !== userId).map((m) => ({ userId: m.userId, nickname: m.nickname, points: m.points })),
    { userId, nickname, points: myPoints },
  ]
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({ ...row, rank: index + 1, isMe: row.userId === userId }))
  return rows
}

export function pendingRequests(store: CampStore, userId: string): CampRequest[] {
  return store.requests.filter((r) => r.toUserId === userId && r.status === 'pending')
}

/**
 * 同校演示成员：认证时写入，让排行榜与匹配有真实可点的对象。
 * 真实环境由云端按 school 字段拉取，这里仅作前端演示与验收。
 */
export function seedMembers(school: string): CampUser[] {
  const now = new Date().toISOString()
  const make = (name: string, grade: string, major: string, band: number, points: number, tags: string[]): CampUser => ({
    userId: `cusr_demo_${name}`,
    nickname: name,
    school,
    grade,
    major,
    className: `${major.slice(0, 2)} 2301`,
    targetBand: band,
    points,
    tags,
    hasPortrait: true,
    updatedAt: now,
  })
  return [
    make('陈可', '大三', '英语语言文学', 7, 980, ['口语', '口语对话练习', '晚上', '每周 3-4 次', '6.0 - 6.5']),
    make('林一苇', '大二', '翻译', 6.5, 860, ['写作', '轮流批改作文', '周末为主', '每周 1-2 次', '5.5 - 6.0']),
    make('苏黎', '大四', '商务英语', 7.5, 1240, ['听力', '一起模考对答案', '工作日上午', '每天', '7.0 以上']),
    make('周梧', '大三', '英语语言文学', 6, 620, ['阅读', '互相提问抽查', '晚上', '每周 3-4 次', '5.5 - 6.0']),
    make('何岸', '研一', '学科教学（英语）', 7, 1105, ['口语', '口语对话练习', '工作日下午', '每周 3-4 次', '6.0 - 6.5']),
    make('许唯', '大二', '英语', 6.5, 415, ['写作', '轮流批改作文', '晚上', '每周 1-2 次', '5.5 - 6.0']),
  ]
}
