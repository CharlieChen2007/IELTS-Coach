/* 统计卡位置验收：目标分必须在「累计练习」正下方 */
import { chromium } from 'playwright-core'
const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'
const res = []
const ok = (n, c, d = '') => { res.push([n, !!c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })

async function measure(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(BASE + '/#/auth?mode=signin', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const d = page.getByRole('button', { name: '本机体验' })
  if (await d.count()) await d.first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="例如：Alex"]').fill('统计验收')
  await page.locator('input[placeholder="you@example.com"]').fill(`stats${width}@example.com`)
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForTimeout(1200)
  const rows = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.hero-stats .stat')]
    return list.map((el) => {
      const r = el.getBoundingClientRect()
      return { label: el.querySelector('.label').textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
    })
  })
  const by = (n) => rows.find((r) => r.label === n)
  const total = by('累计练习'), target = by('目标分'), wrong = by('待复习错题'), today = by('今日完成')
  ok(`${label}：四张卡都在`, rows.length === 4, rows.map((r) => r.label).join(' / '))
  ok(`${label}：目标分在累计练习正下方`, target.y > total.y && Math.abs(target.x - total.x) <= 2,
    `累计(x=${total.x},y=${total.y}) 目标(x=${target.x},y=${target.y})`)
  ok(`${label}：目标分与累计练习同宽`, Math.abs(target.w - total.w) <= 2, `${total.w} vs ${target.w}`)
  if (width > 760) {
    // 宽屏：第一行三张并排，目标分单独占第二行第一列
    ok(`${label}：第一行三张左右排列`, total.y === wrong.y && wrong.y === today.y && total.x < wrong.x && wrong.x < today.x,
      `x=${total.x},${wrong.x},${today.x}`)
    ok(`${label}：第一行只有三张（目标分已下沉）`, target.y > today.y, `今日完成y=${today.y} 目标分y=${target.y}`)
  } else {
    // 窄屏：2 列，前两张一行、后两张一行；目标分仍与累计练习同列
    ok(`${label}：窄屏 2 列布局`, total.y === wrong.y && today.y > wrong.y && total.x === today.x,
      `累计/错题 y=${total.y} 今日完成 y=${today.y}`)
  }
  ok(`${label}：目标分不与其它卡重叠`,
    !rows.some((r) => r.label !== '目标分' && Math.abs(r.y - target.y) < 5 && Math.abs(r.x - target.x) < 5))
  if (width === 1440) await page.screenshot({ path: 'screenshots/40-stats-desktop.png', clip: { x: 266, y: 220, width: 700, height: 460 } })
  if (width === 390) await page.screenshot({ path: 'screenshots/41-stats-mobile.png' })
  await page.close()
}

await measure(1440, 900, '桌面 1440')
await measure(1190, 900, '中宽 1190')
await measure(390, 844, '手机 390')
const passed = res.filter((r) => r[1]).length
console.log(`\n统计卡验收：${passed} / ${res.length} 项通过`)
await browser.close()
if (passed !== res.length) process.exit(1)
