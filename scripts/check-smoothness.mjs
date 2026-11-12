/* 流畅度实测：CDP 降速 + 长任务统计
   对比「有 blur / backdrop-filter」与「已移除」两种状态下的首屏与滚动表现。
   判定口径：长任务（>50ms）数量与总阻塞时长，越低越流畅。

   另核对动画收敛口径（本轮）：一次点击只有一层动画 —— 首页 hero 内部逐元素进场
   已刻意关闭，整个主内容区由 .stage-body 统一播一次 hero-in。
   旧断言「hero 内部每个元素都要有入场动画」与收敛后的设计相反，已反转。 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const fail = []

async function run(label, { width, height, cpu, mobile }) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })

  await page.addInitScript(() => {
    window.__lt = []
    new PerformanceObserver((list) => { list.getEntries().forEach((e) => window.__lt.push(e.duration)) })
      .observe({ entryTypes: ['longtask'] })
  })

  await page.goto(BASE + '/#/auth?mode=signin', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  const demoTab = page.getByRole('button', { name: '本机体验' })
  if (await demoTab.count()) await demoTab.first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="例如：Alex"]').fill('流畅测试')
  await page.locator('input[placeholder="you@example.com"]').fill('smooth@example.com')

  // 从进首页那一刻开始计
  await page.evaluate(() => { window.__lt = [] })
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForTimeout(2600)
  const boot = await page.evaluate(() => ({
    longtasks: window.__lt.length,
    blocked: Math.round(window.__lt.reduce((a, b) => a + b, 0)),
    maxOne: Math.round(Math.max(0, ...window.__lt)),
  }))

  // 滚动 800px：这段最能暴露 backdrop-filter 的代价
  await page.evaluate(() => { window.__lt = [] })
  await page.evaluate(async () => {
    for (let i = 0; i < 24; i++) {
      window.scrollBy(0, 34)
      await new Promise((r) => requestAnimationFrame(r))
    }
  })
  await page.waitForTimeout(400)
  const scroll = await page.evaluate(() => ({
    longtasks: window.__lt.length,
    blocked: Math.round(window.__lt.reduce((a, b) => a + b, 0)),
  }))

  const css = await page.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      return { backdrop: s.backdropFilter || s.webkitBackdropFilter, anim: s.animationName }
    }
    return {
      topbar: probe('.topbar'),
      stat: probe('.hero-stats .stat'),
      nav: probe('.landing-nav'),
      // 主内容区唯一的进场层（动画收敛后）
      stage: probe('.page-view .stage-body'),
      // hero 内部逐元素：收敛后应全部为 none，不再各自动
      hero: ['.hero-kicker', '.hero-inner h1', '.hero-inner > p', '.hero-actions', '.hero-stats', '.hero-note']
        .map((sel) => { const el = document.querySelector('.hero-banner ' + sel); return el ? getComputedStyle(el).animationName : 'missing' }),
    }
  })

  console.log(`${label.padEnd(26)} 首屏长任务=${String(boot.longtasks).padStart(2)}  阻塞=${String(boot.blocked).padStart(4)}ms  最长=${String(boot.maxOne).padStart(4)}ms | 滚动长任务=${String(scroll.longtasks).padStart(2)} 阻塞=${String(scroll.blocked).padStart(3)}ms`)
  await page.close()
  return { boot, scroll, css }
}

console.log('=== 降速实测（数字越小越流畅）===')
const desktop = await run('桌面 1440 正常 CPU', { width: 1440, height: 900, cpu: 1 })
const slow = await run('桌面 1440 · CPU 4x 降速', { width: 1440, height: 900, cpu: 4 })
const phone = await run('手机 390 正常 CPU', { width: 390, height: 844, cpu: 1, mobile: true })
const phoneSlow = await run('手机 390 · CPU 4x 降速', { width: 390, height: 844, cpu: 4, mobile: true })

console.log('\n=== 样式核对（动画收敛口径）===')
console.log('顶栏 backdrop-filter:', desktop.css.topbar?.backdrop)
console.log('统计卡 backdrop-filter:', desktop.css.stat?.backdrop)
console.log('统计卡 animation:', desktop.css.stat?.anim)
console.log('首页主内容层 .stage-body animationName:', desktop.css.stage?.anim ?? 'missing')
console.log('首页 hero 内部逐元素 animationName:', (desktop.css.hero ?? []).join(', '))
// 一次点击只有一层动画：hero 内部逐元素进场刻意关闭（避免「闪得眼花」），
// 整个主内容区由 .stage-body 统一播一次 hero-in。这里反查：
//  · hero 内部元素必须全是 none / missing（不再各自单独淡入）
//  · .stage-body 必须是唯一在跑 hero-in 的一层
if ((desktop.css.hero ?? []).some((n) => n !== 'none' && n !== 'missing')) {
  fail.push('首页 hero 内部仍有单独入场动画（应收敛为主内容区一层）：' + desktop.css.hero.join(', '))
}
if (desktop.css.stage?.anim !== 'hero-in') {
  fail.push('首页主内容区 .stage-body 未统一进场：' + (desktop.css.stage?.anim ?? 'missing'))
}

const budget = 260
if (desktop.boot.blocked > budget) fail.push(`桌面首屏阻塞 ${desktop.boot.blocked}ms > ${budget}`)
if (phone.boot.blocked > budget) fail.push(`手机首屏阻塞 ${phone.boot.blocked}ms > ${budget}`)
if (desktop.scroll.blocked > 120) fail.push(`桌面滚动阻塞 ${desktop.scroll.blocked}ms > 120`)
if (phone.scroll.blocked > 120) fail.push(`手机滚动阻塞 ${phone.scroll.blocked}ms > 120`)

await browser.close()
if (fail.length) { console.log('\n未通过：' + fail.join(' | ')); process.exit(1) }
console.log('\n全部在预算内')
