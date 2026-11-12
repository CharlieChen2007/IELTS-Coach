import { h } from '../core/dom.js';
import {allPassages} from '../adapters/content.js';
import { shell } from '../ui/sidebar.js';
import { listSessions } from '../features/store.js';
import { weakTypeStats } from '../features/weakness.js';

const BADGE = {
  priority: { text: '优先练习', cls: 'badge priority' },
  insufficient: { text: '样本不足', cls: 'badge na' },
  ok: { text: '暂不薄弱', cls: 'badge ok' },
};

function pill(label, value, unit = '') {
  return h('div.stat-pill', label, h('b', String(value)), unit);
}

function fmtDay(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 一个题型一行：题型名 + 正确率条 + 分子/分母 + 结论 */
function typeRow(t) {
  const badge = BADGE[t.flag];
  const pct = Math.round(t.accuracy * 100);
  const target=allPassages().find(p=>p.sections.some(section=>section.type===t.type));
  return h('div.wt-row', { class: `wt-${t.flag}` },
    h('div.wt-name',
      h('b', {}, t.label),
      h('small', {}, t.type)),
    h('div.wt-bar', h('i', { style: { width: `${pct}%` } })),
    h('div.wt-side',
      h('span.wt-frac', h('b', {}, String(t.correct)), h('i', {}, '/'), h('span', {}, String(t.total))),
      h('span.wt-pct', {}, t.total?`${pct}%`:'未练'),
      h('span', { class: badge.cls }, badge.text),
      target?h('a.btn.btn-ghost.btn-sm',{href:'#/practice/'+target.id},t.total?'再练一篇':'开始练习'):null));
}

export function renderWeak() {
  const stats = weakTypeStats(listSessions());

  const hasData = stats.answered > 0;

  const head = h('div.page-head',
    h('a.back-link', { href: '#/' }, '← 题库总览'),
    h('h1', {}, '薄弱题型'),
    h('p', {}, hasData
      ? `近 30 天（${fmtDay(stats.from)} – ${fmtDay(stats.to)}）内每道题的首次作答，同一道题只计一次。`
      : '还没有做题记录，完成一篇后才会开始统计。'),
    hasData
      ? h('div.stats-row',
        pill('首次作答', stats.answered, ' 道'),
        pill('覆盖题型', stats.types.filter(t=>t.total>0).length, ' 类'),
        pill('待优先练习', stats.priorityCount, ' 类'))
      : null);

  const note = hasData
    ? h('div.wt-note',
      h('b', {}, '判定口径'),
      h('p', {}, `某题型近 30 天首次作答做到 ${stats.minSample} 道才进入判断；正确率低于 ${Math.round(stats.threshold * 100)}% 标「优先练习」。不足 ${stats.minSample} 道只显示「样本不足」，不下结论。`),
      h('p', {}, '分母＝该题型首次作答的题目数，分子＝其中答对的题目数；当时没作答的题算在分母里、不算答对。'))
    : null;

  const body=h('div.wt-list',stats.types.map(typeRow));

  return {
    root: shell({ active: { kind: 'weak' }, title: '薄弱题型' },
      h('div.page', head, note, body)),
    teardown() {},
  };
}
