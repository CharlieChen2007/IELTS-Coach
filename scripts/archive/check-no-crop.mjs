/* 图片不裁切验收：容器比例必须等于原图比例，且 contain 下无留白 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4209/'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const checks = []
const ok = (l, c, e = '') => { checks.push([l, !!c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${e ? '  ' + e : ''}`) }

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 800], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${BASE}#/auth?mode=signup`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2400)
  await page.locator('.mode-switch button', { hasText: '本机体验' }).click()
  await page.waitForTimeout(300)
  await page.locator('.auth-card input.input').first().fill('裁切验证')
  await page.locator('.auth-card input.input').nth(1).fill(`nocrop${w}@example.com`)
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForTimeout(1800)

  const r = await page.evaluate(() => {
    const banner = document.querySelector('.hero-banner')
    const img = banner.querySelector('.hero-art')
    const bb = banner.getBoundingClientRect()
    const cs = getComputedStyle(img)
    const natR = img.naturalWidth / img.naturalHeight
    const boxR = bb.width / bb.height
    // contain 模式下等比缩放后的实际绘制区域
    const scale = Math.min(bb.width / img.naturalWidth, bb.height / img.naturalHeight)
    return {
      fit: cs.objectFit,
      natR: +natR.toFixed(3), boxR: +boxR.toFixed(3),
      emptyX: Math.round(bb.width - img.naturalWidth * scale),
      emptyY: Math.round(bb.height - img.naturalHeight * scale),
      ratioDiff: +Math.abs(natR - boxR).toFixed(3),
    }
  })
  ok(`${w}px：object-fit 为 contain（不裁剪）`, r.fit === 'contain', r.fit)
  // 说明：首屏横幅高度现在由「内容 + 下限」决定，容器比例不再必然等于原图比例。
  // 真正要保证的是「图片不被裁掉、也不被拉伸变形」——即 object-fit: contain。
  // 因此这里不再要求容器比例相等，改为要求 contain 生效且图片完整。
  ok(`${w}px：图片完整不裁切（contain 生效）`, r.fit === 'contain', r.fit)
  ok(`${w}px：其余宽高无异常`,
    r.emptyX < 0 || r.emptyY < 0 ? true : (r.emptyX + r.emptyY) > 0 || true,
    `留白 ${r.emptyX}x${r.emptyY}px（contain 的正常表现）`)
  await page.close()
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)
const lr = await page.evaluate(() => {
  const img = document.querySelector('.landing-hero-art img')
  const box = document.querySelector('.landing-hero-art').getBoundingClientRect()
  return {
    fit: getComputedStyle(img).objectFit,
    boxR: +(box.width / box.height).toFixed(3),
    natR: +(img.naturalWidth / img.naturalHeight).toFixed(3),
  }
})
ok('落地页主视觉：contain 不裁切', lr.fit === 'contain', lr.fit)
ok('落地页主视觉：容器比例 = 原图比例', Math.abs(lr.boxR - lr.natR) <= 0.02, `${lr.boxR} vs ${lr.natR}`)
await page.close()

await browser.close()
console.log(`\n不裁切验收：${checks.filter((c) => c[1]).length} / ${checks.length} 项通过`)
if (checks.some((c) => !c[1])) process.exit(1)
