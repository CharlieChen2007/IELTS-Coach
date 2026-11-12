/* 云账号模式登录页验收：手机号 / 邮箱两种方式、手机号格式校验、无密码字段 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
/* 默认沿用通用验收地址，避免脚本写死 4190 而在本地预览服务上连不上。 */
const BASE = process.env.LOGIN_BASE_URL ?? ((process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4192').replace(/\/$/, '') + '/?demo=0')
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
if (!page.url().includes('#/auth')) {
  await page.locator('.landing-actions button', { hasText: '登录' }).click()
}
await page.waitForTimeout(2500)

const checks = []
const ok = (label, condition) => checks.push([label, Boolean(condition)])
const body = () => page.locator('body').innerText()

ok('登录页渲染出手机号方式', (await body()).includes('短信验证码'))
ok('登录页渲染出邮箱方式', (await page.locator('.auth-tabs button', { hasText: '邮箱' }).count()) > 0)
ok('默认选中手机号', (await page.locator('.auth-tabs button.on').innerText()).trim() === '手机号')
ok('手机号输入提示可见', (await page.locator('.auth-card input.input').first().getAttribute('placeholder')) === '请输入 11 位手机号')
ok('发送短信验证码按钮可见', (await body()).includes('发送短信验证码'))
ok('OTP-only：没有密码输入框', (await page.locator('input[type="password"]').count()) === 0)
if (BASE.includes('app.workbuddy.host')) {
  ok('线上账号服务连通（Origin 校验通过）', !(await body()).includes('暂时无法连接账号服务'))
}

await page.locator('.auth-card input.input').first().fill('1380013800')
await page.getByRole('button', { name: '发送短信验证码' }).click()
await page.waitForTimeout(300)
ok('10 位手机号被本地拦截并给出提示', (await body()).includes('请输入正确的 11 位手机号'))

await page.locator('.auth-card input.input').first().fill('13800138001')
await page.waitForTimeout(100)
ok('修改手机号后清除字段错误', !(await body()).includes('请输入正确的 11 位手机号'))

await page.getByRole('tab', { name: '邮箱' }).click()
await page.waitForTimeout(200)
ok('切换到邮箱登录', (await body()).includes('发送邮件验证码'))
ok('切换后清空手机号输入', (await page.locator('.auth-card input.input').first().inputValue()) === '')

await page.screenshot({ path: 'screenshots/07-cloud-login.png' })
await browser.close()

let passed = 0
for (const [label, result] of checks) {
  console.log(`${result ? 'PASS' : 'FAIL'}  ${label}`)
  if (result) passed++
}
console.log(`\n登录页验收：${passed} / ${checks.length} 项通过`)
console.log(`浏览器控制台：${errors.length ? errors.join(' | ') : '无错误'}`)
if (passed !== checks.length || errors.length) process.exit(1)
