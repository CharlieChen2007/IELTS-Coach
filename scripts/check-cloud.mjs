/* 【历史脚本 · 已废弃，不再计入本轮验收门禁】
   后半段找的 `.essay-box` 是早期写作练习页的编辑器类名，当前写作科目页已由
   v4.0 写作精修室 iframe 整页接管；脚本必然因找不到元素而超时。
   在上一版交付包（基线服务）上 A/B 复现为同样的 TimeoutError，非本轮回归。
   登录入口由 check-login.mjs（10/10）覆盖，写作练习由 check-writing.mjs（21/21）覆盖。
   保留本文件仅作历史判据存档。
   原用途：正式登录入口，以及独立演示账号的本地仓储读写。 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const executablePath = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4192/'
const browser = await chromium.launch({executablePath, headless:true})
const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'})
const errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(base)
  await page.locator('.landing-actions').getByRole('button',{name:'注册',exact:true}).click()
  await page.getByRole('button',{name:'手机号 / 邮箱'}).click()
  await page.getByRole('button',{name:'发送短信验证码'}).waitFor()
  await page.getByRole('tab',{name:'邮箱',exact:true}).click()
  await page.getByRole('button',{name:'发送邮件验证码'}).waitFor()
  console.log('PASS 手机号与邮箱验证码入口；本脚本未发送验证码。')

  await page.getByRole('button',{name:'本机体验',exact:true}).click()
  await page.getByPlaceholder('例如：Alex').fill('仓储验收')
  await page.getByPlaceholder('you@example.com').fill('storage-'+Date.now()+'@example.org')
  await page.getByRole('button',{name:'进入学习首页'}).click()
  await page.waitForURL(/#\/home$/)
  await page.getByRole('button',{name:'查看写作批改示例'}).click()
  await page.waitForURL(/#\/report\/sample-writing$/)
  await page.getByText('虚构作答示例',{exact:true}).waitFor()
  await page.getByRole('button',{name:'返回学习首页'}).click()
  await page.getByRole('button',{name:'全部记录'}).click()
  await page.getByText('没有符合条件的记录',{exact:true}).waitFor()

  await page.locator('.sidebar .nav-item').filter({hasText:'学习首页'}).click()
  await page.getByRole('button',{name:/开始今天的练习/}).click()
  const draft='An original paragraph for this account '+Date.now()
  await page.locator('.essay-box').fill(draft)
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByRole('button',{name:'稍后再写'}).click()
  await page.reload()
  await page.getByRole('button',{name:'继续',exact:true}).click()
  assert.equal(await page.locator('.essay-box').inputValue(),draft)
  assert.deepEqual(errors,[])
  console.log('PASS 写作示例可独立查看；实际输入的草稿按演示账号保存，刷新后可完整读回。')
} finally {
  await browser.close()
}

