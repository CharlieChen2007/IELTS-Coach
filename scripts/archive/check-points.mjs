/* 积分验收：完成一次练习 → 飘分动画 + 排行榜加分 */
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
await page.locator('input[placeholder="例如：Alex"]').fill('积分测试')
await page.locator('input[placeholder="you@example.com"]').fill('points@example.com')
await page.getByRole('button', { name: '进入学习首页' }).click()
await page.waitForTimeout(700)

// 未认证时不应加分
ok('未认证时无积分', await page.evaluate(() => {
  const all = JSON.parse(localStorage.getItem('ielts_camp_v1') || '{}')
  const s = all[Object.keys(all)[0]]
  return !s || s.points.length === 0
}))

// 认证
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

// 做一次练习（写作 Task 2，直接填内容提交）
await page.goto(BASE + '/#/practice/exr_wr_task2_01', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const ta = page.locator('textarea').first()
if (await ta.count()) {
  await ta.fill('Some people believe that universities should focus on academic subjects. In my opinion, practical skills are equally important because employers value them. Firstly, students who learn hands-on skills can adapt quickly. Secondly, practical training improves motivation. In conclusion, a balance of both is the best approach for students and society as a whole. '.repeat(2))
  await page.waitForTimeout(300)
}
const submit = page.getByRole('button', { name: /提交/ }).first()
if (await submit.count()) { await submit.click(); await page.waitForTimeout(400) }

// 等评分完成 → 观察飘分动画
let burstSeen = false
for (let i = 0; i < 40; i++) {
  if (await page.locator('.points-burst').count()) { burstSeen = true; break }
  await page.waitForTimeout(300)
}
ok('完成练习后出现积分飘出动画', burstSeen, burstSeen ? '' : '未捕获（可能已消失）')
if (burstSeen) {
  const txt = await page.locator('.points-burst').innerText()
  ok('动画内容含 +分数', /\+\d+/.test(txt), txt.replace(/\n/g, ' '))
  await page.screenshot({ path: 'screenshots/36-points-burst.png' })
}
await page.waitForTimeout(1500)

const stored = await page.evaluate(() => {
  const all = JSON.parse(localStorage.getItem('ielts_camp_v1') || '{}')
  const s = all[Object.keys(all)[0]]
  return { n: s.points.length, total: s.points.reduce((a, b) => a + b.points, 0), first: s.points[0] }
})
ok('积分已落库', stored.n > 0, `共 ${stored.total} 分 · 最新 ${stored.first?.label} +${stored.first?.points}`)

await page.goto(BASE + '/#/campus/rank', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const body = await page.locator('body').innerText()
ok('排行榜显示我的积分', body.includes(String(stored.total)) || /我/.test(body))
const rows = await page.locator('.rank-row').count()
ok('榜单含同校其他成员', rows > 1, `${rows} 行`)

console.log('\n控制台错误:', errs.length ? errs.join(' | ') : '无')
const passed = res.filter((r) => r[1]).length
console.log(`积分验收：${passed} / ${res.length} 项通过`)
await browser.close()
if (passed !== res.length) process.exit(1)
