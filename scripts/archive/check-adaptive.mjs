/* 设备自适应验收：
   1. 不同设备特征 → 启动档位正确（手机/低配/弱网/省流量/无设备信息/减少动效）
   2. 硬件好但实际跑不动（CPU 6x 降速）→ 实测后自动降档
   3. 档位只降不升，且不会反复抖动
   用法：BASE_URL=http://127.0.0.1:xxxx/ node scripts/check-adaptive.mjs  */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4231/'
const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const checks = []
const ok = (l, c, e='') => { checks.push([l, !!c]); console.log(`${c?'PASS':'FAIL'}  ${l}${e?'  '+e:''}`) }

async function run(label, profile, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.vp ?? { width: 1440, height: 900 },
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference' })
  await ctx.addInitScript(({ cores, mem, eff, saveData, touch }) => {
    if (cores !== null) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores, configurable: true })
    if (mem !== null) Object.defineProperty(navigator, 'deviceMemory', { get: () => mem, configurable: true })
    Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: eff, saveData }), configurable: true })
    if (touch) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true })
  }, profile)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  if (opts.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu })
  await page.goto(BASE, { waitUntil: 'commit' })
  // 启动档位（第一帧就有）
  const startup = await page.evaluate(() => document.documentElement.getAttribute('data-motion'))
  // 等实测修正完成（800ms 后）
  await page.waitForTimeout(2200)
  const final = await page.evaluate(() => ({
    motion: document.documentElement.getAttribute('data-motion'),
    why: document.documentElement.getAttribute('data-motion-why'),
  }))
  const dur = await page.evaluate(() => {
    const el = document.querySelector('.boot-inner')
    return el ? getComputedStyle(el).animationDuration : 'gone'
  })
  console.log(`\n${label}`)
  console.log(`  启动=${startup.padEnd(5)} 实测后=${String(final.motion).padEnd(5)} 原因=${final.why} 动画时长=${dur}`)
  await ctx.close()
  return { startup, final: final.motion, why: final.why }
}

const r1 = await run('高端桌面 32核/32G', { cores: 32, mem: 32, eff: '4g', saveData: false })
const r2 = await run('中端 4核/4G', { cores: 4, mem: 4, eff: '4g', saveData: false })
const r3 = await run('低端 2核/2G', { cores: 2, mem: 2, eff: '4g', saveData: false })
const r4 = await run('省流量模式', { cores: 8, mem: 8, eff: '3g', saveData: true })
const r5 = await run('2G 网络', { cores: 8, mem: 8, eff: '2g', saveData: false })
const r6 = await run('Safari 类（无内存/核心信息）', { cores: null, mem: null, eff: '4g', saveData: false })
const r7 = await run('Safari 手机（无信息+触摸小屏）', { cores: null, mem: null, eff: '4g', saveData: false, touch: true }, { vp: { width: 390, height: 844 } })
const r8 = await run('高配但 CPU 6x 降速', { cores: 32, mem: 32, eff: '4g', saveData: false }, { cpu: 6 })
const r9 = await run('减少动效', { cores: 32, mem: 32, eff: '4g', saveData: false }, { reduced: true })

console.log('\n=== 判定 ===')
ok('高端桌面 → high', r1.startup === 'high' && r1.final === 'high', `${r1.startup}/${r1.final}`)
ok('中端 4核 → mid', r2.startup === 'mid', r2.startup)
ok('低端 2核 → low', r3.startup === 'low', r3.startup)
ok('省流量 → low', r4.startup === 'low', r4.startup)
ok('2G → low', r5.startup === 'low', r5.startup)
ok('无设备信息(Safari) 桌面 → high', r6.startup === 'high', r6.startup)
ok('无设备信息 + 手机 → 不超过 mid', r7.startup !== 'high', r7.startup)
ok('减少动效 → off', r9.startup === 'off', r9.startup)
ok('高配 + 6x 降速 → 实测自动降档', r8.final !== 'high', `启动${r8.startup} → 实测${r8.final} (${r8.why})`)
ok('高端设备不被首帧尖峰误判（保持 high）', r1.final === 'high', `${r1.startup}→${r1.final} (${r1.why})`)
ok('低配/弱网档位不被运行期回升（只降不升）', r3.final === 'low' && r4.final === 'low' && r5.final === 'low',
  `低端=${r3.final} 省流量=${r4.final} 2G=${r5.final}`)

await browser.close()
console.log(`\n自适应验收：${checks.filter(c=>c[1]).length} / ${checks.length} 项通过`)
if (checks.some(c => !c[1])) process.exit(1)
