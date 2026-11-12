import { h } from './core/dom.js';
import { loadAll } from './adapters/content.js';
import { renderHome } from './views/home.js';
import { renderBank } from './views/bank.js';
import { renderPractice } from './views/practice.js';
import { renderRead } from './views/read.js';
import { renderReadLib } from './views/readlib.js';
import { renderMistakes } from './views/mistakes.js';
import { renderWeak } from './views/weak.js';
import { renderVocab } from './views/vocab.js';
import { renderProfile } from './views/profile.js';
import { initTooltips } from './ui/tooltip.js';

const app = document.getElementById('app');
let current = null;

const routes = [
  { re: /^#?\/?$/, view: () => renderHome() },
  { re: /^#\/bank\/([^/?]+)$/, view: (id) => renderBank(id) },
  { re: /^#\/practice\/([^/?]+)$/, view: (id) => renderPractice(id) },
  { re: /^#\/read\/([^/?]+)$/, view: (id) => renderRead(id) },
  { re: /^#\/readlib$/, view: () => renderReadLib() },
  { re: /^#\/mistakes$/, view: () => renderMistakes() },
  { re: /^#\/weak-types$/, view: () => renderWeak() },
  { re: /^#\/vocab$/, view: () => renderVocab() },
  { re: /^#\/profile$/, view: () => renderProfile() },
];

function resolveRoute() {
  const hash = location.hash || '#/';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) return { view: r.view, params: m.slice(1) };
  }
  return null;
}

function render() {
  if (current?.teardown) current.teardown();
  current = null;

  const matched = resolveRoute();
  app.replaceChildren();

  if (!matched) {
    app.appendChild(h('div.page',
      h('h1', {}, '页面不存在'),
      h('p', { style: { color: 'var(--muted)' } }, '链接可能已经失效。'),
      h('a.btn.btn-primary', { href: '#/' }, '返回题库')));
    return;
  }

  current = matched.view(...matched.params) || {};
  if (current.root) app.appendChild(current.root);
  window.scrollTo({ top: 0 });
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 换页动画：优先用 View Transitions（旧页淡出、新页从下方 12px 淡入，
 * 动画作用在快照上，不会影响 fixed 元素与滚动容器）；不支持时退回整体淡入。
 */
function renderWithTransition() {
  if (document.documentElement.classList.contains('host-embedded') || reducedMotion()) {
    render();
    return;
  }
  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(render);
    return;
  }
  render();
  app.classList.remove('view-fade');
  void app.offsetWidth; // 强制回流，让动画能重复触发
  app.classList.add('view-fade');
  window.setTimeout(() => app.classList.remove('view-fade'), 260);
}

async function boot() {
  try {
    await loadAll();
  } catch (err) {
    app.replaceChildren(h('div.page',
      h('h1', {}, '题库暂时无法读取'),
      h('p', { style: { color: 'var(--muted)', lineHeight: '1.8' } },
        '请稍后刷新页面重试；本机已保存的练习记录不会丢失。'),
      h('pre', { style: { fontSize: '12px', color: 'var(--bad)', whiteSpace: 'pre-wrap',
        display: document.documentElement.classList.contains('host-embedded') ? 'none' : 'block' } }, String(err))));
    return;
  }
  initTooltips();
  window.addEventListener('hashchange', renderWithTransition);
  renderWithTransition();
}

boot();
