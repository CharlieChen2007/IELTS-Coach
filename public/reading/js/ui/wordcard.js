import { h } from '../core/dom.js';

const STAR = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3.7l2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 17.07l-5.24 2.76 1-5.84L3.52 9.86l5.86-.85z" fill="currentColor"/></svg>';

let active = null;

/** 关闭当前词条卡片 */
export function closeWordCard() {
  if (!active) return;
  active.remove();
  active = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', closeWordCard);
  window.removeEventListener('scroll', closeWordCard, true);
}

function onOutside(e) {
  if (active && !active.contains(e.target)) closeWordCard();
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeWordCard();
  }
}

/** 音标行：英美一致时只显示一条 */
function ipaRow(ipa) {
  if (!ipa) return null;
  const uk = String(ipa.uk || '').trim();
  const us = String(ipa.us || '').trim();
  if (!uk && !us) return null;
  const same = uk === us || !us || !uk;
  const chip = (tag, value) => h('span.wc-ipa-item', h('i', {}, tag), h('span', {}, value));
  return h('div.wc-ipa',
    same ? chip('音标', uk || us) : [chip('英', uk), chip('美', us)]);
}

/** 「词形」「搭配」等补充行 */
function detailRow(label, values) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) return null;
  return h('div.wc-row',
    h('span.wc-k', label),
    h('span.wc-v', list.map((v, i) => (i ? [h('span.wc-sep', '·'), ` ${v}`] : v))));
}

/** 打开单词释义卡片（贴在被点单词上方，空间不足则放下方，自动夹在视口内）。
 * @param {{rect: DOMRect, word: string, entry: {word:string, form:string, pos:string, zh:string,
 *          detail?:{ipa?:{uk:string,us:string}, forms?:string[], coll?:string[]}}|null,
 *          collected: boolean, onToggle: (next: boolean) => boolean}} opts
 *          onToggle 返回切换后的收藏状态
 */
export function openWordCard({ rect, word, entry, collected, onToggle }) {
  closeWordCard();
  const hit = entry || null;
  const head = hit?.word || String(word || '').toLowerCase();
  const detail = hit?.detail || null;

  const star = h('button.star-btn', {
    type: 'button',
    'aria-label': collected ? '取消收藏' : '收藏到阅读生词本',
    'aria-pressed': collected ? 'true' : 'false',
    'data-tip': collected ? '取消收藏' : '收藏到阅读生词本',
  }, h('span.star', { html: STAR }));
  star.classList.toggle('on', !!collected);

  const foot = h('div.wc-foot', collected ? '已在阅读生词本' : '点 ★ 收藏到阅读生词本');

  const card = h('div.wcard', { role: 'dialog', 'aria-label': `释义：${head}` },
    h('div.wc-head',
      h('b.wc-word', head),
      star),
    (hit && hit.form && hit.form !== head) ? h('div.wc-form', `原文形式：${hit.form}`) : null,
    hit ? ipaRow(detail?.ipa) : null,
    hit
      ? h('div.wc-mean', hit.pos ? h('span.wc-pos', hit.pos) : null, h('span.wc-zh', hit.zh))
      : h('div.wc-mean', h('span.wc-missing', '暂未收录释义'), h('span.wc-hint', '仍可收藏，稍后再补')),
    detailRow('词形', detail?.forms),
    detailRow('搭配', detail?.coll),
    foot);

  star.addEventListener('click', () => {
    const next = !!onToggle(!star.classList.contains('on'));
    star.classList.toggle('on', next);
    star.setAttribute('aria-pressed', next ? 'true' : 'false');
    const label = next ? '取消收藏' : '收藏到阅读生词本';
    star.setAttribute('aria-label', label);
    star.dataset.tip = label;
    foot.textContent = next ? '已在阅读生词本' : '点 ★ 收藏到阅读生词本';
  });

  document.body.appendChild(card);
  active = card;

  // 定位：默认在词上方，放不下则放下方；左右夹在视口内
  const m = 10;
  const cr = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const embedded=document.documentElement.classList.contains('host-embedded');
  const split=document.documentElement.dataset.readingWorkspace==='split';
  const visibleTop=embedded&&!split?Math.max(0,window.scrollY)+80:0;
  const vh=embedded&&!split?Math.max(0,window.scrollY)+window.parent.innerHeight-80:window.innerHeight;
  let left = rect.left + rect.width / 2 - cr.width / 2;
  left = Math.max(m, Math.min(left, vw - cr.width - m));
  let top = rect.top - cr.height - 8;
  if (top < visibleTop+m) top = Math.min(rect.bottom + 8, vh - cr.height - m);
  top=Math.max(visibleTop+m,top);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
  card.classList.add('show');

  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeWordCard);
  window.addEventListener('scroll', closeWordCard, true);
  return { close: closeWordCard };
}
