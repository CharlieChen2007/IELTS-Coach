/* 方块完整性验收：四科/入口图标必须完整落在方块内，四块等宽、不被裁切
   覆盖桌面 / 平板 / 手机多档宽度。                                          */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4199/'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const checks = []
const ok = (label, cond, extra = '') => {
  checks.push([label, !!cond])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/** 检查图标方块是否完整：SVG 必须完全在方块内，且方块自身不被祖先裁切 */
const INSPECT = `(() => {
  const result = []
  /* 学习首页的入口图标早已从 .tile-icon 换成 .subject-card-icon；
     三个选择器一起查，落地页与学习首页都能真正验到（否则首页恒为 0 个节点）。 */
  const nodes = [...document.querySelectorAll('.landing-subject-icon, .tile-icon, .subject-card-icon')]
  for (const box of nodes) {
    const svg = box.querySelector('svg')
    const bb = box.getBoundingClientRect()
    const sb = svg ? svg.getBoundingClientRect() : null
    const cs = getComputedStyle(box)
    // 检查所有祖先是否裁切到这个方块（只关心 overflow 非 visible 的祖先）
    let clippedBy = null
    let p = box.parentElement
    while (p && p !== document.body) {
      const pcs = getComputedStyle(p)
      if (pcs.overflow !== 'visible' || pcs.overflowX !== 'visible' || pcs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect()
        if (bb.left < pr.left - 1 || bb.right > pr.right + 1 || bb.top < pr.top - 1 || bb.bottom > pr.bottom + 1) {
          clippedBy = p.className || p.tagName
          break
        }
      }
      p = p.parentElement
    }
    result.push({
      text: (box.parentElement?.textContent ?? '').trim().slice(0, 10),
      boxW: Math.round(bb.width), boxH: Math.round(bb.height),
      svgW: sb ? Math.round(sb.width) : 0, svgH: sb ? Math.round(sb.height) : 0,
      svgInside: sb ? (sb.left >= bb.left - 0.6 && sb.right <= bb.right + 0.6 && sb.top >= bb.top - 0.6 && sb.bottom <= bb.bottom + 0.6) : false,
      selfClip: cs.overflow !== 'visible',
      clippedBy,
      offscreen: bb.left < -1 || bb.right > window.innerWidth + 1,
    })
  }
  return result
})()`

async function landing(widths) {
  for (const [w, h] of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2600)
    await page.locator('#subjects').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1400)

    const icons = await page.evaluate(INSPECT)
    ok(`落地页 ${w}px：找到 4 个科目方块`, icons.length === 4, `实得 ${icons.length}`)
    ok(`落地页 ${w}px：图标完整在方块内`, icons.every((i) => i.svgInside),
      icons.map((i) => `${i.text}${i.svgInside ? '✓' : '✗'}`).join(' '))
    ok(`落地页 ${w}px：无方块被裁切`, icons.every((i) => !i.clippedBy && !i.selfClip && !i.offscreen))
    ok(`落地页 ${w}px：图标尺寸不为 0`, icons.every((i) => i.svgW >= 18 && i.svgH >= 18),
      icons.map((i) => `${i.svgW}x${i.svgH}`).join(' '))

    // 四块等宽（同一行时宽度应一致）
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('.landing-subject')].map((c) => Math.round(c.getBoundingClientRect().width)),
    )
    const sameRow = new Set(await page.evaluate(() =>
      [...document.querySelectorAll('.landing-subject')].map((c) => Math.round(c.getBoundingClientRect().top)),
    )).size === 1
    if (sameRow) {
      ok(`落地页 ${w}px：四块等宽`, Math.max(...widths) - Math.min(...widths) <= 1, widths.join('/'))
    } else {
      ok(`落地页 ${w}px：多行排列时各块不超出屏幕`, widths.every((x) => x <= w), widths.join('/'))
    }
    await page.close()
  }
}

async function appHome(widths) {
  for (const [w, h] of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`${BASE}#/auth?mode=signup`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2400)
    await page.locator('.mode-switch button', { hasText: '本机体验' }).click()
    await page.waitForTimeout(300)
    await page.locator('.auth-card input.input').first().fill('方块验收')
    await page.locator('.auth-card input.input').nth(1).fill(`sq${w}@example.com`)
    await page.getByRole('button', { name: '进入学习首页' }).click()
    await page.waitForTimeout(1600)

    const icons = await page.evaluate(INSPECT)
    ok(`学习首页 ${w}px：入口图标完整在方块内`, icons.length > 0 && icons.every((i) => i.svgInside),
      icons.map((i) => `${i.text.slice(0, 4)}${i.svgInside ? '✓' : '✗'}`).join(' '))
    ok(`学习首页 ${w}px：无图标被裁切`, icons.every((i) => !i.clippedBy && !i.selfClip && !i.offscreen))
    await page.close()
  }
}

/** 图标可辨识度：描边色与方块底色的对比度必须 ≥4.5，否则图形"看不见" */
const CONTRAST = `(() => {
  const rgb = (c) => c.match(/\\d+/g).map(Number).slice(0, 3)
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  return [...document.querySelectorAll('.landing-subject')].map((card) => {
    const svg = card.querySelector('.landing-subject-icon svg')
    const box = card.querySelector('.landing-subject-icon')
    const cs = getComputedStyle(svg)
    // 实心图标用 fill 着色；兼容线性图标用 stroke
    const inkColor = cs.fill && cs.fill !== 'none' ? cs.fill : cs.stroke
    const l1 = lum(rgb(inkColor))
    const l2 = lum(rgb(getComputedStyle(box).backgroundColor))
    return {
      label: card.querySelector('b').textContent,
      ratio: +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))).toFixed(2),
      shapes: svg.querySelectorAll('path,rect').length,
    }
  })
})()`

async function contrastAndDetail() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)
  await page.locator('#subjects').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1300)
  const items = await page.evaluate(CONTRAST)
  ok('四科图标共 4 个', items.length === 4)
  ok('每个图标描边与底色对比度 ≥4.5（清晰可辨）', items.every((i) => i.ratio >= 4.5),
    items.map((i) => `${i.label}${i.ratio}`).join(' '))
  ok('每个图标至少 2 个图形段（不是空白）', items.every((i) => i.shapes >= 2),
    items.map((i) => `${i.label}:${i.shapes}`).join(' '))
  await page.close()
}

await landing([[1440, 900], [1280, 800], [1024, 800], [820, 1000], [390, 844]])
await contrastAndDetail()
await appHome([[1440, 900], [1024, 800], [820, 1000], [390, 844]])
await browser.close()

console.log(`\n方块完整性验收：${checks.filter((c) => c[1]).length} / ${checks.length} 项通过`)
if (checks.some((c) => !c[1])) process.exit(1)
