/* 本轮验收：语料 / 词汇色调统一 + 写作精修室「功能不变、展示方式统一」。
 *
 * 运行：CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4295 node scripts/check-writing.mjs
 * 覆盖：写作 iframe 渲染与首帧静默、主站横向页签接管导航且 iframe 不重建、
 *       独立站竖排侧栏 / 黄色 hero 已统一为主站浅蓝白卡、交接包原有功能仍可用、
 *       工作区数据库、AI 状态接口、两个模块的 hero 配色、
 *       页签切换仍只有主内容区一层进场动画、全项目无可见「正在…」等待文案。
 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4295').replace(/\/$/, '')
const SHOT = process.env.SHOT_DIR || '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d68-0fe215cc3000'
const checks = []
const ok = (label, cond, extra = '') => {
  checks.push([label, Boolean(cond)])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => {
  localStorage.setItem('ielts_coach_mode', 'demo')
  localStorage.setItem('ielts_coach_demo_user', 'user_writing_probe')
  localStorage.setItem('ielts_coach_demo_accounts', JSON.stringify([
    { userId: 'user_writing_probe', email: 'probe@writing.local', nickname: '写作探针' },
  ]))
})
const page = await ctx.newPage()
const errors = []
const badResponses = []
page.on('pageerror', e => errors.push('pageerror: ' + String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('response', r => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()) })
page.on('requestfailed', r => badResponses.push('failed ' + r.url()))

const frameBy = (needle) => page.frames().find(f => f.url().includes(needle))

/* ── 1. 写作精修室 ─────────────────────────────────────────────────────── */
await page.goto(BASE + '/#/subject/writing', { waitUntil: 'networkidle' })
await sleep(2600)
const writing = frameBy('/writing/index.html')
ok('写作 iframe 已挂载', Boolean(writing))
let w = {}
if (writing) {
  w = await writing.evaluate(() => {
    const root = document.getElementById('root')
    const loading = document.querySelector('.loading-screen')
    return {
      embedded: document.documentElement.classList.contains('host-embedded'),
      guest: localStorage.getItem('tcamp-guest:v1') === '1',
      text: (root?.innerText || '').trim(),
      busyText: [...document.querySelectorAll('body *')]
        .filter(el => el.children.length === 0 && /正在/.test(el.textContent || ''))
        .map(el => (el.textContent || '').trim()).slice(0, 5),
      loadingHidden: !loading || getComputedStyle(loading).display === 'none',
      images: [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 0).length,
      title: document.title,
    }
  })
}
ok('写作模块进入嵌入态', w.embedded === true)
ok('写作模块自动进入「先体验」游客模式', w.guest === true)
ok('写作正文已渲染', (w.text?.length || 0) > 200, '正文 ' + (w.text?.length || 0) + ' 字')
ok('写作模块无「正在…」等待文案', (w.busyText || []).length === 0, JSON.stringify(w.busyText || []))
ok('嵌入态加载页不闪现', w.loadingHidden === true)
ok('写作 iframe 已上报 ready（不再透明）', await page.locator('iframe.writing-frame.is-ready').count() === 1)
const writingTabs = await page.locator('.speaking-tabs button').allInnerTexts()
ok('写作页为与听/说同款的横向功能页签',
  ['练习概览', '写作精修', '批改报告', '二稿对比', '练习记录', '学伴互助']
    .every(label => writingTabs.includes(label)), JSON.stringify(writingTabs))
await page.screenshot({ path: SHOT + '/writing-page.png', fullPage: false })

/* ── 1b. 「统一展示方式」专项：外壳隐藏 + 主题生效 + 导航接管 ────────────── */
let skin = {}
if (writing) {
  skin = await writing.evaluate(() => {
    const disp = sel => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).display : 'missing'
    }
    const hero = document.querySelector('.hero, .overview-hero')
    const art = document.querySelector('.hero-art')
    const kicker = document.querySelector('.eyebrow')
    const h1 = hero?.querySelector('h1')
    const panel = document.querySelector('.panel, .overview-panel')
    return {
      sidebar: disp('.sidebar'),
      topbar: disp('.topbar'),
      footer: disp('.footer'),
      mainMargin: document.querySelector('.main-shell')
        ? getComputedStyle(document.querySelector('.main-shell')).marginLeft : 'missing',
      heroBg: hero ? getComputedStyle(hero).backgroundImage : 'missing',
      art: disp('.hero-art'),
      artImage: art ? getComputedStyle(art).backgroundImage : 'missing',
      h1Size: h1 ? getComputedStyle(h1).fontSize : 'missing',
      h1Spacing: h1 ? getComputedStyle(h1).letterSpacing : 'missing',
      kicker: (kicker?.innerText || '').trim(),
      panelRadius: panel ? getComputedStyle(panel).borderRadius : 'missing',
      uppercaseLabels: [...document.querySelectorAll('.section-kicker, .eyebrow, .overline')]
        .map(el => (el.innerText || '').trim())
        .filter(t => /^[A-Z][A-Z0-9 ·,.\-]{5,}$/.test(t)),
    }
  })
}
ok('独立站竖排侧栏已隐藏', skin.sidebar === 'none', skin.sidebar)
ok('独立站顶栏 / 页脚已隐藏', skin.topbar === 'none' && skin.footer === 'none',
  skin.topbar + ' / ' + skin.footer)
ok('主内容区不再为侧栏留白', skin.mainMargin === '0px', skin.mainMargin)
ok('hero 已统一为主站浅蓝渐变', /linear-gradient/.test(skin.heroBg || '') &&
  /237, 247, 255|220, 242, 252/.test(skin.heroBg || ''), (skin.heroBg || '').slice(0, 90))
ok('黄色纸飞机插画已移除', skin.art === 'none' || skin.artImage === 'none', skin.art)
ok('文艺大字已收敛为主站标题级', parseFloat(skin.h1Size) <= 25 && skin.h1Spacing !== '1px',
  skin.h1Size + ' / ' + skin.h1Spacing)
ok('卡片圆角对齐主站 18px', parseFloat(skin.panelRadius) >= 16, skin.panelRadius)
ok('英文大写装饰标签已中文化', (skin.uppercaseLabels || []).length === 0,
  JSON.stringify(skin.uppercaseLabels || []))
ok('kicker 为中文功能标签', /写作|练习|图表|议论文|记录/.test(skin.kicker || ''), skin.kicker)

/* 页签 → iframe 视图切换：iframe 必须常驻（不重载、不丢草稿），视图确实改变 */
await writing.evaluate(() => { window.__writingProbe = 'keep-alive' })
const before = await writing.evaluate(() => ({
  navActive: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('aria-label') || null,
  hasEditor: Boolean(document.querySelector('.essay-input')),
}))
await page.locator('.speaking-tabs button', { hasText: '写作精修' }).first().click()
await sleep(900)
const still = frameBy('/writing/index.html')
let after = {}
if (still) {
  after = await still.evaluate(() => ({
    probe: window.__writingProbe,
    navActive: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('aria-label') || null,
    hasEditor: Boolean(document.querySelector('.essay-input')),
    hasTopic: Boolean(document.querySelector('.topic-panel')),
  }))
}
ok('切页签不重建 iframe（草稿与状态保留）', still === writing && after.probe === 'keep-alive',
  JSON.stringify({ probe: after.probe, stillSame: still === writing }))
ok('导航桥接生效：切到「写作精修」', after.navActive === '写作精修', after.navActive)
ok('交接包原有编辑器与题目卡仍在（功能不变）', after.hasEditor && after.hasTopic,
  JSON.stringify({ hasEditor: after.hasEditor, hasTopic: after.hasTopic }))
ok('地址栏随页签同步', page.url().includes('view=practice'), page.url().slice(-60))

/* 再切到「练习记录」：导出 / 恢复备份等功能入口仍可用 */
await page.locator('.speaking-tabs button', { hasText: '练习记录' }).first().click()
await sleep(800)
const hist = await frameBy('/writing/index.html')?.evaluate(() => ({
  navActive: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('aria-label') || null,
  exportBtn: [...document.querySelectorAll('button')].some(b => /导出记录/.test(b.innerText || '')),
  restoreBtn: [...document.querySelectorAll('button')].some(b => /恢复备份/.test(b.innerText || '')),
})).catch(() => ({}))
ok('导航桥接生效：切到「练习记录」', hist.navActive === '练习记录', hist.navActive)
ok('导出 / 恢复备份功能未因隐藏侧栏丢失', hist.exportBtn && hist.restoreBtn,
  JSON.stringify(hist))
await page.screenshot({ path: SHOT + '/writing-unified.png', fullPage: false })

/* 回到默认视图，继续执行下面的既有动画 / API 验收 */
await page.goto(BASE + '/#/subject/writing', { waitUntil: 'networkidle' })
await sleep(1200)

/* 写作页切到「学伴互助」再切回来：iframe 只重建一次，页签行静止。 */
await page.locator('.speaking-tabs button', { hasText: '学伴互助' }).first().click()
await sleep(500)
const peersShell = await page.evaluate(() => ({
  tab: getComputedStyle(document.querySelector('.speaking-tabs')).animationName,
  stage: getComputedStyle(document.querySelector('.page-view .stage-body')).animationName,
  running: document.querySelector('.page-view').getAnimations({ subtree: true })
    .filter(a => a.playState === 'running' && a.animationName === 'hero-in').length,
}))
ok('写作页页签行静止', peersShell.tab === 'none', peersShell.tab)
ok('写作页切换恰好一层进场', peersShell.running === 1, 'running=' + peersShell.running)

/* ── 2. 工作区数据库 ───────────────────────────────────────────────────── */
const api = async (path, init = {}) => {
  const res = await page.request.fetch(BASE + path, {
    ...init,
    headers: { 'X-Speaking-Scope': 'user_writing_probe', ...(init.headers || {}) },
  })
  return { status: res.status(), body: await res.json().catch(() => null) }
}
const put = await api('/api/writing/workspace', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  data: JSON.stringify({ workspace: '{"probe":"writing-v4"}' }),
})
const get = await api('/api/writing/workspace')
ok('写作工作区 PUT 成功', put.status === 200 && put.body?.ok === true)
ok('写作工作区 GET 回读一致', get.body?.data === '{"probe":"writing-v4"}')
const other = await page.request.fetch(BASE + '/api/writing/workspace', {
  headers: { 'X-Speaking-Scope': 'another-user' },
}).then(r => r.json())
ok('写作工作区按账号隔离', other.data === null, JSON.stringify(other.data))
const status = await api('/api/writing/ai/status')
ok('AI 状态接口可用', status.status === 200 && status.body?.localEngine === true,
  'configured=' + status.body?.configured)
const chat = await api('/api/ai/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  data: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
})
ok('AI 未配置时返回结构化错误而非崩溃',
  chat.status === 503 && chat.body?.error?.code === 'AI_NOT_CONFIGURED', 'status=' + chat.status)

/* ── 3. 每日语料 / 词汇配色一致 ────────────────────────────────────────── */
async function heroOf(hash, needle, selectors) {
  await page.goto(BASE + '/#/' + hash, { waitUntil: 'networkidle' })
  await sleep(2200)
  const f = frameBy(needle)
  if (!f) return { missing: true }
  return f.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (!el) continue
      const cs = getComputedStyle(el)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        return { selector: sel, background: cs.backgroundImage, color: cs.color }
      }
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        return { selector: sel, background: cs.backgroundColor, color: cs.color }
      }
    }
    return { selector: null, background: 'none' }
  }, selectors)
}
const daily = await heroOf('subject/speaking?view=daily', '/speaking/shadow.html', ['.sh-hero', '.vc-hero', '.vc-front', 'header'])
const vocab = await heroOf('subject/speaking?view=vocab', '/vocab/vocab.html', ['.vc-hero', '.vc-front', '.hero', 'header'])
console.log('  语料 hero:', JSON.stringify(daily))
console.log('  词汇 hero:', JSON.stringify(vocab))
/* computed style 会把 hex 转成 rgb()：按色相判断，而不是比对字符串。
   青蓝 / 墨绿的特征是「蓝 > 红」且「蓝 - 绿 < 80」；紫 / 靛蓝则是蓝远高于绿。 */
function stops(gradient) {
  return [...(gradient || '').matchAll(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)]
    .map(([, r, g, b]) => ({ r: +r, g: +g, b: +b }))
}
const tealStops = gradient => {
  const list = stops(gradient)
  return list.length >= 2 && list.every(({ r, g, b }) => b > r && b - g < 80)
}
const purpleStop = gradient => stops(gradient).some(({ g, b }) => b - g > 80)
ok('语料 hero 为青蓝 / 墨绿渐变', /linear-gradient/.test(daily.background || '') && tealStops(daily.background))
ok('词汇 hero 为同一套青蓝 / 墨绿', /linear-gradient/.test(vocab.background || '') && tealStops(vocab.background))
ok('词汇 hero 已无紫色', !purpleStop(vocab.background || ''), (vocab.background || '').slice(0, 100))
await page.screenshot({ path: SHOT + '/vocab-tone.png', fullPage: false })
await page.goto(BASE + '/#/subject/speaking?view=daily', { waitUntil: 'networkidle' })
await sleep(1800)
await page.screenshot({ path: SHOT + '/daily-tone.png', fullPage: false })

/* ── 4. 全局 ───────────────────────────────────────────────────────────── */
const busy = await page.evaluate(() => [...document.querySelectorAll('body *')]
  .filter(el => el.children.length === 0 && /正在(读取|载入|加载|准备|打开)/.test(el.textContent || ''))
  .map(el => (el.textContent || '').trim()).slice(0, 5))
ok('主站无「正在读取/载入」可见提示', busy.length === 0, JSON.stringify(busy))
/* /api/social/challenge 的 403 是 demo 账号首次进入校园时的既有业务鉴权拒绝
   （已在上一版基线服务上 A/B 复现），不是资源加载失败，也不是本轮回归。 */
const KNOWN = /\/api\/social\/challenge.*403|403.*\/api\/social\/challenge/
const unexpected = badResponses.filter(line => !KNOWN.test(line))
const realErrors = errors.filter(line => !/403 \(Forbidden\)/.test(line))
ok('无意外的 4xx/5xx 请求', unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)))
ok('无 JS 运行时错误', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))

await browser.close()
const passed = checks.filter(([, v]) => v).length
console.log(`\n写作接入与配色验收：${passed} / ${checks.length} 项通过`)
process.exit(passed === checks.length ? 0 : 1)
