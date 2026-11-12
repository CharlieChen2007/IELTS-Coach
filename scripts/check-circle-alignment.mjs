/** Score-ring and icon alignment audit against real UI, APIs and SQLite. */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = fs.mkdtempSync(path.join(process.env.QA_OUTPUT_DIR || os.tmpdir(), 'ielts-circle-audit-'))
const base = (process.env.BASE_URL || 'https://circle.test').replace(/\/$/, '')
const result = { checks: [], measurements: [], errors: [], screenshots: [], output: out }
let bindings, dist, speakingApi
if (!process.env.BASE_URL) {
  const { build } = await import('vite')
  dist = path.join(out, 'dist')
  await build({ root, logLevel: 'error', build: { outDir: dist } })
  ;({ speakingApi } = await import(pathToFileURL(path.join(root, 'scripts/speaking-api.mjs'))))
  const { openLocalBindings } = await import(pathToFileURL(path.join(root, 'modules/speaking/scripts/local-bindings.mjs')))
  bindings = openLocalBindings(path.join(out, 'database'), { campus: true })
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) })
function check(ok, label) { assert(ok, label); result.checks.push(label); console.log('PASS ' + label) }
async function bridge(page) {
  page.on('pageerror', error => result.errors.push(error.message))
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
async function screenshot(page, name) { const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file) }
function measureBadges() {
  const selectors = '.avatar,.avatar.sm,.tabbar-avatar,.badge-dot,.camp-tile-dot,.rank-no,.buddy-avatar,.buddy-inbox-avatar,.ticket-avatar,.daily-check,.brand-mark,.nav-subject-icon,.subject-hero-icon,.camp-tile-ico,.qno,.sec-no,.match-q,.q-num,.q-chip,.journey-step>span,.checklist li>span,.question-bank-note-mark,.me-avatar,.tb-avatar,.panel-icon,.part-icon'
  const rows = []
  for (const node of document.querySelectorAll(selectors)) {
    const box = node.getBoundingClientRect()
    if (!box.width || !box.height || getComputedStyle(node).visibility === 'hidden') continue
    const svg = node.querySelector(':scope>svg,:scope>.avatar-icon>svg')
    let content
    if (svg) content = svg.getBoundingClientRect()
    else if (node.childNodes.length === 1 && node.firstChild.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const range = document.createRange(); range.selectNodeContents(node); content = range.getBoundingClientRect()
    }
    if (!content || !content.width || !content.height) continue
    rows.push({ className: String(node.className), text: node.textContent.trim(), width: box.width, height: box.height,
      dx: content.x + content.width / 2 - (box.x + box.width / 2), dy: content.y + content.height / 2 - (box.y + box.height / 2) })
  }
  return rows
}
async function inspectBadges(page, label) {
  const rows = await page.evaluate(measureBadges)
  result.measurements.push({ label, badges: rows })
  const bad = rows.filter(row => Math.abs(row.dx) > 2.1 || Math.abs(row.dy) > 2.6)
  check(!bad.length, label + ' 数字/头像/图标居中 (' + rows.length + ') ' + (bad.length ? JSON.stringify(bad) : ''))
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage(); page.setDefaultTimeout(20000); await bridge(page)
  await page.goto(base + '/?demo=1#/auth')
  await page.getByPlaceholder('例如：Alex').fill('圆环验收')
  await page.getByPlaceholder('you@example.com').fill('circle-' + Date.now() + '@example.org')
  await page.getByRole('button', { name: '进入学习首页' }).click()
  await page.waitForURL(/#\/home/); await page.locator('#boot').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '进入演示模式', exact: true }).click()
  await page.getByRole('button', { name: '退出演示模式', exact: true }).waitFor()
  const storage = await context.storageState()
  await context.close()
  for (const [physicalWidth, scale] of [[1440, 1], [1440, 1.25], [1440, 1.5], [390, 1], [320, 1]]) {
    const width = Math.round(physicalWidth / scale), label = physicalWidth + 'px-' + scale * 100 + '%'
    const ctx = await browser.newContext({ storageState: storage, viewport: { width, height: Math.round(1000 / scale) }, deviceScaleFactor: scale })
    // Showcase identity is stored in sessionStorage, as in a re-opened demo tab.
    await ctx.addInitScript(() => { const user = localStorage.getItem('ielts_coach_demo_user'); if (user) sessionStorage.setItem('ielts_showcase_owner', user) })
    const p = await ctx.newPage(); p.setDefaultTimeout(20000); await bridge(p)
    await p.goto(base + '/?demo=1#/subject/listening?view=practice&section=prac_lsn_s1')
    const frame = p.frameLocator('iframe[title="听力练习台"]')
    await frame.locator('#scoreRing').waitFor({ state: 'visible' }); await p.waitForTimeout(800)
    for (const [n, total] of [['5', '/7'], ['0', '/7'], ['10', '/10']]) {
      const ring = await frame.locator('#scoreRing').evaluate((node, values) => {
        node.querySelector('span').textContent = values[0]; node.querySelector('small').textContent = values[1]
        const b = node.getBoundingClientRect(), pieces = [...node.children].map(x => x.getBoundingClientRect())
        const left = Math.min(...pieces.map(x => x.left)), right = Math.max(...pieces.map(x => x.right)), top = Math.min(...pieces.map(x => x.top)), bottom = Math.max(...pieces.map(x => x.bottom))
        const probes = [...node.children].map(x => { const probe = document.createElement('i'); probe.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline'; x.append(probe); const baseline = probe.getBoundingClientRect().top; probe.remove(); return baseline })
        return { width: b.width, height: b.height, dx: (left + right - b.left - b.right) / 2, dy: (top + bottom - b.top - b.bottom) / 2, baselineDelta: Math.abs(probes[0] - probes[1]), background: getComputedStyle(node).backgroundImage }
      }, [n, total])
      result.measurements.push({ label, score: n + total, ring })
      check(Math.abs(ring.width - 82) < .2 && Math.abs(ring.height - 82) < .2, label + ' ' + n + total + ' 仍为82px圆环')
      check(Math.abs(ring.dx) <= .55 && Math.abs(ring.dy) <= .55, label + ' ' + n + total + ' 组合位于圆心 ' + JSON.stringify({ dx: ring.dx, dy: ring.dy }))
      check(ring.baselineDelta <= .55, label + ' ' + n + total + ' 分子分母保持共基线')
    }
    await frame.locator('#scoreRing').evaluate(node => { node.querySelector('span').textContent = '5'; node.querySelector('small').textContent = '/7' })
    await frame.locator('#scoreRing').scrollIntoViewIfNeeded(); await p.waitForTimeout(500)
    await screenshot(p, 'listening-' + label.replace('%', ''))
    await inspectBadges(p, label + ' listening host')
    const innerBadges = await frame.locator('html').evaluate(measureBadges)
    result.measurements.push({ label: label + ' listening module', badges: innerBadges })
    check(innerBadges.every(row => Math.abs(row.dx) < 2.1 && Math.abs(row.dy) < 2.6), label + ' 听力题号/播放图标居中')
    if (scale === 1 && physicalWidth === 1440) {
      await at(p, 'report/sample-writing'); await p.locator('.score-ring').waitFor(); await p.waitForTimeout(700)
      const report = await p.locator('.score-ring').evaluate(node => { const b = node.getBoundingClientRect(), c = node.firstElementChild.getBoundingClientRect(); const score = document.createRange(); score.selectNodeContents(node.querySelector('b')); const s = score.getBoundingClientRect(); return { dx: c.x + c.width / 2 - b.x - b.width / 2, dy: c.y + c.height / 2 - b.y - b.height / 2, scoreDx: s.x + s.width / 2 - b.x - b.width / 2 } })
      result.measurements.push({ label: 'host report ring', report })
      check(Math.abs(report.dx) < .55 && Math.abs(report.dy) < .55 && Math.abs(report.scoreDx) < 1.1, '主站报告圆环标签组合和分数均居中')
      await screenshot(p, 'host-report')
      for (const route of ['home', 'subject/speaking', 'subject/reading', 'subject/writing', 'campus/partner', 'campus/help', 'campus/rank']) {
        await at(p, route); await p.waitForTimeout(1000); await inspectBadges(p, route)
        const module = p.frames().find(f => /\/(speaking|reading|writing)\//.test(f.url()))
        if (module) { await module.waitForLoadState('domcontentloaded'); const badges = await module.evaluate(measureBadges); result.measurements.push({ label: route + ' module', badges }); check(badges.every(row => Math.abs(row.dx) < 2.1 && Math.abs(row.dy) < 2.6), route + ' 模块内同类标识居中 (' + badges.length + ')') }
      }
    }
    if (scale === 1) {
      await at(p, 'subject/reading?view=practice&passage=p1')
      const reading = p.frameLocator('iframe[title="阅读精读"]')
      await reading.locator('.q-num').first().waitFor({ state: 'attached' })
      if (await reading.getByRole('button', { name: '做题', exact: true }).isVisible()) await reading.getByRole('button', { name: '做题', exact: true }).click()
      await reading.locator('.q-num').first().waitFor(); await p.waitForTimeout(800)
      const readingNumbers = await reading.locator('html').evaluate(measureBadges)
      result.measurements.push({ label: label + ' reading practice', badges: readingNumbers })
      check(readingNumbers.length > 0 && readingNumbers.every(row => Math.abs(row.dx) < 2.1 && Math.abs(row.dy) < 2.6), label + ' 阅读练习题号居中 (' + readingNumbers.length + ')')
      await at(p, 'subject/speaking?view=daily')
      const daily = p.frameLocator('iframe[title="每日语料跟读"]')
      await daily.locator('[data-act="demoReport"]').click()
      await daily.locator('.sh-band .ring').waitFor(); await p.waitForTimeout(800)
      const dailyRing = await daily.locator('.sh-band .ring').evaluate(node => { const b = node.getBoundingClientRect(), c = node.firstElementChild.getBoundingClientRect(); return { width: b.width, height: b.height, dx: c.x + c.width / 2 - b.x - b.width / 2, dy: c.y + c.height / 2 - b.y - b.height / 2 } })
      result.measurements.push({ label: label + ' shadowing ring', ring: dailyRing })
      check(dailyRing.width === 96 && dailyRing.height === 96 && Math.abs(dailyRing.dx) < .55 && Math.abs(dailyRing.dy) < .55, label + ' 跟读96px分数圆环文字组合居中')
      await daily.locator('.sh-band .ring').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await screenshot(p, 'shadowing-' + label.replace('%', ''))
    }
    await ctx.close()
  }
  check(!result.errors.length, '全程无 JavaScript 错误')
  result.passed = true
} catch (error) { result.passed = false; result.failure = error.stack; throw error }
finally { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log('RESULT ' + path.join(out, 'result.json')); await browser.close(); bindings?.close() }
