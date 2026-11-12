/* 进场动画验收（含首屏骨架时序）
   1) 慢速网络下：骨架先渲染并播放动画，不等 JS
   2) 骨架移除后：真实首屏直接显示，不重播第二次
   3) 下方区块：滚动进入视口才播放
   4) 直接进入登录页：卡片完整播放动画
   5) reduced-motion：直接可见                                             */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4196/'
const checks = []
const ok = (label, cond) => { checks.push([label, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`) }
const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

// ---------- 1&2) 限速下观察骨架与接管过程 ----------
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push(e.message))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 120,
  downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 512 * 1024 / 8,
})

const samples = []
await page.goto(BASE, { waitUntil: 'commit' })
for (let i = 0; i < 22; i++) {
  const s = await page.evaluate(() => {
    const boot = document.getElementById('boot')
    // 主标题的字是运行时拼出来的 <span>，早期它还没生成；这时用徽标（起始 .18 淡入）判断中间态
    const b = boot?.querySelector('.boot-title span') || boot?.querySelector('.boot-emblem')
    const r = document.querySelector('.landing-hero-copy h1')
    return {
      hasBoot: !!boot,
      bootOpacity: b ? +getComputedStyle(b).opacity : null,
      realOpacity: r ? +getComputedStyle(r).opacity : null,
      booted: document.body?.classList.contains('booted') ?? false,
    }
  })
  samples.push(s)
  await page.waitForTimeout(70)
}

const bootFrames = samples.filter((s) => s.hasBoot && s.bootOpacity !== null)
ok('JS 尚未加载时首屏骨架已经出现', bootFrames.length >= 4)
ok('骨架期间确实观察到进场中间态（0 < opacity < 1）',
  bootFrames.some((s) => s.bootOpacity > 0.02 && s.bootOpacity < 0.98))

// 骨架移除后，真实首屏应立即完全可见（不再播第二遍）
// 注意判据要带 document.body：限速下 <body> 还没解析出来时，getElementById 也是 null，
// 只看「没有 #boot」会在第 0 帧就误判成交接完成
await page.waitForFunction(() => document.body && !document.getElementById('boot'), null, { timeout: 30000 })
const after = await page.evaluate(() => {
  const q = (sel) => { const el = document.querySelector(sel); return el ? +getComputedStyle(el).opacity : null }
  return {
    // 交接标记是 <html data-ready>（旧版本用 body.booted，已随进场层重构移除）
    booted: document.documentElement.hasAttribute('data-ready'),
    h1: q('.landing-hero-copy h1'), desc: q('.landing-hero-copy > p'),
    cta: q('.landing-cta'), trust: q('.landing-trust'), art: q('.landing-hero-art'),
  }
})
ok('骨架已移除并标记 data-ready', after.booted)
/* 判据用 0.98：交接发生时首屏的进场刚好在收尾，读到 0.99 / 0.98 属于正常，
   真正的「二次动画」会掉到 0.3 以下并重新爬升，不会落在这个区间。 */
const visible = (v) => typeof v === 'number' && v >= 0.98
ok('真实首屏切换后立即完整可见（无二次动画）',
  visible(after.h1) && visible(after.desc) && visible(after.cta) && visible(after.trust),
  `${after.h1}/${after.desc}/${after.cta}/${after.trust}`)
ok('主视觉配图切换后可见', visible(after.art), String(after.art))
console.log('  → 采样:', samples.map((s) => (s.hasBoot ? (s.bootOpacity ?? 0).toFixed(2) : 'handoff')).join(' '))

// ---------- 3) 滚动触发 ----------
const beforeScroll = await page.evaluate(() => document.querySelector('.landing-steps li')?.classList.contains('is-in'))
ok('视口外区块初始未入场', beforeScroll === false)
await page.locator('#flow').scrollIntoViewIfNeeded()
// 限速模拟下滚动定位会滞后，等元素真正进入视口再读取
await page.waitForFunction(() => {
  const li = document.querySelector('.landing-steps li')
  if (!li) return false
  const top = li.getBoundingClientRect().top
  return top > 0 && top < window.innerHeight * 0.85
}, null, { timeout: 15000 })
// 等待动画播完（限速下需要更久），而不是固定 sleep
const scrolled = await page.waitForFunction(() => {
  const list = [...document.querySelectorAll('.landing-steps li')]
  return list.length > 0 && list.every((li) => li.classList.contains('is-in') && +getComputedStyle(li).opacity === 1)
}, null, { timeout: 20000 }).then(() => true).catch(() => false)
ok('滚动进入视口后区块入场', scrolled)
await page.close()

// ---------- 4) 直接进入登录页（无骨架，应完整播放） ----------
// 登录页只在「本机没有会话」时出现；用全新上下文，避免被前面几段留下的演示账号直接送进学习空间
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
p2.on('pageerror', (e) => errors.push(e.message))
await p2.goto(`${BASE}#/auth?mode=signin`, { waitUntil: 'domcontentloaded' })
// 登录页卡片要等进场层交接完才挂载（限速/首帧降档时会到 2s 以后）
await p2.waitForSelector('.auth-card', { timeout: 30000 })
await p2.waitForTimeout(1600)
const auth = await p2.evaluate(() => {
  const el = document.querySelector('.auth-card')
  if (!el) return { anim: 'none', o: 0 }
  return { anim: getComputedStyle(el).animationName, o: +getComputedStyle(el).opacity }
})
ok('登录页卡片带进场动画（已执行）', auth.anim !== 'none')
ok('登录页卡片最终完全可见', auth.o === 1)
await ctx2.close()

// ---------- 5) 减少动态效果 ----------
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const p3 = await ctx3.newPage()
await p3.goto(BASE, { waitUntil: 'networkidle' })
await p3.waitForTimeout(1500)
const reduced = await p3.evaluate(() => {
  const h1 = document.querySelector('.landing-hero-copy h1')
  return { o: h1 ? +getComputedStyle(h1).opacity : 0 }
})
ok('reduced-motion 下内容直接可见', reduced.o === 1)
await ctx3.close()

await browser.close()
console.log(`\n进场动画验收：${checks.filter((c) => c[1]).length} / ${checks.length} 项通过`)
console.log(`控制台：${errors.length ? errors.join(' | ') : '无错误'}`)
if (checks.some((c) => !c[1]) || errors.length) process.exit(1)
