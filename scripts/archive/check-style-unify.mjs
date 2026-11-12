/* 全项目「展示方式统一」审查。
 *
 * 用户反复强调风格统一，且明确要求不能「指一个改一个」。本脚本遍历四科页面，
 * 检查它们是否共用同一套展示语言：钴蓝科目横幅、横向功能页签、主内容区一层进场、
 * 内嵌模块无独立站外壳（竖排侧栏 / 顶栏 / 品牌 / 页脚）、无可见「正在…」等待文案、
 * 无独立站的大字文艺 hero 与英文大写装饰标签。
 *
 * 运行：CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4295 node scripts/check-style-unify.mjs
 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4295').replace(/\/$/, '')
const checks = []
const ok = (label, cond, extra = '') => {
  checks.push([label, Boolean(cond)])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => {
  localStorage.setItem('ielts_coach_mode', 'demo')
  localStorage.setItem('ielts_coach_demo_user', 'user_style_probe')
  localStorage.setItem('ielts_coach_demo_accounts', JSON.stringify([
    { userId: 'user_style_probe', email: 'style@probe.local', nickname: '风格探针' },
  ]))
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

const SUBJECTS = [
  ['listening', '听力精练', 'subject/listening'],
  ['speaking', '口语陪练', 'subject/speaking'],
  ['reading', '阅读精读', 'subject/reading'],
  ['writing', '写作批改', 'subject/writing'],
]

for (const [key, name, hash] of SUBJECTS) {
  await page.goto(BASE + '/#/' + hash, { waitUntil: 'networkidle' })
  /* 冷启动时首屏 bundle 可能还没挂载，等横幅真正出现再采样，避免偶发误报。 */
  await page.locator('.subject-hero').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})
  await sleep(900)

  const shell = await page.evaluate(() => {
    const hero = document.querySelector('.subject-hero')
    const tabs = document.querySelector('.speaking-tabs, .subject-tools')
    const tabLabels = tabs ? [...tabs.querySelectorAll('button')].map(b => b.innerText.trim()) : []
    const heroBg = hero ? getComputedStyle(hero).backgroundColor : 'missing'
    const heroRect = hero ? { x: Math.round(hero.getBoundingClientRect().x), y: Math.round(hero.getBoundingClientRect().y), h: Math.round(hero.getBoundingClientRect().height) } : null
    const stage = document.querySelector('.page-view .stage-body')
    const busy = [...document.querySelectorAll('body *')]
      .filter(el => el.children.length === 0 && /正在(读取|载入|加载|准备|打开)/.test(el.textContent || ''))
      .map(el => (el.textContent || '').trim()).slice(0, 4)
    return { hasHero: Boolean(hero), heroBg, heroRect, hasTabs: Boolean(tabs), tabLabels,
      stageAnim: stage ? getComputedStyle(stage).animationName : 'missing', busy }
  })

  ok(`${name}：有钴蓝科目横幅`, shell.hasHero && /rgb\((2[0-9]{2}|1[0-9]{2}), (2[0-9]{2}|1[0-9]{2}), (2[0-9]{2}|1[0-9]{2})\)/.test(shell.heroBg), shell.heroBg)
  ok(`${name}：横幅位置一致（同一 x / y）`, shell.heroRect?.x === 266 && shell.heroRect?.y === 105, JSON.stringify(shell.heroRect))
  ok(`${name}：有横向功能页签`, shell.hasTabs && shell.tabLabels.length >= 2, JSON.stringify(shell.tabLabels))
  ok(`${name}：主内容区一层进场`, shell.stageAnim === 'hero-in' || shell.stageAnim === 'none', shell.stageAnim)
  ok(`${name}：无可见「正在…」提示`, shell.busy.length === 0, JSON.stringify(shell.busy))

  /* 内嵌模块：逐个 frame 检查有没有独立站外壳残留 */
  const frames = page.frames().filter(f => f !== page.mainFrame())
  let shellLeft = []
  for (const f of frames) {
    const d = await f.evaluate(() => {
      /* 只算「真实可见」：元素自身 display 不为 none、且父链上没有 display:none
         （例如 .brand 位于已隐藏的 .sidebar 内，本身仍报 flex，但不该算残留）。 */
      const visible = sel => {
        const el = document.querySelector(sel)
        if (!el) return false
        if (getComputedStyle(el).display === 'none') return false
        return el.getClientRects().length > 0 && el.getBoundingClientRect().height > 0
      }
      return {
        url: location.pathname,
        sidebar: visible('.sidebar'),
        topbar: visible('.topbar'),
        footer: visible('.footer'),
        brand: visible('.brand'),
      }
    }).catch(() => null)
    if (!d) continue
    const leaked = ['.sidebar', '.topbar', '.footer', '.brand'].filter((sel, i) =>
      [d.sidebar, d.topbar, d.footer, d.brand][i] === true)
    if (leaked.length) shellLeft.push(d.url + ': ' + leaked.join(','))
  }
  ok(`${name}：内嵌模块无独立站外壳残留`, shellLeft.length === 0, JSON.stringify(shellLeft))
}

/* 写作模块专项：确认「功能不变，统一展示方式」的核心契约 */
/* 用 domcontentloaded + 等 iframe 就绪，不用 networkidle：主站会有校园/学伴的
   背景请求，网络永远到不了 idle，等它只会把机器负载误判成产品问题。 */
await page.goto(BASE + '/#/subject/writing', { waitUntil: 'domcontentloaded' })
await page.locator('iframe.writing-frame').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {})
await sleep(1800)
const wf = page.frames().find(f => f.url().includes('/writing/index.html'))
const writing = await wf.evaluate(() => {
  const hero = document.querySelector('.hero, .overview-hero')
  return {
    theme: [...document.styleSheets].some(s => (s.href || '').includes('writing-theme.css')),
    heroBg: hero ? getComputedStyle(hero).backgroundImage : 'missing',
    navInDom: document.querySelectorAll('.nav-item').length,
    uppercase: [...document.querySelectorAll('.section-kicker, .eyebrow, .overline')]
      .map(e => (e.innerText || '').trim()).filter(t => /^[A-Z][A-Z0-9 ·,.\-]{5,}$/.test(t)),
  }
}).catch(() => ({}))
ok('写作：统一主题样式已加载', writing.theme === true)
ok('写作：hero 为主站浅蓝渐变', /237, 247, 255|220, 242, 252/.test(writing.heroBg || ''))
ok('写作：原导航仍在 DOM（功能未删除，只是上移展示）', (writing.navInDom || 0) >= 5, 'nav-item=' + writing.navInDom)
ok('写作：无英文大写装饰标签', (writing.uppercase || []).length === 0, JSON.stringify(writing.uppercase))

ok('无 JS 运行时错误', errors.length === 0, JSON.stringify(errors.slice(0, 3)))

await browser.close()
const passed = checks.filter(([, v]) => v).length
console.log(`\n全项目展示方式统一审查：${passed} / ${checks.length} 项通过`)
process.exit(passed === checks.length ? 0 : 1)
