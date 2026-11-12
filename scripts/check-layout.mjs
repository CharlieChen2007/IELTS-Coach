/* 落地页 + 独立登录页 + 多尺寸自适应验收（桌面 / 平板 / 手机） */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4192/'
const SHOT = 'screenshots'
mkdirSync(SHOT, { recursive: true })

const checks = []
const ok = (label, condition) => checks.push([label, Boolean(condition)])

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const errors = []

async function openPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (error) => errors.push(`${width}px: ${error.message}`))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  return page
}

// ---- 1. 桌面：未登录初始界面就是落地页，右上角有登录 / 注册 ----
let page = await openPage(1440, 900)
let body = await page.locator('body').innerText()
ok('未登录进入落地页（不是登录表单）', body.includes('练完一次') && !body.includes('发送短信验证码'))
ok('右上角有「登录」按钮', await page.locator('.landing-actions button', { hasText: '登录' }).count() > 0)
ok('右上角有「注册」按钮', await page.locator('.landing-actions button', { hasText: '注册' }).count() > 0)
const loginBox = await page.locator('.landing-actions').boundingBox()
ok('登录注册位于页面右上角', loginBox && loginBox.x > 900 && loginBox.y < 120)
await page.screenshot({ path: `${SHOT}/10-landing-desktop.png` })

// 无横向溢出
async function noOverflow(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}
ok('桌面无横向溢出', await noOverflow(page))

// ---- 2. 登录页是独立页面 ----
await page.locator('.landing-actions button', { hasText: '登录' }).click()
await page.waitForTimeout(400)
body = await page.locator('body').innerText()
/* 本机态登录页标题是「进入学习空间」，云端态才是「登录你的账号」：两种都算通过 */
ok('点击登录跳转到独立登录页', page.url().includes('#/auth') && /登录你的账号|进入学习空间/.test(body))
ok('登录页保留返回首页入口', body.includes('返回首页'))
await page.screenshot({ path: `${SHOT}/11-auth-page.png` })
await page.locator('.landing-actions button', { hasText: '注册' }).click()
await page.waitForTimeout(300)
ok('注册入口指向注册态', /注册新账号|进入学习空间/.test(await page.locator('body').innerText()))
await page.close()

// ---- 3. 手机竖屏（390x844）----
page = await openPage(390, 844)
ok('手机端落地页无横向溢出', await noOverflow(page))
ok('手机端顶栏仍显示登录注册', await page.locator('.landing-actions button').count() >= 2)
await page.screenshot({ path: `${SHOT}/12-landing-mobile.png`, fullPage: false })
await page.locator('.landing-actions button', { hasText: '注册' }).click()
await page.waitForTimeout(400)
ok('手机端登录页无横向溢出', await noOverflow(page))
await page.screenshot({ path: `${SHOT}/13-auth-mobile.png` })
await page.close()

// ---- 4. 平板（820x1180）----
page = await openPage(820, 1180)
ok('平板落地页无横向溢出', await noOverflow(page))
await page.locator('.landing-actions button', { hasText: '登录' }).click()
await page.waitForTimeout(400)
ok('平板登录页无横向溢出', await noOverflow(page))
await page.close()

// ---- 5. 登录后的学习空间在手机上：抽屉菜单可用、不溢出 ----
page = await openPage(390, 844)
await page.goto(`${BASE}#/auth?mode=signup`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('.mode-switch button', { hasText: '本机体验' }).click()
await page.waitForTimeout(400)
await page.locator('.auth-card input.input').first().fill('手机验收')
await page.locator('.auth-card input.input').nth(1).fill('mobile-check@example.com')
await page.getByRole('button', { name: '进入学习首页' }).click()
await page.waitForTimeout(1200)
body = await page.locator('body').innerText()
ok('演示模式可进入学习首页', body.includes('学习首页'))
ok('手机端学习页无横向溢出', await noOverflow(page))
ok('手机端侧栏默认收起', (await page.locator('.sidebar').boundingBox()).x < -40)
ok('顶栏显示菜单按钮', await page.locator('.nav-toggle').isVisible())
await page.locator('.nav-toggle').click()
await page.waitForTimeout(400)
const drawer = await page.locator('.sidebar').boundingBox()
ok('点击菜单后抽屉滑出可见', drawer && drawer.x >= -1 && drawer.width > 200)
const drawerText = await page.locator('.sidebar').innerText()
/* 抽屉里现在常驻的是「学习首页 + 四科 + 校园四格」，错题本已收进报告与首页统计 */
ok('抽屉内显示完整导航文案', ['学习首页', '听力精练', '口语陪练', '阅读精读', '写作批改'].every(t => drawerText.includes(t)))
await page.screenshot({ path: `${SHOT}/14-mobile-drawer.png` })
await page.locator('.nav-scrim').click({ position: { x: 350, y: 400 } })
await page.waitForTimeout(400)
ok('点击遮罩后抽屉收起', (await page.locator('.sidebar').boundingBox()).x < -40)
await page.screenshot({ path: `${SHOT}/15-mobile-home.png` })
await page.close()

await browser.close()

let passed = 0
for (const [label, result] of checks) {
  console.log(`${result ? 'PASS' : 'FAIL'}  ${label}`)
  if (result) passed++
}
console.log(`\n布局与登录页验收：${passed} / ${checks.length} 项通过`)
console.log(`浏览器控制台：${errors.length ? errors.join(' | ') : '无错误'}`)
if (passed !== checks.length || errors.length) process.exit(1)
