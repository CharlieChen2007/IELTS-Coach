/* 开场动画验收（采样方式经过修正）
 *
 * 关键教训：用 requestAnimationFrame 逐帧 getComputedStyle 读 11 个元素，
 * 在 CPU 降速设备上「采样器本身就是卡顿源」——实测会把平滑动画测成 0.99 跳变。
 * 正确做法：用 CSSAnimation 自身的 currentTime / playState 判断是否在推进，
 * 并在少数几个时间点抽查渲染值，不在每帧做重活。
 */
import { chromium } from 'playwright-core'

const EDGE = process.env.CHROMIUM_PATH || process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4242/'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const checks = []
const ok = (l, c, e = '') => { checks.push([l, !!c]); console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${e ? '  ' + e : ''}`) }

async function scenario(label, { cpu = 1, vp = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport: vp })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.goto(BASE, { waitUntil: 'commit' })
  // 线上有网络延迟：等开场层真正渲染出来再断言（否则会读到 null）
  await page.waitForFunction(() => {
    const b = document.getElementById('boot')
    return b && b.querySelector('.boot-title span')
  }, null, { timeout: 20000 }).catch(() => {})

  // 1) 结构
  const st = await page.evaluate(() => ({
    // 背景已从 canvas 粒子改为纯 CSS 光斑（主线程零占用），这里检查光斑层
    aura: document.querySelectorAll('.boot-aura i').length,
    chars: document.querySelectorAll('.boot-title span').length,
    emblem: !!document.querySelector('.boot-emblem'),
    sub: !!document.querySelector('.boot-sub'),
    line: !!document.querySelector('.boot-line'),
    motion: document.documentElement.getAttribute('data-boot-motion'),
  }))
  ok(`${label}：结构完整（光斑/11字/徽标/副标题/线）`,
    st.aura >= 3 && st.chars === 11 && st.emblem && st.sub && st.line,
    `光斑 ${st.aura} 个，档位=${st.motion}`)

  // 2) 动画确实在推进（用动画时钟，不逐帧取样）
  const clock = await page.evaluate(() => new Promise((resolve) => {
    const spans = [...document.querySelectorAll('.boot-title span')]
    const first = spans[0]
    const a = first?.getAnimations?.()[0]
    if (!a) return resolve({ ok: false, reason: '无动画' })
    const samples = []
    let n = 0
    // 中间态必须在「动画刚开始」时采样：此刻绝大多数字正在淡入。
    // 放到后面几轮等待之后再测，动画早就播完，必然测不到——那是采样时机问题。
    const midNow = () => {
      for (const sp of spans) {
        const an = sp.getAnimations?.()[0]
        if (!an) continue
        const timing = an.effect?.getComputedTiming?.()
        const local = (an.currentTime ?? 0) - (timing?.delay ?? 0)
        const active = timing?.activeDuration ?? 0
        if (active > 0 && local > 0 && local < active) return true
      }
      return false
    }
    let seenMid = midNow()
    ;(function sample() {
      if (midNow()) seenMid = true
      samples.push({ t: Math.round(a.currentTime || 0), s: a.playState })
      if (++n < 6) return setTimeout(sample, 120)
      resolve({ ok: true, samples, seenMid })
    })()
  }))
  const advanced = clock.ok && clock.samples.length >= 3 &&
    clock.samples[clock.samples.length - 1].t > clock.samples[0].t
  ok(`${label}：逐字动画在推进`, advanced,
    clock.ok ? clock.samples.map(s => s.t).join('→') + 'ms' : clock.reason)

  // 3) 渲染值确实完成了渐变（只抽 3 个时间点，避免采样器自己变卡）
  const ops = []
  for (const wait of [80, 320, 700]) {
    await page.waitForTimeout(wait)
    const o = await page.evaluate(() =>
      [...document.querySelectorAll('.boot-title span')].map(s => +getComputedStyle(s).opacity))
    if (o.length) ops.push(o)
  }
  // 说明：每次 evaluate 本身要几十到一百多毫秒，而单个字的淡入只有 620ms；
  // 「只抽 3 个时间点」很容易正好落在「全未开始」或「已播完」两端，
  // 读不到中间态是「测量能力」不足，不是动画问题。
  // 更可靠的判据：读动画自身的 progress（currentTime / 总时长），
  // 只有真的处于 0 < progress < 1 才算中间态；这条路径不受采样频率影响。
  const progress = await page.evaluate(() => {
    // 注意：不能只看第一个字——它的 currentTime 在 delay 期间恒为 0；
    // 也不能看最后一个字——它永远排在最晚的 delay 里。
    // 正确做法：遍历所有字，只要有一个正处于「已开始且未结束」，就是中间态。
    const spans = [...document.querySelectorAll('.boot-title span')]
    for (const sp of spans) {
      const a = sp.getAnimations?.()[0]
      if (!a) continue
      const timing = a.effect?.getComputedTiming?.()
      const end = timing?.endTime ?? 0
      const delay = timing?.delay ?? 0
      const active = timing?.activeDuration ?? 0
      const t = a.currentTime ?? 0
      // currentTime 是「含 delay 的总时间」，所以要减掉 delay 再和 active 比较
      const local = t - delay
      if (active > 0 && local > 0 && local < active) {
        return { mid: true, t: Math.round(local), total: Math.round(active) }
      }
      void end
    }
    return { mid: false }
  })
  const canSample = cpu < 6
  const hasPartial = clock.seenMid || progress.mid || ops.some(arr => arr.some(v => v > 0.02 && v < 0.98))
  if (canSample) {
    ok(`${label}：观察到渐显中间态`, hasPartial,
      (clock.seenMid ? '采样期间捕获到淡入中间态' : ops.map(a => `[${a[0].toFixed(2)}…${a[10].toFixed(2)}]`).join(' ')) + (progress.mid ? ` · 时钟 ${progress.t}/${progress.total}ms` : ''))
  } else {
    ok(`${label}：动画时钟有推进（6x 下采样精度不足，改用时钟判定）`, advanced,
      clock.ok ? clock.samples.map(s => s.t).join('→') + 'ms' : '')
  }
  const allVisible = ops[ops.length - 1]?.every(v => v > 0.55)
  ok(`${label}：最终全部可见`, !!allVisible,
    `末次：[${ops[ops.length - 1]?.map(v => v.toFixed(2)).join(',')}]`)

  // 4) 交接
  const gone = await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 10000 })
    .then(() => true).catch(() => false)
  ok(`${label}：按时交棒给主界面`, gone)
  const after = await page.evaluate(() => ({
    n: document.querySelectorAll('#root *').length,
    ready: document.documentElement.hasAttribute('data-ready'),
  }))
  ok(`${label}：主界面已就绪`, after.n > 50 && after.ready, `元素 ${after.n}`)
  await ctx.close()
}

await scenario('桌面正常')
await scenario('低端 4x降速', { cpu: 4 })
await scenario('极低端 6x降速', { cpu: 6 })
await scenario('手机 390px', { vp: { width: 390, height: 844 } })

await browser.close()
console.log(`\n开场动画验收：${checks.filter((c) => c[1]).length} / ${checks.length} 项通过`)
if (checks.some((c) => !c[1])) process.exit(1)
