/** Real UI + SQLite audit. Optional BASE_URL skips the isolated build/API bridge. */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = fs.mkdtempSync(path.join(process.env.QA_OUTPUT_DIR || os.tmpdir(), 'ielts-vocabulary-audit-'))
const base = (process.env.BASE_URL || 'https://vocabulary.test').replace(/\/$/, '')
const result = { checks: [], errors: [], failedRequests: [], screenshots: [], output: out }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) })
let bindings
let dist
let speakingApi
if (!process.env.BASE_URL) {
  const { build } = await import('vite')
  dist = path.join(out, 'dist')
  await build({ root, logLevel: 'error', build: { outDir: dist } })
  ;({ speakingApi } = await import(pathToFileURL(path.join(root, 'scripts/speaking-api.mjs'))))
  const { openLocalBindings } = await import(pathToFileURL(path.join(root, 'modules/speaking/scripts/local-bindings.mjs')))
  bindings = openLocalBindings(path.join(out, 'database'), { campus: true })
}
function check(ok, label) { assert(ok, label); result.checks.push(label); console.log('PASS ' + label) }
async function bridge(page) {
  page.on('pageerror', error => result.errors.push(error.message))
  page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }))
  if (!bindings) return
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== base) return route.abort()
    if (url.pathname.startsWith('/api/')) {
      const response = await speakingApi(new Request(url, { method: req.method(), headers: { ...await req.allHeaders(), origin: url.origin }, body: req.postDataBuffer() ?? undefined }), bindings)
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname)
    return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' })
  })
}
async function at(page, route) { await page.evaluate(route => { location.hash = '#/' + route }, route) }
async function vocab(page) {
  const frame = page.frameLocator('iframe[title="雅思高频词库"]')
  await frame.locator('.vc-hero').waitFor()
  await page.locator('.vocab-frame.is-ready').waitFor()
  return frame
}
async function snapshot(page, filename) {
  const output = path.join(out, filename)
  await page.screenshot({ path: output })
  result.screenshots.push(output)
}
async function state(page) {
  return page.evaluate(async () => {
    const scope = new URL(document.querySelector('iframe[title="雅思高频词库"]').src).searchParams.get('scope')
    const response = await fetch('/api/daily/vocab', { headers: { 'X-Speaking-Scope': scope } })
    return { status: response.status, body: await response.json() }
  })
}
let learnedId, localKey, learnedCard, userId
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await bridge(page)
  await page.goto(base + '/?demo=1#/auth')
  await page.getByPlaceholder('例如：Alex').fill('词汇验收')
  await page.getByPlaceholder('you@example.com').fill('vocabulary-' + Date.now() + '@example.org')
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForURL(/#\/home/)
  await page.locator('#boot').waitFor({ state: 'detached' })
  await page.locator('.vocab-subject-card').click()
  let frame = await vocab(page)
  check(await page.locator('.vocabulary-page').count() === 1, '首页词汇卡进入独立词汇页')
  check(await page.locator('.learning-tool-nav .nav-item.active').getAttribute('aria-label') === '词汇积累', '学习工具侧栏正确选中词汇积累')
  userId = await page.evaluate(() => localStorage.getItem('ielts_coach_demo_user'))
  const scope = await page.locator('.vocab-frame').evaluate(el => new URL(el.src).searchParams.get('scope'))
  check(scope === userId, '独立词汇 iframe 使用当前账号身份')
  localKey = 'speakloop.vocab.host:' + encodeURIComponent(userId)
  const learnedWord = await frame.locator('.vc-front h2').innerText()
  await frame.locator('.vc-reveal [data-act="flip"]').click()
  await frame.locator('[data-act="grade"][data-q="2"]').click()
  const local = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), localKey)
  learnedId = Object.keys(local.cards).find(id => local.cards[id].history?.length)
  learnedCard = local.cards[learnedId]
  check(!!learnedId && learnedCard.history.length === 1, '通过翻卡和记住了实际记录一个单词：' + learnedWord)
  // Navigate immediately, before the host queue's 100 ms write debounce.
  await page.getByRole('button', { name: '口语陪练', exact: true }).first().click()
  await page.locator('.subject-hero').waitFor()
  await page.locator('iframe[title="口语陪练"].is-ready').waitFor()
  check(await page.locator('.speaking-workspace').getByRole('button', { name: /词汇/ }).count() === 0, '口语一级和二级菜单不再有词汇入口')
  await page.getByRole('button', { name: '词汇积累', exact: true }).click()
  frame = await vocab(page)
  await page.waitForFunction(({ localKey, learnedId }) => JSON.parse(localStorage.getItem(localKey) || '{}').cards?.[learnedId]?.history?.length === 1, { localKey, learnedId })
  check((await frame.locator('.vc-hero h1').innerText()).includes('1'), '立即切科目后返回仍显示今日学习 1 词')
  await page.waitForFunction(async ({ learnedId }) => {
    const scope = new URL(document.querySelector('.vocab-frame').src).searchParams.get('scope')
    const response = await fetch('/api/daily/vocab', { headers: { 'X-Speaking-Scope': scope } })
    return (await response.json()).data?.cards?.[learnedId]?.history?.length === 1
  }, { learnedId })
  let cloud = await state(page)
  check(cloud.status === 200 && cloud.body.data.cards[learnedId].history.length === 1, '切科目卸载 iframe 后真实数据库已写入学习记录')
  await at(page, 'subject/speaking?view=vocab')
  frame = await vocab(page)
  check(await page.locator('.vocabulary-page').count() === 1 && (await frame.locator('.vc-hero h1').innerText()).includes('1'), '旧口语词汇链接映射到同一个独立页面与学习进度')
  await page.reload()
  frame = await vocab(page)
  check((await frame.locator('.vc-hero h1').innerText()).includes('1'), '旧链接刷新后恢复同账号学习进度')
  check(JSON.stringify((await state(page)).body.data.cards[learnedId]) === JSON.stringify(learnedCard), '刷新不会覆盖或重复写入单词历史')
  await page.evaluate(key => { localStorage.removeItem(key); localStorage.removeItem(key + ':pending') }, localKey)
  await page.reload()
  frame = await vocab(page)
  await page.waitForFunction(({ localKey, learnedId }) => JSON.parse(localStorage.getItem(localKey) || '{}').cards?.[learnedId]?.history?.length === 1, { localKey, learnedId })
  check((await frame.locator('.vc-hero h1').innerText()).includes('1'), '删除本机词汇缓存后可从账号数据库恢复')
  await snapshot(page, 'vocabulary-desktop.png')
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await at(page, 'subject/speaking')
    await page.locator('.subject-hero').waitFor()
    await page.locator('iframe[title="口语陪练"].is-ready').waitFor()
    if (await page.getByRole('button', { name: '打开菜单', exact: true }).isVisible()) await page.getByRole('button', { name: '打开菜单', exact: true }).click()
    await page.getByRole('button', { name: '词汇积累', exact: true }).click()
    frame = await vocab(page)
    await page.waitForTimeout(700)
    check(!await page.locator('.app-shell').evaluate(el => el.classList.contains('menu-open')), width + 'px 汉堡菜单进入词汇后自动关闭')
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + 'px 主站没有横向溢出')
    await snapshot(page, 'vocabulary-' + width + '.png')
    const overflow = await frame.locator('html').evaluate(el => ({ width: innerWidth, actual: el.scrollWidth,
      elements: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 20).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })) }))
    if (overflow.actual > overflow.width) result.overflow = overflow
    check(overflow.actual <= overflow.width, width + 'px 词汇模块没有横向溢出')
    check((await frame.locator('.vc-hero h1').innerText()).includes('1'), width + 'px 词汇进度一致且非空白')
    await frame.locator('.vc-reveal [data-act="flip"]').click()
    const choices = frame.locator('.vc-grades.on [data-act="grade"]')
    check(await choices.count() === 4 && await choices.first().isVisible(), width + 'px 翻面后四档记忆按钮可操作')
    check(await frame.locator('.vc-back').evaluate(el => el.getBoundingClientRect().right <= innerWidth), width + 'px 翻卡背面完整落在视口内')
    if (width <= 390) {
      await choices.first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(700)
      await snapshot(page, 'vocabulary-flipped-' + width + '.png')
    }
    await frame.locator('.vc-card').click()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await at(page, 'home')
  await page.locator('.vocab-subject-card').click()
  frame = await vocab(page)
  check((await frame.locator('.vc-hero h1').innerText()).includes('1'), '首页再次进入和侧栏、直链共享同一份进度')
  check(result.errors.length === 0, '浏览器控制台无 JavaScript 错误')
  check(!result.failedRequests.some(request => request.url.includes('/api/')), '持久化与读取接口没有取消或失败请求')
  result.learned = { userId, learnedId, learnedCard }
  result.passed = true
} catch (error) {
  result.passed = false
  result.failure = error.stack
  throw error
} finally {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
  console.log('RESULT ' + path.join(out, 'result.json'))
  await browser.close()
  bindings?.close()
}
