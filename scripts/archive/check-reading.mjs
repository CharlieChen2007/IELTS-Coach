/* 阅读精读接入 · 全量验收（企业级可交付口径）
 *
 * 运行：CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4296 node scripts/check-reading.mjs
 *
 * 覆盖：模块本体渲染与首帧静默、四科统一的横幅/横向页签/一层动画、
 *       七个功能视图逐个可用且 iframe 不重建、分屏做题与交卷确认框功能不变、
 *       原文定位与阅读位置保存的滚动代理、数据库 GET/PUT/恢复/账号隔离、
 *       单一滚动轴（iframe 无独立滚动容器、滚轮只控制主站）、无 JS 错误与 4xx。
 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4296').replace(/\/$/, '')
/* 线上站点需要完整分享参数；带上后网关会给本次会话下发访问凭据，
   页面里 iframe / fetch 的相对路径请求便与本地验收走同一套逻辑。 */
const SHARE = process.env.SHARE_CODE || ''
const ENTRY = SHARE
  ? BASE + '/?sharecode=' + encodeURIComponent(SHARE) + '#/subject/reading'
  : BASE + '/#/subject/reading'
const SHOT = process.env.SHOT_DIR || '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d68-0fe215cc3000'
const SCOPE = 'user_reading_acceptance'
const checks = []
const ok = (label, cond, extra = '') => {
  checks.push([label, Boolean(cond)])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript((s) => {
  const d = { ielts_coach_mode: 'demo', ielts_coach_demo_user: s,
    ielts_coach_demo_accounts: JSON.stringify([{ userId: s, email: s + '@probe.local', nickname: '阅读验收' }]) }
  for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v)
}, SCOPE)
const page = await ctx.newPage()
const errors = []
const badResponses = []
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()) })
page.on('requestfailed', (r) => badResponses.push('failed ' + r.url()))

const frameBy = () => page.frames().find((f) => f.url().includes('/reading/index.html'))
const clickTab = async (label) => {
  await page.locator('.speaking-tabs button').filter({ hasText: label }).first().click()
  await sleep(950)
}
const frameState = (f) => f.evaluate(() => {
  const scrollables = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el)
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflow === 'auto') &&
      el.scrollHeight > el.clientHeight + 2
  }).map((el) => String(el.className || el.tagName).slice(0, 44))
  const el = document.scrollingElement
  return {
    hash: location.hash,
    mark: window.__acceptMark || 'LOST',
    text: (document.getElementById('app')?.innerText || '').trim(),
    bodyH: Math.round(document.body.getBoundingClientRect().height),
    iframeH: window.innerHeight,
    docScroll: el.scrollHeight,
    docClient: el.clientHeight,
    scrollables,
    panes: document.querySelectorAll('.pane').length,
    busy: [...document.querySelectorAll('body *')]
      .filter((e) => e.children.length === 0 && /正在(读取|载入|加载|准备|打开)/.test(e.textContent || ''))
      .map((e) => (e.textContent || '').trim()).slice(0, 4),
  }
})

/* ── 1. 首帧与展示方式统一 ─────────────────────────────────────────────── */
await page.goto(ENTRY, { waitUntil: 'domcontentloaded' })
/* 等模块自己上报 ready，而不是赌一个固定秒数：主站首屏装载时间会随机器负载
   浮动，固定 sleep 会卡在边界上偶发误判。ready 时业务 bundle 已挂载完成。 */
await page.locator('iframe.reading-frame.is-ready').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
await page.locator('.subject-hero').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})
await sleep(500)
let f = frameBy()
ok('阅读 iframe 已挂载', Boolean(f))
let s = f ? await frameState(f) : {}
if (f) await f.evaluate(() => { window.__acceptMark = 'kept' })

ok('阅读进入嵌入态（host-embedded）', await f?.evaluate(() => document.documentElement.classList.contains('host-embedded')) === true)
ok('阅读统一主题样式已加载', await f?.evaluate(() => [...document.styleSheets].some((x) => (x.href || '').includes('reading-theme.css'))) === true)
ok('阅读首页正文已渲染', (s.text?.length || 0) > 240, '正文 ' + (s.text?.length || 0) + ' 字')
ok('阅读 iframe 已上报 ready（不再透明）', await page.locator('iframe.reading-frame.is-ready').count() === 1)
ok('阅读模块无「正在…」等待文案', (s.busy || []).length === 0, JSON.stringify(s.busy || []))
ok('独立站顶栏 / 侧栏 / 品牌不可见', await f?.evaluate(() => {
  const vis = (sel) => { const e = document.querySelector(sel); return Boolean(e && e.getClientRects().length && getComputedStyle(e).display !== 'none') }
  return !vis('.topbar') && !vis('.sidebar') && !vis('.brand') && !vis('.toast')
}) === true)
ok('首页 hero 为主站浅蓝渐变', /237, 247, 255|220, 242, 252/.test(
  (await f?.evaluate(() => { const h = document.querySelector('.hero'); return h ? getComputedStyle(h).backgroundImage : '' })) || ''))
ok('题库卡片按钮统一品牌蓝', await f?.evaluate(() => {
  const all = [...document.querySelectorAll('.bank-cta')].map((b) => getComputedStyle(b).backgroundImage)
  return all.length >= 2 && all.every((v) => v === all[0] && v.includes('gradient'))
}) === true)
ok('无英文文艺长句 / 英文大写装饰标签', await f?.evaluate(() => {
  const hero = document.querySelector('.hero p')?.innerText || ''
  const kicker = document.querySelector('.hero-tag')?.innerText || ''
  return !/[A-Za-z]{28,}/.test(hero) && !/^[A-Z][A-Z0-9 ·,.\-]{5,}$/.test(kicker.trim())
}) === true)

const tabs = await page.locator('.speaking-tabs button').allInnerTexts()
ok('阅读页为与听/说/写同款的横向功能页签',
  ['题库总览', '篇章练习', '错题本', '单词本', '精读库', '薄弱题型', '学习档案', '学伴互助']
    .every((x) => tabs.includes(x)), JSON.stringify(tabs))
ok('主站科目横幅位置与其它科一致', await page.evaluate(() => {
  const r = document.querySelector('.subject-hero')?.getBoundingClientRect()
  return Boolean(r && Math.abs(r.x - 266) <= 2 && Math.abs(r.y - 105) <= 2)
}) === true)
ok('主内容区只有一层进场动画', await page.evaluate(() => {
  const st = document.querySelector('.page-view .stage-body')
  return st && ['hero-in', 'none'].includes(getComputedStyle(st).animationName)
}) === true)
const heroStats = await page.locator('.subject-hero-stats').innerText()
ok('横幅统计与模块内口径一致（精读篇目）', /精读篇目/.test(heroStats) && !/可练题目/.test(heroStats), heroStats.replace(/\n/g, ' / '))
await page.screenshot({ path: SHOT + '/reading-overview.png' })

/* ── 2. 七个功能视图：导航接管 + 功能不变 + iframe 不重建 ─────────────── */
const VIEWS = [
  ['篇章练习', '#/practice/', 'The Reinvention', 2],
  ['错题本', '#/mistakes', '错题本', 0],
  ['单词本', '#/vocab', '单词本', 0],
  ['精读库', '#/readlib', '精读库', 0],
  ['薄弱题型', '#/weak-types', '薄弱题型', 0],
  ['学习档案', '#/profile', '学习档案', 0],
  ['题库总览', '#/', '按题型练', 0],
]
for (const [label, hash, needle, paneCount] of VIEWS) {
  await clickTab(label)
  const cur = frameBy()
  const t = cur ? await frameState(cur) : {}
  ok(`页签「${label}」切换到正确视图`, Boolean(cur) && t.hash.startsWith(hash) && (t.text || '').includes(needle),
    `${t.hash} / ${(t.text || '').slice(0, 26).replace(/\n/g, '|')}`)
  ok(`页签「${label}」iframe 未重建（草稿与位置不丢）`, t.mark === 'kept')
  ok(`页签「${label}」主站页签与地址栏同步`,
    (await page.locator('.speaking-tabs button.on').innerText()) === label &&
    (await page.evaluate(() => location.hash)).includes(label === '题库总览' ? 'subject/reading' : 'view='))
  ok(`页签「${label}」无内部滚动容器`, (t.scrollables || []).length === 0, JSON.stringify((t.scrollables || []).slice(0, 3)))
  ok(`页签「${label}」iframe 高度贴合内容`, Math.abs((t.iframeH || 0) - (t.bodyH || 0)) <= 40,
    `${t.iframeH} / ${t.bodyH}`)
  if (paneCount) ok('篇章练习保留左右分屏两栏', t.panes === paneCount, 'pane=' + t.panes)
  ok(`页签「${label}」无可见「正在…」`, (t.busy || []).length === 0, JSON.stringify(t.busy || []))
}
await clickTab('篇章练习')
await page.screenshot({ path: SHOT + '/reading-practice.png' })

/* ── 3. 做题 / 交卷 / 原文定位：滚动代理不丢功能 ─────────────────────── */
f = frameBy()
const practice = await f.evaluate(() => ({
  chips: document.querySelectorAll('.q-chip').length,
  submit: [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '交卷'),
  passageText: (document.querySelector('.passage-pane')?.innerText || '').length,
  questionText: (document.querySelector('.question-pane')?.innerText || '').length,
}))
ok('做题页有题号导航与交卷按钮', practice.chips > 0 && practice.submit, JSON.stringify(practice))
ok('做题页原文与题目两栏都有内容', practice.passageText > 200 && practice.questionText > 100)

const beforeScroll = await page.evaluate(() => window.scrollY)
await f.locator('.q-chip').first().click()
await sleep(750)
const afterScroll = await page.evaluate(() => window.scrollY)
ok('点题号的「原文定位」由主站统一滚动（功能未丢）', afterScroll > beforeScroll + 80,
  `${beforeScroll} → ${afterScroll}`)
ok('定位后 iframe 自身仍不滚动', await f.evaluate(() => document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 2) === true)

await f.evaluate(() => window.scrollTo(0, 0))
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(200)
await f.locator('button').filter({ hasText: '交卷' }).first().click()
await sleep(700)
const dlg = await f.evaluate(() => {
  const el = document.querySelector('.dlg-overlay')
  if (!el) return null
  const scrollables = [...el.querySelectorAll('*')].filter((x) => {
    const cs = getComputedStyle(x)
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && x.scrollHeight > x.clientHeight + 2
  }).length
  return { position: getComputedStyle(el).position, scrollables, text: el.innerText.slice(0, 80) }
})
ok('交卷确认框功能仍在', Boolean(dlg) && /交卷/.test(dlg.text || ''), JSON.stringify(dlg))
ok('确认框改为页内卡片（position:static）', dlg?.position === 'static')
ok('确认框内不再有独立滚动条', dlg?.scrollables === 0)
const revealScroll = await page.evaluate(() => window.scrollY)
ok('确认框出现时主站自动带到卡片位置', revealScroll > 20, 'scrollY=' + revealScroll)
await f.locator('.dlg button').filter({ hasText: '取消' }).first().click().catch(() => {})
await sleep(500)

/* ── 4. 数据库：接口 / 备份 / 恢复 / 账号隔离 ─────────────────────────── */
const status = await page.evaluate(async () => {
  const r = await fetch('/api/reading/status')
  return { code: r.status, body: await r.json() }
})
ok('/api/reading/status 可用', status.code === 200 && status.body.configured === true, JSON.stringify(status.body))
const initial = await page.evaluate(async (scope) => {
  const r = await fetch('/api/reading/state?scope=' + scope, { headers: { 'X-Speaking-Scope': scope } })
  return { code: r.status, body: await r.json() }
}, SCOPE)
ok('/api/reading/state 读取可用', initial.code === 200 && 'data' in initial.body)

await f.evaluate(() => {
  localStorage.setItem('yl.v1.vocab', JSON.stringify({ acceptance: { word: 'acceptance', at: Date.now() } }))
})
await sleep(1500)
const saved = await page.evaluate(async (scope) => {
  const r = await fetch('/api/reading/state?scope=' + scope, { headers: { 'X-Speaking-Scope': scope } })
  return { code: r.status, body: await r.json() }
}, SCOPE)
let payload = null
try { payload = JSON.parse(saved.body.data) } catch { /* 忽略 */ }
ok('练习进度自动备份到站点数据库', saved.code === 200 && payload?.['yl.v1.vocab']?.includes('acceptance'),
  JSON.stringify(saved.body).slice(0, 160))

const otherScope = 'other_account_' + Date.now()
const isolated = await page.evaluate(async (scope) => {
  const r = await fetch('/api/reading/state?scope=' + scope, { headers: { 'X-Speaking-Scope': scope } })
  return (await r.json()).data
}, otherScope)
ok('数据库按站内账号隔离', isolated === null, String(isolated))

/* 换一个全新的浏览器上下文（等价于换设备），验证 init 能从数据库恢复 */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx2.addInitScript((s) => {
  const d = { ielts_coach_mode: 'demo', ielts_coach_demo_user: s,
    ielts_coach_demo_accounts: JSON.stringify([{ userId: s, email: s + '@probe.local', nickname: '阅读验收' }]) }
  for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v)
}, SCOPE)
const page2 = await ctx2.newPage()
await page2.goto(ENTRY, { waitUntil: 'networkidle' })
await sleep(2200)
const f2 = page2.frames().find((x) => x.url().includes('/reading/index.html'))
const restored = await f2?.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('yl.v1.vocab') || '{}') } catch { return {} }
})
ok('换设备后从数据库恢复练习记录', restored?.acceptance?.word === 'acceptance', JSON.stringify(restored))
await ctx2.close()

/* ── 5. 学伴互助（四科统一）＋ 切回后状态不丢 ─────────────────────────── */
await clickTab('学伴互助')
const peersState = await page.evaluate(() => {
  const frame = document.querySelector('iframe.reading-frame')
  const hold = frame?.parentElement?.parentElement
  return {
    tab: document.querySelector('.speaking-tabs button.on')?.innerText || '',
    text: (document.querySelector('.stage-body')?.innerText || '').trim().length,
    hidden: Boolean(frame) && (getComputedStyle(hold || frame).display === 'none' || frame.getBoundingClientRect().height === 0),
  }
})
ok('学伴互助由主站统一组件渲染', peersState.tab === '学伴互助' && peersState.text > 40, JSON.stringify(peersState))
ok('学伴互助时阅读 iframe 只隐藏、不卸载（进度备份不被打断）', peersState.hidden)
await clickTab('篇章练习')
const back = frameBy()
const backState = back ? await frameState(back) : {}
ok('切回阅读后 iframe 仍是同一个（草稿与阅读位置不丢）', backState.mark === 'kept')
ok('切回阅读后高度重新贴合内容', Math.abs((backState.iframeH || 0) - (backState.bodyH || 0)) <= 40,
  `${backState.iframeH} / ${backState.bodyH}`)
ok('切回阅读后仍无内部滚动容器', (backState.scrollables || []).length === 0, JSON.stringify(backState.scrollables || []))

/* ── 6. 全站清洁度 ───────────────────────────────────────────────────── */
ok('无 JS 运行时错误', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
ok('无 4xx/5xx 资源与失败请求', badResponses.length === 0, JSON.stringify(badResponses.slice(0, 3)))

await browser.close()
const passed = checks.filter(([, v]) => v).length
console.log(`\n阅读接入全量验收：${passed} / ${checks.length} 项通过`)
process.exit(passed === checks.length ? 0 : 1)
