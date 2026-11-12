/* 图标几何验收：每个图标在 24 视框内必须居中对称、占比合理、可辨识
   判据：左右边距差 ≤0.8、上下边距差 ≤0.8、图形面积占视框 30%~92%         */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4206/'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const checks = []
const ok = (label, cond, extra = '') => {
  checks.push([label, !!cond])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)
await page.locator('#subjects').scrollIntoViewIfNeeded()
await page.waitForTimeout(1300)

const geo = await page.evaluate(() => {
  return [...document.querySelectorAll('.landing-subject')].map((card) => {
    const svg = card.querySelector('.landing-subject-icon svg')
    const bb = svg.getBBox() // viewBox 坐标系内的真实绘制范围
    const mL = bb.x, mR = 24 - bb.x - bb.width
    const mT = bb.y, mB = 24 - bb.y - bb.height
    return {
      label: card.querySelector('b').textContent,
      w: +bb.width.toFixed(2), h: +bb.height.toFixed(2),
      cx: +(bb.x + bb.width / 2).toFixed(2), cy: +(bb.y + bb.height / 2).toFixed(2),
      mL: +mL.toFixed(2), mR: +mR.toFixed(2), mT: +mT.toFixed(2), mB: +mB.toFixed(2),
      fillRatio: +((bb.width * bb.height) / (24 * 24)).toFixed(3),
      outside: mL < 0 || mR < 0 || mT < 0 || mB < 0,
      shapes: svg.querySelectorAll('path,rect').length,
      filled: getComputedStyle(svg).fill !== 'none',
    }
  })
})

ok('四科图标共 4 个', geo.length === 4)
geo.forEach((g) => {
  ok(`${g.label}：左右对称`, Math.abs(g.mL - g.mR) <= 0.8, `L${g.mL}/R${g.mR}`)
  ok(`${g.label}：上下对称`, Math.abs(g.mT - g.mB) <= 0.8, `T${g.mT}/B${g.mB}`)
  ok(`${g.label}：中心居中于 (12,12)`, Math.abs(g.cx - 12) <= 0.8 && Math.abs(g.cy - 12) <= 0.8, `(${g.cx},${g.cy})`)
  ok(`${g.label}：未超出视框`, !g.outside)
  ok(`${g.label}：占比 30%~92%（够大但不贴边）`, g.fillRatio >= 0.30 && g.fillRatio <= 0.92, `${(g.fillRatio * 100).toFixed(1)}%`)
  ok(`${g.label}：实心填充且有图形`, g.filled && g.shapes >= 1, `形状${g.shapes}`)
})

await page.close()
await browser.close()
console.log(`\n图标几何验收：${checks.filter((c) => c[1]).length} / ${checks.length} 项通过`)
if (checks.some((c) => !c[1])) process.exit(1)
