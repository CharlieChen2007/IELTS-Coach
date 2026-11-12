/* 【历史脚本 · 已废弃，不再计入本轮验收门禁】
   验收的是早期演示页上的 `.campus-btn`（演示旁的校园营地按钮），该入口已按用户要求删除，
   当前校园入口在侧栏「深圳大学 · 校园」里；脚本必然因找不到元素而超时。
   在上一版交付包（基线服务）上 A/B 复现为同样的 TimeoutError，非本轮回归。
   当前校园申请 / 搭子 / 红点等由 check-campus.mjs 与 verify.mjs 覆盖。
   保留本文件仅作历史判据存档。
   原用途：别人发来申请 → 红点 → 我的搭子里接受/拒绝 */
import { chromium } from 'playwright-core'
const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'
const res = []
const ok = (n, c, d = '') => { res.push([n, !!c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

await page.goto(BASE + '/#/auth?mode=signin', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const demo = page.getByRole('button', { name: '本机体验' })
if (await demo.count()) await demo.first().click()
await page.waitForTimeout(300)
await page.locator('input[placeholder="例如：Alex"]').fill('收件人')
await page.locator('input[placeholder="you@example.com"]').fill('receiver@example.com')
await page.getByRole('button', { name: '进入学习首页' }).click()
await page.waitForTimeout(700)

// 先认证
await page.locator('.campus-btn').click()
await page.waitForTimeout(400)
await page.locator('input[placeholder="例如：广东外语外贸大学"]').fill('广东外语外贸大学')
await page.locator('input[placeholder="例如：大学城校区"]').fill('大学城校区')
await page.locator('input[placeholder="例如：大三"]').fill('大三')
await page.locator('input[placeholder="例如：英语语言文学"]').fill('英语语言文学')
await page.locator('input[placeholder="例如：英语 2301"]').fill('英语 2301')
await page.locator('input[placeholder="6-20 位数字"]').fill('2023012345')
await page.getByRole('button', { name: '完成认证' }).click()
await page.waitForTimeout(800)

// 直接写入一条「别人发给我」的申请（模拟对方发送）
await page.evaluate(() => {
  const KEY = 'ielts_camp_v1'
  const all = JSON.parse(localStorage.getItem(KEY) || '{}')
  const uid = Object.keys(all)[0]
  const store = all[uid]
  store.requests = store.requests || []
  store.requests.unshift({
    requestId: 'req_demo_incoming',
    fromUserId: 'cusr_demo_陈可',
    fromNickname: '陈可',
    toUserId: uid,
    score: 83,
    reason: '口语、口语对话练习',
    message: '一起练口语？',
    status: 'pending',
    createdAt: new Date().toISOString(),
  })
  localStorage.setItem(KEY, JSON.stringify(all))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)

// 红点
const dot = await page.locator('.campus-panel .badge-dot').count()
await page.locator('.campus-btn').click()
await page.waitForTimeout(300)
const dotVisible = await page.locator('.campus-item .badge-dot').count()
ok('「寻找搭子」方框上有红点', dotVisible > 0, `可见红点 ${dotVisible}`)
await page.screenshot({ path: 'screenshots/35-campus-reddot.png' })
await page.keyboard.press('Escape')

// 进我的搭子接受
await page.goto(BASE + '/#/campus/partners', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const incoming = await page.locator('.match-row', { hasText: '接受' }).count()
ok('我的搭子里能看到待处理申请', incoming > 0, `${incoming} 条`)
await page.getByRole('button', { name: '接受' }).first().click()
await page.waitForTimeout(600)
ok('接受后出现在「我的搭子」列表', (await page.locator('body').innerText()).includes('陈可'))
const stillPending = await page.locator('.match-row', { hasText: '接受' }).count()
ok('处理后不再显示该申请', stillPending === 0, `剩余 ${stillPending}`)

// 拒绝流程：再写一条
await page.evaluate(() => {
  const KEY = 'ielts_camp_v1'
  const all = JSON.parse(localStorage.getItem(KEY) || '{}')
  const uid = Object.keys(all)[0]
  all[uid].requests.unshift({
    requestId: 'req_demo_reject', fromUserId: 'cusr_demo_许唯', fromNickname: '许唯',
    toUserId: uid, score: 33, reason: '写作', message: '', status: 'pending',
    createdAt: new Date().toISOString(),
  })
  localStorage.setItem(KEY, JSON.stringify(all))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByRole('button', { name: '拒绝' }).first().click()
await page.waitForTimeout(500)
const afterReject = await page.locator('.match-row', { hasText: '接受' }).count()
ok('拒绝后申请消失', afterReject === 0, `剩余 ${afterReject}`)
const nameInPartners = await page.evaluate(() => {
  const KEY = 'ielts_camp_v1'
  const all = JSON.parse(localStorage.getItem(KEY) || '{}')
  const store = all[Object.keys(all)[0]]
  return store.partners.includes('cusr_demo_许唯')
})
ok('被拒绝的人不会成为搭子', nameInPartners === false)

console.log('\n控制台错误:', errs.length ? errs.join(' | ') : '无')
const passed = res.filter((r) => r[1]).length
console.log(`申请流程验收：${passed} / ${res.length} 项通过`)
await browser.close()
if (passed !== res.length) process.exit(1)
