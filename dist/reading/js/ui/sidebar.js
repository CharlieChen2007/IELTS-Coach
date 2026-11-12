import { h } from '../core/dom.js';
import { allPassages, questionCount } from '../adapters/content.js';
import {
  listMistakes, listSessions, listVocab, overallStats, readLibCount,
} from '../features/store.js';
import { weakTypeStats } from '../features/weakness.js';

/** 品牌标记：纸飞机（与 favicon 同形） */
export const PLANE_SVG = '<svg viewBox="0 0 26 26" width="19" height="19" aria-hidden="true" fill="currentColor"><g transform="translate(1.9 2) scale(.92)"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></g></svg>';

/** 个人图标（线性） */
export const AVATAR_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.1" r="3.5"/><path d="M4.9 20c.8-3.8 3.6-5.9 7.1-5.9s6.3 2.1 7.1 5.9"/></svg>';

/** 侧边栏功能入口的小图标：24×24 线性、描边取当前色 */
const lineIcon = (body) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** 错题本：笔记本 + ✕ */
export const ICON_MISTAKES = lineIcon('<rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2.6"/><path d="M8.4 3.4v17.2"/><path d="M12.9 9.4l3.7 3.7M16.6 9.4l-3.7 3.7"/>');
/** 阅读生词本：摊开的书 + 书脊 */
export const ICON_VOCAB = lineIcon('<path d="M3.6 5.6c2.8-1 5.6-1 8.4.5 2.8-1.5 5.6-1.5 8.4-.5v12.6c-2.8-1-5.6-1-8.4.5-2.8-1.5-5.6-1.5-8.4-.5z"/><path d="M12 6.1v12.6"/>');
/** 薄弱题型：坐标轴 + 三根矮柱（正确率分布） */
export const ICON_WEAK = lineIcon('<path d="M4 20h16"/><path d="M7.6 20v-5.2"/><path d="M12 20v-9.6"/><path d="M16.4 20v-3.2"/>');
/** 精读库：书签 + 笔（存下来的原文与笔记） */
export const ICON_READLIB = lineIcon('<path d="M6.6 3.9h10.8a1.8 1.8 0 0 1 1.8 1.8v14.4l-7.2-3.9-7.2 3.9V5.7a1.8 1.8 0 0 1 1.8-1.8z"/><path d="M10.5 13.2l4.1-4.1 1.7 1.7-4.1 4.1-2 .4.3-2.1z"/>');
/** 题库总览：三栏版式（三个栏目的篇目） */
export const ICON_BANK = lineIcon('<rect x="3.6" y="4.4" width="5.2" height="15.2" rx="1.6"/><rect x="9.4" y="4.4" width="5.2" height="15.2" rx="1.6"/><rect x="15.2" y="4.4" width="5.2" height="15.2" rx="1.6"/>');

function navItem({ href, active, mark, title, sub, count, accent, kind }) {
  const isIcon = String(mark).startsWith('<svg');
  const item = h('a.sb-item', { href, class: active ? 'active' : '' },
    isIcon ? h('span.sb-mark', { html: mark }) : h('span.sb-mark', mark),
    h('span.sb-text', h('b', title), h('small', sub)));
  if (count) item.appendChild(h('span.sb-count', String(count)));
  if (accent) item.style.setProperty('--accent', accent);
  if (kind) item.dataset.kind = kind;
  return item;
}

/** 收藏/取消收藏后同步侧边栏「阅读生词本」的角标与副标题（不重渲染整页） */
export function refreshVocabBadge() {
  const item = document.getElementById('sidebar')?.querySelector('.sb-item[data-kind="vocab"]');
  if (!item) return;
  const total = listVocab().length;
  const sub = item.querySelector('.sb-text small');
  if (sub) sub.textContent = total ? `已收藏 ${total} 词` : '还没收藏单词';
  let badge = item.querySelector('.sb-count');
  if (total > 0) {
    if (!badge) {
      badge = h('span.sb-count');
      item.appendChild(badge);
    }
    badge.textContent = String(total);
  } else if (badge) {
    badge.remove();
  }
}

/** 保存/移出精读库后同步侧边栏「精读库」的角标与副标题 */
export function refreshReadLibBadge() {
  const item = document.getElementById('sidebar')?.querySelector('.sb-item[data-kind="readlib"]');
  if (!item) return;
  const total = readLibCount();
  const sub = item.querySelector('.sb-text small');
  if (sub) sub.textContent = total ? `已精读 ${total} 篇` : '还没有精读';
  let badge = item.querySelector('.sb-count');
  if (total > 0) {
    if (!badge) {
      badge = h('span.sb-count');
      item.appendChild(badge);
    }
    badge.textContent = String(total);
  } else if (badge) {
    badge.remove();
  }
}

/** 顶部栏：左侧产品名，右侧个人图标；功能入口只在侧边栏 */
function topbar(active) {
  return h('header.topbar', { id: 'topbar' },
    h('div.tb-left',
      h('button.menu-btn', { type: 'button', 'aria-label': '打开导航' }, '☰'),
      h('a.tb-brand', { href: '#/' },
        h('span.brand-mark', { html: PLANE_SVG }),
        h('span.tb-brand-text', h('b', '阅读精读'), h('small', 'IELTS Coach')))),
    h('span.spacer'),
    h('a.tb-avatar', {
      href: '#/profile',
      class: active.kind === 'profile' ? 'active' : '',
      'aria-label': '我的',
    }, h('span.avatar-icon', { html: AVATAR_SVG })));
}

/** 侧边栏只放功能入口，不放题库内容（题库内容在题库总览里） */
function sidebar(active) {
  const passages = allPassages();
  const totalQ = passages.reduce((n, p) => n + questionCount(p), 0);
  const mistakes = listMistakes();
  const open = mistakes.filter((m) => !m.resolved).length;
  const stats = overallStats();
  const weak = weakTypeStats(listSessions());
  const vocab = listVocab();
  const inBank = active.kind === 'home' || active.kind === 'bank' || active.kind === 'lesson';

  const mistakeSub = open
    ? `${open} 道待订正`
    : (mistakes.length ? '全部已订正' : '还没有错题');
  const weakSub = weak.priorityCount
    ? `${weak.priorityCount} 类优先练习`
    : (weak.answered ? '近 30 天暂不明显' : '近 30 天无记录');

  return h('aside.sidebar', { id: 'sidebar' },
    h('nav.sb-nav',
      h('div.sb-group', '练习'),
      navItem({
        href: '#/',
        active: inBank,
        mark: ICON_BANK,
        title: '题库总览',
        sub: `${passages.length} 篇 · ${totalQ} 题`,
        kind: 'bank',
      }),
      h('div.sb-group', '复盘'),
      navItem({
        href: '#/mistakes',
        active: active.kind === 'mistakes',
        mark: ICON_MISTAKES,
        title: '错题本',
        sub: mistakeSub,
        count: mistakes.length,
        accent: '#be123c',
      }),
      navItem({
        href: '#/vocab',
        active: active.kind === 'vocab',
        mark: ICON_VOCAB,
        title: '阅读生词本',
        sub: vocab.length ? `已收藏 ${vocab.length} 词` : '还没收藏单词',
        count: vocab.length,
        accent: '#0d9488',
        kind: 'vocab',
      }),
      navItem({
        href: '#/weak-types',
        active: active.kind === 'weak',
        mark: ICON_WEAK,
        title: '薄弱题型',
        sub: weakSub,
        count: weak.priorityCount,
        accent: '#b45309',
      }),
      navItem({
        href: '#/readlib',
        active: active.kind === 'readlib',
        mark: ICON_READLIB,
        title: '精读库',
        sub: readLibCount() ? `已精读 ${readLibCount()} 篇` : '还没有精读',
        count: readLibCount(),
        accent: '#4f46e5',
        kind: 'readlib',
      })),

    h('div.sb-foot',
      h('div.sb-stat', h('span', {}, '累计练习'), h('b', {}, `${stats.attempts} 次`)),
      h('div.sb-stat', h('span', {}, '平均正确率'), h('b', {}, stats.attempts ? `${Math.round(stats.accuracy * 100)}%` : '—')),
      h('div.sb-stat', h('span', {}, '最近正确率'), h('b', {}, stats.attempts ? Math.round(stats.latestAccuracy * 100) + '%' : '—'))));
}

/**
 * 页面外壳：顶部栏 + 左侧导航 + 主区域。
 * @param {{mode?: string, active?: {kind: 'home'|'bank'|'lesson'|'mistakes'|'weak'|'vocab'|'profile', bankId?: string, passageId?: string}, title?: string}} opts
 */
export function shell(opts = {}, ...children) {
  const { mode = '', active = { kind: 'home' } } = opts;

  const bar = topbar(active);
  const nav = sidebar(active);
  const backdrop = h('div.sb-backdrop');

  const main = h('main.main', ...children);
  const root = h('div.shell', bar, nav, backdrop, main);
  if (mode) root.classList.add(mode);

  const toggle = () => {
    nav.classList.toggle('open');
    backdrop.classList.toggle('show');
  };
  const close = () => {
    nav.classList.remove('open');
    backdrop.classList.remove('show');
  };

  root.querySelectorAll('.menu-btn').forEach((btn) => btn.addEventListener('click', toggle));
  backdrop.addEventListener('click', close);
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });

  return root;
}

