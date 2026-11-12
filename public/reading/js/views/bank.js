import { h } from '../core/dom.js';
import { shell } from '../ui/sidebar.js';
import { allPassages, questionCount } from '../adapters/content.js';
import { getDraft, passageProgress } from '../features/store.js';

// 三个题库栏目的元信息（与首页一致）
const BANK_INFO = {
  p1: { label: 'Passage 1', tier: '基础', en: 'Foundation', accent: '#059669' },
  p2: { label: 'Passage 2', tier: '中等', en: 'Standard', accent: '#4f46e5' },
  p3: { label: 'Passage 3', tier: '进阶', en: 'Advanced', accent: '#db2777' },
};

/** 一条篇目细条：名字 / 出处 / 概括 + 题量与建议时长 + 入口 */
function passageRow(passage, index) {
  const draft = getDraft(passage.id);
  const progress = passageProgress(passage.id);
  const cta = draft ? '继续上次进度' : (progress ? '再做一遍' : '开始练习');

  return h('a.ps-row', { href: `#/practice/${passage.id}` },
    h('span.ps-idx', String(index + 1).padStart(2, '0')),
    h('span.ps-main',
      h('span.ps-line1',
        h('b.ps-title', passage.title),
        h('span.ps-zh', passage.titleZh),
        h('span.ps-meta', `${questionCount(passage)} 题 · ${passage.minutes} 分钟`)),
      h('span.ps-line2',
        h('span.ps-src', passage.source || '自编'),
        h('span.ps-dot', '·'),
        h('span.ps-sum', passage.summary || passage.topic || ''))),
    h('span.ps-cta', cta, h('i', {}, '→')));
}

export function renderBank(bankId) {
  const info = BANK_INFO[bankId];
  // 篇目归哪个栏目由 p.bank 决定（自编三篇沿用 p.id === 栏目 id）
  const passages = allPassages().filter((p) => (p.bank || p.id) === bankId);

  if (!info || !passages.length) {
    return {
      root: shell({ active: { kind: 'home' }, title: '题库总览' },
        h('div.page',
          h('div.page-head',
            h('a.back-link', { href: '#/' }, '← 题库总览'),
            h('h1', {}, '这个题库还没有篇目'),
            h('p', {}, '题库内容还在补充中，先看看其他栏目。')),
          h('a.btn.btn-primary', { href: '#/' }, '返回题库总览'))),
      teardown() {},
    };
  }

  const totalQ = passages.reduce((n, p) => n + questionCount(p), 0);
  const totalMin = passages.reduce((n, p) => n + p.minutes, 0);

  const list = h('div.ps-list');
  passages.forEach((p, i) => list.appendChild(passageRow(p, i)));
  list.style.setProperty('--accent', info.accent);

  const root = shell({ active: { kind: 'bank', bankId }, title: `${info.label} · ${info.tier}` },
    h('div.page',
      h('div.page-head',
        h('a.back-link', { href: '#/' }, '← 题库总览'),
        h('h1', {}, `${info.label} · ${info.tier}`),
        h('p', {}, `共 ${passages.length} 篇 · ${totalQ} 题 · 建议 ${totalMin} 分钟 · 点篇目进入练习`)),
      list));

  return { root, teardown() {} };
}
