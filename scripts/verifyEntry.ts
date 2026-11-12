/* 纯逻辑自测入口：由 scripts/verify.mjs 用 esbuild 打包后在 Node 中运行 */
import { makeId, type Mistake } from '../src/contract'
import { repository } from '../src/repository'
import {
  createAttempt,
  dailyState,
  filterAttempts,
  filterMistakes,
  scorePoints,
  seedDemoHistory,
  submitAttempt,
  tickScoring,
  todayKey,
} from '../src/logic'
import { findPractice, PRACTICES } from '../src/seed'
import { readFileSync } from 'node:fs'
import {
  adaptWritingSubmission,
  assertNoManualConflict,
  isCurveEligible,
  SENTENCE_STATUS_MAP,
  validateAnchor,
  WRITING_FIELD_MAP,
  WRITING_INVARIANTS,
  type WritingSentence,
  type WritingSubmission,
} from '../src/writingContract'

function installLocalStorage() {
  const store = new Map<string, string>()
  const mock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  }
  ;(globalThis as unknown as { localStorage: typeof mock }).localStorage = mock
}

export function runVerification(): string[] {
  installLocalStorage()
  const log: string[] = []
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`FAIL: ${message}`)
    log.push(`PASS  ${message}`)
  }

  // 1. 唯一编号
  const ids = new Set(Array.from({ length: 3000 }, () => makeId('attempt')))
  assert(ids.size === 3000, '3000 个 attempt 编号无碰撞')
  assert(makeId('report').startsWith('rpt_') && makeId('mistake').startsWith('mis_'), '编号前缀符合契约')

  // 2. 账号数据隔离
  const alice = 'usr_alice', bob = 'usr_bob'
  repository.saveProfile({ userId: alice, nickname: 'Alice', targetBand: 7, createdAt: new Date().toISOString() })
  repository.saveProfile({ userId: bob, nickname: 'Bob', targetBand: 6, createdAt: new Date().toISOString() })
  assert(repository.getProfile(alice)?.nickname === 'Alice' && repository.getProfile(bob)?.nickname === 'Bob', '两个账号资料互不可串')
  assert(repository.getProfile(alice)?.targetBand === 7, '目标分按账号独立保存')

  // 3. 四科均可提交 → 评分 → 出报告，且反馈有依据
  for (const exerciseId of ['exr_sp_mock_01', 'exr_wr_task2_01', 'exr_li_sec_01', 'exr_re_pass_01']) {
    const practice = findPractice(exerciseId)!
    const attempt = submitAttempt(createAttempt({
      userId: alice,
      practice,
      answers: Object.fromEntries(practice.questions.map((q) => [q.id, q.answer ?? 'A'])),
      draftText: practice.subject === 'writing' ? 'Nowadays this is a hot topic. The government pay too much money. In conclusion it is good but also bad.' : undefined,
    }))
    assert(attempt.status === 'scoring', `${exerciseId} 提交后进入评分中`)
    let current = attempt
    let guard = 0
    while (current.status === 'scoring' && guard++ < 30) current = tickScoring(current, 20)
    assert(current.status === 'ready' && Boolean(current.reportId), `${exerciseId} 评分完成并生成报告`)
    const report = repository.getReport(alice, current.reportId!)!
    assert(report.score.display.length > 0, `${exerciseId} 报告有分数/正确数`)
    assert(report.feedback.every((item) => item.quote && item.why && item.suggestion), `${exerciseId} 每条反馈都含证据+错因+改法`)
    assert(report.recommendations.every((item) => item.reason.length > 0), `${exerciseId} 每条推荐都写明理由`)
    assert(report.original.prompt.length > 0, `${exerciseId} 保存了当时的题目快照`)
  }

  // 4. 刷新恢复：scoring 状态与 progress 持久化
  const restorePractice = findPractice('exr_re_pass_01')!
  const pending = submitAttempt(createAttempt({ userId: bob, practice: restorePractice }))
  const reloaded = repository.getAttempt(bob, pending.attemptId)
  assert(reloaded?.status === 'scoring' && (reloaded?.progress ?? 0) > 0, '刷新后可从持久化状态找回评分中任务')
  let resumed = reloaded!
  let guard2 = 0
  while (resumed.status === 'scoring' && guard2++ < 30) resumed = tickScoring(resumed, 25)
  assert(resumed.status === 'ready', '恢复后能继续推进到完成')

  // 5. 每日两格任务 + 同一提交只计一次
  const daily = dailyState(alice)
  assert(daily.date === todayKey(), '每日任务按本地日期归档')
  assert(daily.newPractice.length >= 4, '新练习计入第一格任务')
  const before = daily.newPractice.length
  repository.saveDaily(alice, { ...daily, newPractice: [...daily.newPractice, daily.newPractice[0]] })
  const deduped = dailyState(alice)
  assert(deduped.newPractice.length === before + 1, '仓储可回读每日任务状态')
  // 复练任务走第二格
  const retakePractice = findPractice('exr_re_retake_01')!
  const retake = submitAttempt(createAttempt({ userId: alice, practice: retakePractice, retakeOf: 'atm_source' }))
  let retakeCurrent = retake
  let guard3 = 0
  while (retakeCurrent.status === 'scoring' && guard3++ < 30) retakeCurrent = tickScoring(retakeCurrent, 25)
  const afterRetake = dailyState(alice)
  assert(afterRetake.retake.includes(retake.attemptId), '带 retakeOf 的提交计入「根据反馈复练」')
  assert(!afterRetake.newPractice.includes(retake.attemptId), '复练不会重复计入「完成一次新练习」')
  assert(new Set(afterRetake.retake).size === afterRetake.retake.length, '同一提交在每日任务中只计一次')

  // 6. 错题本派生与筛选
  const mistakes = repository.listMistakes(alice)
  assert(mistakes.length > 0, '报告反馈自动派生错题本条目')
  assert(mistakes.every((item: Mistake) => item.locationLabel && item.why), '错题带定位与错因')
  const pendingOnly = filterMistakes(mistakes, { subject: 'all', questionType: '', reviewStatus: 'pending' })
  assert(pendingOnly.every((item) => item.reviewStatus === 'pending'), '按待复习状态筛选正确')
  const readingOnly = filterMistakes(mistakes, { subject: 'reading', questionType: '', reviewStatus: 'all' })
  assert(readingOnly.length > 0 && readingOnly.every((item) => item.subject === 'reading'), '按科目筛选正确')

  // 7. 历史筛选
  const attempts = repository.listAttempts(alice)
  const writingOnly = filterAttempts(attempts, { subject: 'writing', mode: 'all', dateFrom: '', dateTo: '' })
  assert(writingOnly.length > 0 && writingOnly.every((item) => item.subject === 'writing'), '历史按科目筛选正确')

  // 8. 曲线口径
  const reports = repository.listReports(alice)
  for (const metric of ['speaking_mock_band', 'writing_band', 'reading_correct', 'listening_correct']) {
    const points = scorePoints(reports, metric)
    assert(points.length > 0, `${metric} 曲线有数据点`)
    assert(points.every((point) => point.reportId && point.date), `${metric} 曲线点可关联报告`)
  }

  // 9. 样例数据铺历史 + 幂等
  const charlie = 'usr_charlie'
  assert(seedDemoHistory(charlie) === 8, '演示记录生成 8 条历史练习')
  assert(seedDemoHistory(charlie) === 0, '已有记录时不会重复载入')
  const seeded = repository.listAttempts(charlie)
  assert(seeded.length === 9 && seeded.some((item) => item.status === 'draft'), '同时生成一份未完成草稿（继续写作）')
  assert(repository.listReports(charlie).length === 8, '样例报告齐全')
  assert(repository.listMistakes(charlie).length > 0, '样例错题可用于错题本筛选')

  // 10. 练习清单完整
  assert(PRACTICES.length >= 8, '四科 + 复练练习清单完整')
  assert(PRACTICES.every((item) => item.exerciseId.startsWith('exr_')), '练习编号符合契约')

  // 11. 交接包对齐：写作模块运行时数据契约
  assert(WRITING_FIELD_MAP.length === 10, 'D1 提案 ↔ 写作运行时字段映射表为 10 项')
  assert(WRITING_FIELD_MAP.some((m) => m.d1 === 'questionId' && m.runtime === 'topicId'), 'questionId ↔ topicId 已显式映射')
  assert(SENTENCE_STATUS_MAP.fix.d1 === 'needs_revision' && SENTENCE_STATUS_MAP.fix.severity === 'high', 'fix → needs_revision / 需要修改')
  assert(SENTENCE_STATUS_MAP.improve.d1 === 'could_improve' && SENTENCE_STATUS_MAP.improve.severity === 'medium', 'improve → could_improve / 可以加强')
  assert(SENTENCE_STATUS_MAP.keep.d1 === 'keep' && SENTENCE_STATUS_MAP.keep.severity === 'low', 'keep → keep / 可保留')
  assert(WRITING_INVARIANTS.length === 4, '四项集成约束已声明：首稿 / 锚点 / 冲突 / 重试')

  const quote = 'Many student rely on buses.'
  const repeated = `${quote} ${quote}`
  const sentenceA: WritingSentence = {
    id: 'sub_001:s:0', start: 0, end: quote.length, paragraph: 1, index: 1, text: quote,
    status: 'fix', reason: 'many 修饰可数名词复数，student 应为 students。',
    suggestion: 'Many students rely on buses.', change: 'student → students',
  }
  const sentenceB: WritingSentence = { ...sentenceA, id: 'sub_001:s:28', start: quote.length + 1, end: quote.length * 2 + 1, index: 2 }
  assert(validateAnchor(repeated, sentenceA) && validateAnchor(repeated, sentenceB), '重复句各自锚点有效且互不串位')
  assert(sentenceA.start !== sentenceB.start && sentenceA.id !== sentenceB.id, '重复句 ID 与偏移分别独立')
  assert(!validateAnchor(repeated, { ...sentenceA, end: sentenceA.end - 1 }), '锚点校验拒绝偏移与文本不匹配')
  assert(assertNoManualConflict(repeated, repeated, {}, sentenceA), '未改动草稿可通过冲突保护校验')
  assert(!assertNoManualConflict(`${repeated} (edited)`, repeated, {}, sentenceA), '手动改动触发冲突保护并拒绝自动替换')

  const writingReport = {
    sample: true, fragment: false, count: 12, sentences: [sentenceA, sentenceB],
    model: 'upgraded essay', upgrades: ['第 1 段：修正名词单复数。'],
  }
  const submission: WritingSubmission = {
    id: 'sub_001', practiceId: 'pr_001', topicId: 'transport', version: 2, parentId: 'sub_000',
    text: repeated, mode: 'essay', createdAt: new Date().toISOString(), status: 'done',
    isExample: true, report: writingReport,
  }
  const adapted = adaptWritingSubmission(submission, { userId: alice })
  assert(adapted.subject === 'writing' && adapted.status === 'ready', '运行时提交适配为站内 writing / ready 报告')
  assert(adapted.feedback.length === 2 && adapted.feedback.every((f) => f.quote && f.why && f.suggestion), '适配后每条反馈仍含证据+错因+改法')
  assert(adapted.feedback.every((f) => typeof f.location.startUtf16 === 'number'), 'UTF-16 句子锚点随报告保留')
  assert(adapted.recommendations.every((r) => r.reason.length > 0), '适配后每条推荐仍写明理由')
  assert(adapted.original.submittedText === repeated, '首稿快照保持不可变')
  assert(adapted.evidence.draftV2 === repeated && adapted.retakeOf === 'atm_sub_000', '二稿版本与父提交关系保留')
  assert(adapted.score.band === null && adapted.score.display === '不估分', '示例与规则反馈不伪造估分')
  assert(!isCurveEligible(adapted), '示例 / 规则反馈不写入全站分数曲线')
  const realReport = adaptWritingSubmission(
    { ...submission, isExample: false, report: { ...writingReport, sample: false } },
    { userId: alice, realAssessment: { band: 6.5 } },
  )
  assert(isCurveEligible(realReport) && realReport.score.band === 6.5, '仅真实评估可进入分数曲线')

  // 12. 交接包对齐：全站设计 token 与响应式断点落地
  const css = readFileSync('src/styles.css', 'utf8')
  for (const token of ['#4388c4', '#f5f8fb', '#f4f2cd', '--sidebar-w: 224px', '--topbar-h: 77px', '--radius: 18px', '--content-max: 1540px', '#fcf1ed', '#f7f5e7', '#eef7f2']) {
    assert(css.includes(token), `设计 token 已落地：${token}`)
  }
  for (const bp of ['1600px', '1190px', '970px', '760px', '500px']) {
    assert(css.includes(`min-width: ${bp}`) || css.includes(`max-width: ${bp}`), `响应式断点已对齐：${bp}`)
  }

  // 13. 主体色调严格对齐交接包：无旧靛紫/杂色残留，曲线统一蓝色系梯度
  const legacyColors = ['#7c3aed', '#2563eb', '#059669', '#0891b2', '#4f46e5', '#6366f1', '#8b5cf6', '#a78bfa', '#8a93a6', '#eceff7', '#e11d48', '#cbd5e1', '#4b5568']
  for (const file of [
    'src/styles.css', 'src/logic.ts', 'src/contract.ts', 'src/App.tsx', 'src/components.tsx',
    'src/pages/HomePage.tsx', 'src/pages/PracticePage.tsx', 'src/pages/ReportViews.tsx', 'index.html',
  ]) {
    const source = readFileSync(file, 'utf8').toLowerCase()
    const stray = legacyColors.find((bad) => source.includes(bad))
    assert(!stray, `${file} 主体色调无旧色系残留${stray ? '：' + stray : ''}`)
  }
  const curves = readFileSync('src/logic.ts', 'utf8')
  for (const tone of ['#254b65', '#397fb5', '#73accd', '#a6d7f0']) {
    assert(curves.includes(tone), `分数曲线使用交接包蓝色系梯度：${tone}`)
  }

  // 14. 登录方式：手机号 + 邮箱 OTP，无密码；云同步按 owner 隔离
  const appSrc = readFileSync('src/App.tsx', 'utf8')
  for (const label of ['手机号', '邮箱', '发送短信验证码', '发送邮件验证码']) {
    assert(appSrc.includes(label), `登录页提供：${label}`)
  }
  const authSrc = readFileSync('src/auth.tsx', 'utf8')
  assert(authSrc.includes('/^1\\d{10}$/'), '手机号按 11 位大陆号码校验')
  assert(authSrc.includes('sendOtp({ phone: target })') && authSrc.includes('verifyOtp({ phone: pending.recipient'), '手机号 OTP 发送与验证都使用 phone')
  assert(authSrc.includes('sendOtp({ email: target })') && authSrc.includes('verifyOtp({ email: pending.recipient'), '邮箱 OTP 发送与验证都使用 email')
  assert(!authSrc.includes('signInWithPassword') && !appSrc.includes('type="password"'), 'OTP-only：未引入密码登录')
  assert(authSrc.includes('pending.channel !== channel || pending.recipient !== target'), '换方式或改收件人后需重新获取验证码')
  const syncSrc = readFileSync('src/cloudSync.ts', 'utf8')
  assert(syncSrc.includes('onConflict: CONFLICT') && syncSrc.includes("eq('subject_user_id', userId)"), '云端按唯一键 upsert、按账号读取')
  assert(!syncSrc.includes('owner_id:'), '前端不传 owner_id，由数据库填充')
  const repoSrc = readFileSync('src/repository.ts', 'utf8')
  for (const kind of ["pushRecord('profile'", "pushRecord('attempt'", "pushRecord('report'", "pushRecord('mistake'", "pushRecord('daily'"]) {
    assert(repoSrc.includes(kind), `仓储写入同步到云端：${kind}`)
  }

  return log
}
