import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const executablePath = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4192/?demo=1'
const screenshots = process.env.SCREENSHOT_DIR || 'screenshots'
mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'})
const errors = []
page.on('pageerror', e => errors.push(e.message))
const email = 'qa-' + Date.now() + '@example.org'
const draft = 'Campus libraries give students a quiet place to read. Longer weekend opening hours would help students who work during the week.'
const home = () => page.locator('.sidebar .nav-item').filter({hasText: '学习首页'}).click()
async function enterAccount() {
  await page.getByPlaceholder('例如：Alex').fill('验收同学')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', {name: '进入学习首页'}).click()
  await page.waitForURL(/#\/home$/)
}
async function personal(label) {
  await page.locator('.sidebar .space-trigger').click()
  await page.getByRole('menuitem', {name: new RegExp(label)}).click()
}

try {
  await page.goto(base)
  await page.getByRole('heading', {name: '四科都在同一个站点'}).waitFor()
  await page.locator('.landing-actions').getByRole('button', {name: '注册'}).click()
  await enterAccount()
  await page.getByRole('heading', {name: '每日任务'}).waitFor()
  await page.getByText('还没有完成的练习', {exact: true}).waitFor()
  await page.screenshot({path: screenshots + '/01-home-new.png', fullPage:true})

  await page.getByRole('button', {name:'查看写作批改示例'}).click()
  await page.waitForURL(/#\/report\/sample-writing$/)
  await page.getByText('虚构作答示例', {exact:true}).waitFor()
  await page.getByRole('heading', {name:'升级版范文与二稿对比'}).waitFor()
  assert(await page.locator('.fb-revised').count() > 0)
  await page.screenshot({path: screenshots + '/02-writing-example.png', fullPage:true})
  await page.getByRole('button', {name:'返回学习首页'}).click()
  await page.getByRole('button', {name:'全部记录'}).click()
  await page.getByText('没有符合条件的记录', {exact:true}).waitFor()
  console.log('PASS 打开示例可查看逐句改写和范文，个人记录仍为空。')

  await home()
  await page.getByRole('button',{name:/开始今天的练习/}).click()
  await page.locator('.essay-box').fill(draft)
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByRole('button',{name:'稍后再写'}).click()
  await page.getByRole('button',{name:'继续',exact:true}).click()
  assert.equal(await page.locator('.essay-box').inputValue(),draft)
  console.log('PASS 首页恢复本人实际输入的作文草稿。')

  await home()
  await page.locator('.subject-card').filter({hasText:'阅读精读'}).click()
  await page.getByRole('button', {name:'开始篇章练习'}).click()
  await page.locator('.question input[type=radio]').first().check()
  await page.getByRole('button', {name:'提交并查看原文证据'}).click()
  await page.getByRole('heading', {name:'哪里需要改进，为什么'}).waitFor()
  const resultRoute = new URL(page.url()).hash
  assert.match(resultRoute, /^#\/report\/(rpt_|pending\?attempt=atm_)/)
  assert(await page.locator('.feedback-item').count()>0)
  await page.reload()
  await page.getByRole('heading', {name:'哪里需要改进，为什么'}).waitFor()
  await page.screenshot({path:screenshots+'/03-reading-report.png',fullPage:true})
  await personal('分数曲线')
  await page.getByRole('button',{name:'阅读正确数'}).click()
  await page.locator('svg.chart-svg circle').first().waitFor()
  await personal('错题本')
  await page.locator('.filter-bar select').nth(2).selectOption('pending')
  await page.locator('.feedback-item').first().waitFor()
  await personal('历史记录')
  const row = page.locator('table tbody tr').filter({hasText:'阅读篇章精练'})
  await row.first().waitFor()
  assert.equal(await row.count(),1)
  await row.getByRole('button',{name:'查看'}).click()
  await page.waitForURL(/#\/report\/rpt_/)
  await page.getByRole('heading', {name:'哪里需要改进，为什么'}).waitFor()
  await page.locator('.rec-card .btn-primary').first().click()
  await page.waitForURL(/retakeOf=/)
  console.log('PASS 阅读作答已判分，刷新可回看，并写入历史、曲线、错题和复练入口。')

  await home()
  await page.getByText('已完成，今天点亮啦',{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'退出登录',exact:true}).first().click()
  await page.locator('.landing-actions').getByRole('button',{name:'登录'}).click()
  await enterAccount()
  await page.getByRole('button',{name:'继续',exact:true}).click()
  assert.equal(await page.locator('.essay-box').inputValue(),draft)
  assert.deepEqual(errors,[])
  console.log('PASS 重新登录后仍可续写本人草稿，控制台无页面异常。')
} catch (error) {
  console.error(page.url(), error)
  await page.screenshot({path:screenshots+'/failure.png'}).catch(()=>{})
  process.exitCode=1
} finally { await browser.close() }

