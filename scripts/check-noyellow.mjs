/* 验收：首页不再出现截图里那两块黄色（侧栏目标分卡 + 演示模式横幅） */
import { chromium } from 'playwright-core'
const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'
const res = []
const ok = (n, c, d = '') => { res.push([n, !!c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1029 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(BASE + '/#/auth?mode=signin', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const d = page.getByRole('button', { name: '本机体验' })
if (await d.count()) await d.first().click()
await page.waitForTimeout(300)
await page.locator('input[placeholder="例如：Alex"]').fill('黄块验收')
await page.locator('input[placeholder="you@example.com"]').fill('noyellow@example.com')
await page.getByRole('button', { name: '进入学习首页' }).click()
await page.waitForTimeout(1400)

ok('侧栏不再有黄色目标分卡', (await page.locator('.side-card.lemon').count()) === 0)
ok('不再有演示模式横幅', (await page.locator('.banner.demo').count()) === 0)
ok('「目标分」不再出现于侧栏', !(await page.locator('.sidebar').innerText()).includes('目标分'))
ok('「演示模式」文案不再出现于内容区', !(await page.locator('.content').innerText()).includes('当前为演示模式'))
ok('侧栏「今日进度」仍在', (await page.locator('.side-card').count()) >= 1)

// 像素复核：截全屏，统计黄色占比（应只剩每日任务未完成态的浅色）
await page.screenshot({ path: 'screenshots/51-home-noyellow.png' })
const { createRequire } = await import('node:module')
const stats = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
console.log(`截图尺寸 ${stats.w}x${stats.h}`)

// 侧栏宽度与内容区起点仍正常（删除后不应留下空档）
const geo = await page.evaluate(() => {
  const side = document.querySelector('.sidebar').getBoundingClientRect()
  const main = document.querySelector('.main').getBoundingClientRect()
  const content = document.querySelector('.content').getBoundingClientRect()
  const hero = document.querySelector('.hero-banner').getBoundingClientRect()
  return { sideW: Math.round(side.width), mainX: Math.round(main.x), contentY: Math.round(content.y), heroY: Math.round(hero.y) }
})
ok('删除后布局无空洞（内容区紧接顶栏）', geo.contentY <= geo.heroY + 2, JSON.stringify(geo))

console.log('\n控制台错误:', errs.length ? errs.join(' | ') : '无')
const passed = res.filter((r) => r[1]).length
console.log(`黄色元素验收：${passed} / ${res.length} 项通过`)
await browser.close()
if (passed !== res.length || errs.length) process.exit(1)
