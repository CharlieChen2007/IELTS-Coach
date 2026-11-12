import type { Attempt, DailyTaskState, Mistake, Report, UserProfile } from './contract'
import { getCloud } from './cloud'
import { bucketOf, emptyBucket, saveBucket, type Bucket } from './localStore'

/**
 * 云数据库同步层（权威数据源：public.ielts_records）。
 *
 * - 表由管理端创建：owner_id TEXT NOT NULL DEFAULT auth.uid()，RLS owner-only 策略。
 *   owner_id 由数据库填充，前端绝不传递；subject_user_id 只是业务账号编号，用于查询分组。
 * - 登录后 hydrateCloud() 从云端恢复当前账号记录；云端为空而本机有数据时反向全量上传，
 *   保证老演示数据不丢。读取失败保留本机镜像并给出可见错误，不做静默降级。
 * - 每次 repository 写入先更新本机镜像（UI 即时、刷新不丢），再由本层合并 220ms 内的
 *   重复写入，批量 upsert 到云端。失败批次留在队列，可手动重试。
 * - 演示模式（本机账号）不激活本层，不触碰云 SDK，可离线完整演示。
 */

export type RecordKind = 'profile' | 'attempt' | 'report' | 'mistake' | 'daily'
export type SyncStatus = 'local' | 'loading' | 'syncing' | 'saved' | 'error'

export interface SyncState {
  active: boolean
  status: SyncStatus
  message: string
  pending: number
  lastSavedAt: string | null
}

interface DbRow {
  kind: string
  record_key: string
  payload: unknown
}

interface DbResult {
  data: DbRow[] | null
  error: { message?: string; code?: string } | null
}

/** PostgREST 查询链的极小类型面；运行时由 SDK 的 cloud.database 提供 */
interface Chain extends PromiseLike<DbResult> {
  select(cols?: string): Chain
  eq(col: string, value: unknown): Chain
  upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }): Chain
}

interface DatabaseLike {
  from(table: string): Chain
}

const TABLE = 'ielts_records'
const CONFLICT = 'owner_id,kind,record_key'

let state: SyncState = {
  active: false,
  status: 'local',
  message: '',
  pending: 0,
  lastSavedAt: null,
}

const listeners = new Set<() => void>()

function emit(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

interface SyncConfig {
  active: boolean
  userId: string
  ownerName: string
}

let config: SyncConfig = { active: false, userId: '', ownerName: '' }

interface QueuedRecord {
  kind: RecordKind
  key: string
  payload: unknown
}

const queue = new Map<string, QueuedRecord>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let failed = false

/** 切换账号 / 模式 / 退出登录时调用：停止向云端推送并清空待写队列 */
export function configureSync(next: Partial<SyncConfig> & { active: boolean }): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  queue.clear()
  failed = false
  config = {
    active: next.active,
    userId: next.userId ?? '',
    ownerName: next.ownerName ?? '',
  }
  emit({
    active: next.active,
    status: next.active ? 'saved' : 'local',
    message: '',
    pending: 0,
    lastSavedAt: null,
  })
}

function db(): DatabaseLike {
  return getCloud().database as unknown as DatabaseLike
}

export function pushRecord(kind: RecordKind, key: string, payload: unknown, userId: string): void {
  if (!config.active || config.userId !== userId) return
  queue.set(`${kind}:${key}`, { kind, key, payload })
  emit({ status: failed ? 'error' : 'syncing', pending: queue.size })
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { void flush() }, 220)
}

function enqueueBucket(userId: string, bucket: Bucket): void {
  if (bucket.profile) queue.set('profile:profile', { kind: 'profile', key: 'profile', payload: bucket.profile })
  bucket.attempts.forEach((item) => queue.set(`attempt:${item.attemptId}`, { kind: 'attempt', key: item.attemptId, payload: item }))
  bucket.reports.forEach((item) => queue.set(`report:${item.reportId}`, { kind: 'report', key: item.reportId, payload: item }))
  bucket.mistakes.forEach((item) => queue.set(`mistake:${item.mistakeId}`, { kind: 'mistake', key: item.mistakeId, payload: item }))
  Object.entries(bucket.daily).forEach(([date, value]) => queue.set(`daily:${date}`, { kind: 'daily', key: date, payload: value }))
  void userId
}

async function flush(): Promise<void> {
  if (flushing || !config.active || queue.size === 0) return
  flushing = true
  const batch = [...queue.values()]
  queue.clear()
  try {
    const rows = batch.map((record) => ({
      kind: record.kind,
      record_key: record.key,
      subject_user_id: config.userId,
      owner_name: config.ownerName || null,
      payload: record.payload,
    }))
    const { error } = await db().from(TABLE).upsert(rows, { onConflict: CONFLICT })
    if (error) throw new Error('cloud write rejected')
    failed = false
    emit({
      status: queue.size ? 'syncing' : 'saved',
      message: '',
      pending: queue.size,
      lastSavedAt: new Date().toISOString(),
    })
  } catch {
    failed = true
    // 失败批次重新入队，保留用户数据，等待重试或下一次写入
    batch.forEach((record) => {
      const key = `${record.kind}:${record.key}`
      if (!queue.has(key)) queue.set(key, record)
    })
    emit({
      status: 'error',
      message: '云端保存暂时失败，记录已保留在本机，请点击重试同步。',
      pending: queue.size,
    })
  } finally {
    flushing = false
    if (queue.size > 0 && !failed) {
      flushTimer = setTimeout(() => { void flush() }, 500)
    }
  }
}

export function retrySync(): void {
  if (!config.active) return
  failed = false
  void flush()
}

/** 登录后调用：云端为准恢复本机镜像；首次上云时把本机数据反向写入云端 */
export async function hydrateCloud(userId: string): Promise<{ ok: boolean; message: string }> {
  if (!config.active) return { ok: true, message: '' }
  emit({ status: 'loading', message: '连接云端', pending: 0 })
  try {
    const { data, error } = await db()
      .from(TABLE)
      .select('kind,record_key,payload')
      .eq('subject_user_id', userId)
    if (error) throw new Error('cloud read rejected')
    const rows = Array.isArray(data) ? data : []
    const local = bucketOf(userId)
    const hasLocal = Boolean(
      local.profile || local.attempts.length || local.reports.length ||
      local.mistakes.length || Object.keys(local.daily).length,
    )

    if (rows.length === 0) {
      if (hasLocal) {
        enqueueBucket(userId, local)
        void flush()
      }
      emit({ status: hasLocal ? 'syncing' : 'saved', message: '', pending: queue.size })
      return { ok: true, message: '' }
    }

    const bucket = emptyBucket()
    for (const row of rows) {
      const payload = row.payload
      switch (row.kind) {
        case 'profile': bucket.profile = payload as UserProfile; break
        case 'attempt': bucket.attempts.push(payload as Attempt); break
        case 'report': bucket.reports.push(payload as Report); break
        case 'mistake': bucket.mistakes.push(payload as Mistake); break
        case 'daily': bucket.daily[row.record_key] = payload as DailyTaskState; break
        default: break
      }
    }
    saveBucket(userId, bucket)
    emit({ status: 'saved', message: '', pending: 0, lastSavedAt: new Date().toISOString() })
    return { ok: true, message: '' }
  } catch {
    emit({
      status: 'error',
      message: '暂时无法读取云端记录，已保留本机数据，联网后可重试同步。',
      pending: queue.size,
    })
    return { ok: false, message: '暂时无法读取云端记录，已使用本机缓存继续练习。' }
  }
}
