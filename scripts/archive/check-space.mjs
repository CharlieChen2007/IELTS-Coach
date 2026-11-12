/* 【历史脚本 · 已废弃，不再计入本轮验收门禁】
   验收的是早期顶栏（.top-user / .btn-signout / .topbar h2）与四科 .subj-row 列表结构，
   这些类名与交互早已改版，脚本运行会因找不到元素而超时；首页入口也已从 4 张变为 6 张。
   个人空间弹层、侧栏、科目页、手机抽屉等当前结构由以下脚本覆盖：
     verify.mjs（120 项）、check-campus.mjs、check-layout.mjs、check-anim.mjs。
   保留本文件仅作历史判据存档，请勿作为回归门禁。
   原用途：个人空间弹层 / 顶栏退出 / 四科板块入口与科目页 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/?demo=1'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })

async function login(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  // 落地页 → 登录页：?demo=1 会被落地页拦截，先进登录路由再切演示模式
  const demoInput = page.locator('input[placeholder="例如：Alex"]')
  if (await demoInput.count() === 0) {
    await page.goto(BASE.replace('?demo=1', '') + '#/auth?mode=signin', { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const demoTab = page.getByRole('button', { name: '本机体验' })
    if (await demoTab.count()) await demoTab.first().click()
    await page.waitForTimeout(300)
  }
  await page.locator('input[placeholder="例如：Alex"]').fill('验收同学')
  await page.locator('input[placeholder="you@example.com"]').fill('space@example.com')
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForTimeout(600)
  return page
}

// ---------------- 桌面 ----------------
const page = await login(1440, 900)
await page.screenshot({ path: 'screenshots/20-home-subjects.png' })

// 1. 左下角个人空间按钮存在，且原四个入口不再平铺在侧栏
check('侧栏有「个人空间」按钮', await page.locator('.space-trigger').count() === 1)
const flatOld = await page.locator('.sidebar .nav-item', { hasText: '历史记录' }).count()
check('侧栏不再平铺历史/曲线/错题/目标', flatOld === 0, `残留 ${flatOld}`)

// 2. 点击后在上方弹出小方框，且包含四项
const trigger = await page.locator('.space-trigger').boundingBox()
await page.locator('.space-trigger').click()
await page.waitForTimeout(260)
const panel = page.locator('.space-panel').first()
check('弹层已出现', await panel.isVisible())
const pbox = await panel.boundingBox()
check('弹层在按钮正上方', pbox && trigger && pbox.y + pbox.height <= trigger.y + 1, `panelBottom=${Math.round((pbox.y + pbox.height))} btnTop=${Math.round(trigger.y)}`)
check('弹层水平与按钮对齐', pbox && trigger && Math.abs(pbox.x - trigger.x) <= 2 && Math.abs(pbox.width - trigger.width) <= 2, `panel=${Math.round(pbox.x)}/${Math.round(pbox.width)} btn=${Math.round(trigger.x)}/${Math.round(trigger.width)}`)
const items = await page.locator('.space-panel .space-item').allInnerTexts()
check('弹层内是四项内容', items.length === 4, items.join(' | '))
check('弹层完全在视口内', pbox && pbox.y >= 0 && pbox.y + pbox.height <= 900)
await page.screenshot({ path: 'screenshots/21-space-panel.png' })

// 3. 点击空白关闭
await page.mouse.click(720, 400)
await page.waitForTimeout(220)
check('点击外部关闭弹层', await page.locator('.space-panel').count() === 0)

// 4. 顶栏：退出登录在头像右侧，头像比原来更靠左
const topUser = await page.locator('.top-user').boundingBox()
const avatar = await page.locator('.top-user .avatar').boundingBox()
const signout = await page.locator('.btn-signout').boundingBox()
const topbar = await page.locator('.topbar').boundingBox()
check('退出登录位于头像右侧', signout && avatar && signout.x > avatar.x + avatar.width, `avatarRight=${Math.round(avatar.x + avatar.width)} signoutX=${Math.round(signout.x)}`)
const rightGapOld = Math.round(1440 - 42 - (avatar.x + avatar.width + 8 + 78)) // 估算：原来头像就是最右
check('顶栏右侧留白合理（头像左移）', topbar && signout.x + signout.width <= 1440 - 20, `signoutRight=${Math.round(signout.x + signout.width)}`)
await page.screenshot({ path: 'screenshots/22-topbar-signout.png', clip: { x: 900, y: 0, width: 540, height: 90 } })

// 5. 四个板块入口 → 点进科目页
const cards = await page.locator('.subject-card').count()
check('首页四个板块入口', cards === 4, `${cards} 个`)
const labels = await page.locator('.subject-card-title h4').allInnerTexts()
check('四个板块名称', labels.length === 4, labels.join(' / '))

const subjects = ['listening', 'speaking', 'reading', 'writing']
for (const key of subjects) {
  await page.goto(BASE.replace('?demo=1', '') + `#/subject/${key}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(220)
  const h1 = await page.locator('.subject-hero h1').innerText().catch(() => '')
  const tabs = await page.locator('.subject-tabs button').count()
  const rows = await page.locator('.subj-row').count()
  check(`科目页 ${key} 打开`, Boolean(h1) && tabs === 0, `标题=${h1} 标签=${tabs} 题目=${rows}`)
  if (key === 'listening') await page.screenshot({ path: 'screenshots/23-subject-listening.png' })
}
check('科目页顶部标题联动', await page.locator('.topbar h2').innerText() === '写作批改', await page.locator('.topbar h2').innerText())

// 6. 从列表进入练习（接口连通）
await page.locator('.subj-row').first().click()
await page.waitForTimeout(400)
check('可进入练习页', page.url().includes('#/practice/'), page.url())

// ---------------- 手机 ----------------
const m = await login(390, 844)
const tabbar = await m.locator('.tabbar').boundingBox()
check('手机底部标签栏显示', Boolean(tabbar) && tabbar.y > 700, tabbar ? `y=${Math.round(tabbar.y)}` : 'none')
const tabItems = await m.locator('.tabbar-item').allInnerTexts()
check('标签栏 4 科 + 我的', tabItems.length === 5, tabItems.join(' | '))
await m.screenshot({ path: 'screenshots/24-mobile-tabbar.png' })
await m.locator('.tabbar-item').last().click()
await m.waitForTimeout(320)
check('手机打开个人空间抽屉', await m.locator('.space-sheet').isVisible())
await m.screenshot({ path: 'screenshots/25-mobile-space.png' })
await m.locator('.space-sheet .space-item').first().click()
await m.waitForTimeout(400)
check('抽屉可跳转到个人目标', m.url().includes('#/profile'), m.url())

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)
