/* 用 Node 22.13+ 运行。需要 playwright-core 和 Chromium（可设置 CHROMIUM_PATH）。
   默认启动使用临时 SQLite 的本地站点；E2E_BASE_URL 可指定另一个测试站点。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readdir, unlink, rmdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright-core')
const root = fileURLToPath(new URL('../', import.meta.url))
const screenshots = process.env.QA_SCREENSHOTS_DIR
let base = process.env.E2E_BASE_URL
let server, browser, directory, page
const errors = []

async function shot(page, filename) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, filename), animations: 'disabled' })
}

try {
  if (!base) {
    directory = await mkdtemp(path.join(tmpdir(), 'ielts-campus-ui-'))
    process.env.IELTS_DATA_DIR = directory
    const { createServer } = await import('vite')
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await server.listen()
    base = 'http://127.0.0.1:' + server.httpServer.address().port
  }
  const url = route => new URL('/?demo=1#/' + route, base).href
  const executablePath = process.env.CHROMIUM_PATH
  browser = await chromium.launch(executablePath ? { executablePath } :
    process.platform === 'win32' ? { channel: 'msedge' } : {})
  page = await browser.newPage({ viewport: { width: 1360, height: 840 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  const heading = name => page.locator('.content').getByRole('heading', { name, exact: true })
  const nav = page.getByRole('navigation', { name: '校园活动' })
  const tab = name => nav.getByRole('link', { name, exact: true })
  const active = name => nav.getByRole('link', { name, current: 'page', exact: true }).waitFor()

  await page.goto(url('auth'))
  await page.getByPlaceholder('例如：Alex').fill('校园体验')
  await page.getByPlaceholder('you@example.com').fill('campus-' + randomUUID() + '@example.org')
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForURL(/#\/home$/)
  await heading('每日任务').waitFor()
  assert.equal(await page.locator('.szu-home-clinic').count(), 0)
  assert.doesNotMatch(await page.locator('main').innerText(), /校园语言诊所|打开诊所|从口语模考开始/)
  /* 四科卡片 + 每日语料入口卡 = 5 张 */
  /* 四科 + 每日语料 + 词汇（词汇模块重新接入后新增一张入口卡片） */
  assert.equal(await page.locator('.subject-grid .subject-card').count(), 6)
  await shot(page, 'learning-home.png')
  await page.goto(url('campus'))
  await page.locator('.grow-card').waitFor()
  assert.equal(await nav.getByRole('link').count(), 4)
  assert.doesNotMatch(await nav.innerText(), /语言诊所|校园资料/)
  await page.locator('.sidebar .space-trigger').click()
  await page.locator('.sidebar .space-panel').getByRole('button',{name:/个人资料/}).click()
  await page.getByRole('button',{name:'校园资料',exact:true}).click()
  await heading('我的校园资料').waitFor()
  const nickname=page.getByRole('textbox',{name:'校园昵称'})
  assert.equal(await nickname.inputValue(),'校园体验')
  await shot(page,'profile-desktop.png')
  await nickname.fill('校园同行')
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/social/profile'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'加入校园',exact:true}).click()
  assert.equal((await saved).status(),200)
  await page.getByRole('button',{name:'保存资料',exact:true}).waitFor()
  await page.reload()
  await heading('我的校园资料').waitFor()
  assert.equal(await nickname.inputValue(),'校园同行')
  await page.goto(url('campus/rank'))
  await heading('深圳大学 · 本校周榜').waitFor()
  await tab('互助单').focus()
  await page.keyboard.press('Enter')
  await active('互助单')
  await page.goBack()
  await heading('深圳大学 · 本校周榜').waitFor()
  await page.goForward()
  await active('互助单')
  const activities = [
    ['互助单','校园互助大厅'], ['小队挑战','四人小队周挑战'],
    ['校级目标','我的四科练习证据'], ['我的积分','四科学习与互助积分']
  ]
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const [label, title] of activities) {
      await tab(label).click()
      await active(label)
      await heading(title).waitFor()
      for (const link of await nav.getByRole('link').all()) {
        const box = await link.boundingBox()
        assert(box && box.x >= 0 && box.x + box.width <= width + 1, label + ' 标签超出视口')
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ' 页面横向溢出')
    }
    await shot(page, 'campus-nav-' + width + '.png')
  }
  await page.goto(url('campus/camp'))
  await active('互助单')
  await page.goto(url('campus/verify'))
  await heading('我的校园资料').waitFor()
  await page.goto(url('campus/base'))
  await page.locator('.grow-card').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS 学习首页、昵称入驻与刷新、键盘切换、前进后退、营地养成、排行榜及校园活动、旧链接、390px 和 320px 手机导航')
} catch (error) {
  if (page) console.error('浏览器位置', page.url(), (await page.locator('body').innerText()).slice(0, 450), errors)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  if (directory) {
    for (const file of await readdir(directory)) await unlink(path.join(directory, file))
    await rmdir(directory)
  }
}

