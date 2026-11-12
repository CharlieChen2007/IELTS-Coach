import type {
  Attempt,
  DailyTaskState,
  Mistake,
  Repository,
  Report,
  UserProfile,
} from './contract'
import { bucketOf, clearBucket, saveBucket, upsert } from './localStore'
import { pushRecord } from './cloudSync'

/**
 * 业务数据仓储：本机镜像 + 云端权威存储。
 *
 * - 按 userId 分桶，账号之间数据互不可见；云账号模式下 RLS 在服务端再做一次隔离。
 * - 所有写操作同步更新本机镜像（UI 即时、刷新不丢），随后由 cloudSync 异步 upsert 到云数据库。
 * - 演示模式不会激活云同步，可离线完整自测。接口与 contract.ts 的 Repository 保持一致。
 */

export const repository: Repository = {
  getProfile(userId) {
    return bucketOf(userId).profile ?? null
  },
  saveProfile(profile) {
    const bucket = bucketOf(profile.userId)
    bucket.profile = profile
    saveBucket(profile.userId, bucket)
    pushRecord('profile', 'profile', profile, profile.userId)
  },
  listAttempts(userId) {
    return bucketOf(userId).attempts
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },
  getAttempt(userId, attemptId) {
    return bucketOf(userId).attempts.find((item) => item.attemptId === attemptId) ?? null
  },
  saveAttempt(attempt) {
    const bucket = bucketOf(attempt.userId)
    bucket.attempts = upsert(bucket.attempts, attempt, (a) => a.attemptId, attempt.attemptId)
    saveBucket(attempt.userId, bucket)
    pushRecord('attempt', attempt.attemptId, attempt, attempt.userId)
  },
  listReports(userId) {
    return bucketOf(userId).reports
  },
  getReport(userId, reportId) {
    return bucketOf(userId).reports.find((item) => item.reportId === reportId) ?? null
  },
  saveReport(report) {
    const bucket = bucketOf(report.userId)
    bucket.reports = upsert(bucket.reports, report, (r) => r.reportId, report.reportId)
    saveBucket(report.userId, bucket)
    pushRecord('report', report.reportId, report, report.userId)
  },
  listMistakes(userId) {
    return bucketOf(userId).mistakes
      .filter(item => !item.archived)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },
  saveMistake(mistake) {
    const bucket = bucketOf(mistake.userId)
    bucket.mistakes = upsert(bucket.mistakes, mistake, (m) => m.mistakeId, mistake.mistakeId)
    saveBucket(mistake.userId, bucket)
    pushRecord('mistake', mistake.mistakeId, mistake, mistake.userId)
  },
  getDaily(userId, date) {
    return bucketOf(userId).daily[date] ?? { date, newPractice: [], retake: [] }
  },
  saveDaily(userId, state) {
    const bucket = bucketOf(userId)
    bucket.daily[state.date] = state
    saveBucket(userId, bucket)
    pushRecord('daily', state.date, state, userId)
  },
}

/** 演示模式：仅清空当前账号的本机镜像，不影响其他账号 */
export function clearUserData(userId: string): void {
  clearBucket(userId)
}
