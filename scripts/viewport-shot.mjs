/* 视口内首屏截图：用于核对 sticky 侧栏与顶部主视觉的真实布局（fullPage 截图会偏移 sticky 元素） */
import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/?demo=1'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('input[placeholder="例如：Alex"]').fill('视觉验收')
await page.locator('input[placeholder="you@example.com"]').fill('visual@example.com')
await page.getByRole('button', { name: '进入学习首页' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'screenshots/06-viewport-home.png' })
await browser.close()
console.log('已保存 screenshots/06-viewport-home.png')
