import { h } from '../core/dom.js';

let box = null;
let inited = false;

function ensure() {
  if (box) return box;
  box = h('div.tip', { role: 'tooltip', 'aria-hidden': 'true' });
  document.body.appendChild(box);
  return box;
}

/** 显示：把 [data-tip] 元素的提示浮在元素上方，超出视口时自动夹住 */
function show(el) {
  const text = el?.dataset?.tip;
  if (!text) return;
  const b = ensure();
  b.textContent = text;
  b.classList.add('show');
  const r = el.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const m = 8;
  let left = r.left + r.width / 2 - br.width / 2;
  left = Math.max(m, Math.min(left, window.innerWidth - br.width - m));
  let top = r.top - br.height - 8;
  if (top < m) top = Math.min(r.bottom + 8, window.innerHeight - br.height - m);
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
}

function hide() {
  if (box) box.classList.remove('show');
}

/** 站内提示气泡（替代浏览器原生 title 提示），全局只需调用一次 */
export function initTooltips() {
  if (inited) return;
  inited = true;

  document.addEventListener('mouseover', (e) => {
    const el = e.target?.closest?.('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target?.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target?.closest?.('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('hashchange', hide);
}
