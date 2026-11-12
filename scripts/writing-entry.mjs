/**
 * 生成「写作精修室」iframe 入口。
 *
 * 写作包是独立 Vite 应用，构建产物落在 public/writing/（build 后进入 dist/writing/）。
 * 直接复用它的 index.html 会有三个问题：
 *   1. bundle 带 hash，每次构建都变；
 *   2. React 一挂载就会先闪一帧独立站的加载页 / 登录页；
 *   3. 独立站自带竖排侧栏 / 顶栏 / 品牌 / 黄色纸飞机 hero，与 IELTS Coach
 *      听/说板块的「横向页签 + 浅蓝 hero + 白卡」是两套展示语言。
 * 所以这里生成一个薄入口：
 *   首帧前判定嵌入态 → 内联样式先行隐藏独立站外壳（防首帧闪）→ 注入游客标记并
 *   从站点数据库恢复工作区 → 再动态 import 真正的 bundle；随后加载
 *   writing-theme.css，把 iframe 内的视觉统一到主站 design tokens。
 *
 * 「功能不变，统一展示方式」：导航不删除，只从 iframe 竖排侧栏上移到主站横向页签，
 * 由 postMessage 驱动原有 .nav-item.click()，React 业务状态与批改链路完全不动。
 * 独立访问 /writing/index.html（非 embedded）时这些规则全部不生效。
 *
 * 运行 `node scripts/writing-entry.mjs` 即可重复生成。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = path.join(root, 'public', 'writing')
const assets = path.join(dir, 'assets')
const pick = (re, label) => {
  const found = readdirSync(assets).filter(name => re.test(name))
  if (found.length !== 1) throw new Error(`${label} 应恰好有 1 个，实际 ${found.length} 个：${found.join(', ')}`)
  return found[0]
}
const js = pick(/^index-[\w-]+\.js$/, '写作 bundle')
const css = pick(/^index-[\w-]+\.css$/, '写作样式')
const source = readFileSync(path.join(dir, 'index.html'), 'utf8')
const title = /<title>([^<]*)<\/title>/.exec(source)?.[1] || 'AI 写作精修室'
const description = /<meta name="description" content="([^"]*)"/.exec(source)?.[1] || ''

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f5f8fb" />
    <meta name="description" content="${description}" />
    <link rel="icon" href="/writing/favicon.svg" />
    <script>
      /* 首帧前判定嵌入态：隐藏独立站的加载页、品牌、账号区与页脚，避免闪一帧合并痕迹。 */
      (function () { try {
        var p = new URLSearchParams(location.search);
        if (window.parent !== window && p.get('embedded') === '1') {
          document.documentElement.classList.add('host-embedded');
        }
      } catch (e) {} })();
    </script>
    <style>
      /* 首帧前就隐藏独立站外壳与竖排导航，避免 React 挂载时闪一帧「另一个站」。
         导航功能仍在 DOM 里，由主站横向页签 postMessage → .nav-item.click() 驱动。 */
      html.host-embedded .loading-screen,
      html.host-embedded .topbar,
      html.host-embedded .sidebar,
      html.host-embedded .sidebar-bottom,
      html.host-embedded .brand,
      html.host-embedded .mobile-nav,
      html.host-embedded .footer { display: none !important; }
      html.host-embedded .main-shell { margin-left: 0 !important; }
      html.host-embedded .main-content { padding-top: 8px; }
    </style>
    <title>${title}</title>
    <script type="module">
      import { init, startSync } from './assets/writing-host.js';
      await init();
      startSync();
      await import('./assets/${js}');
    </script>
    <link rel="stylesheet" crossorigin href="/writing/assets/${css}">
    <link rel="stylesheet" href="/writing/assets/writing-theme.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
writeFileSync(path.join(dir, 'index.html'), html)
console.log(`写作入口已生成：${js} / ${css}`)
