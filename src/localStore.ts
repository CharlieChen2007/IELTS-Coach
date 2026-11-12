import type { Attempt, DailyTaskState, Mistake, Report, UserProfile } from './contract'

/**
 * 本地即时镜像（不是权威数据源）。
 * 云账号模式下，云数据库是唯一权威：登录后由 cloudSync.hydrateCloud 覆盖本桶，
 * 每次写入先更新镜像以获得同步的 UI 体验，再由 cloudSync 推送到云端。
 * 演示模式下它就是全部存储，按 userId 分桶实现账号隔离。
 */
const STORE_KEY = 'ielts_coach_v1'

export interface Bucket {
  profile?: UserProfile
  attempts: Attempt[]
  reports: Report[]
  mistakes: Mistake[]
  daily: Record<string, DailyTaskState>
}

export type Store = Record<string, Bucket>

export function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

export function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // 隐私模式或容量不足：不阻断页面；云账号模式的同步状态会给出可见提示
  }
}

export function emptyBucket(): Bucket {
  return { attempts: [], reports: [], mistakes: [], daily: {} }
}

export function bucketOf(userId: string): Bucket {
  return readStore()[userId] ?? emptyBucket()
}

export function saveBucket(userId: string, bucket: Bucket): void {
  const store = readStore()
  store[userId] = bucket
  writeStore(store)
}

export function clearBucket(userId: string): void {
  const store = readStore()
  delete store[userId]
  writeStore(store)
}

export function upsert<T>(list: T[], item: T, key: (value: T) => string, id: string): T[] {
  const index = list.findIndex((entry) => key(entry) === id)
  if (index === -1) return [item, ...list]
  const next = list.slice()
  next[index] = item
  return next
}
