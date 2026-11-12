import { h } from '../core/dom.js';
import { shell, AVATAR_SVG } from '../ui/sidebar.js';
import { listMistakes, listSessions, overallStats } from '../features/store.js';
import { weakTypeStats } from '../features/weakness.js';
import { practiceHeatmap } from '../features/heatmap.js';

function pill(label, value, unit = '') {
  return h('div.stat-pill', label, h('b', String(value)), unit);
}

function fmtDay(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 近 30 天练习热力图：一天一格，颜色深浅 = 当天做过的题数 */
function heatmapBlock(hm) {
  const last = hm.cells.length - 1;
  const cells = hm.cells.map((c, i) => {
    const tip = c.sessions
      ? `${fmtDay(c.ts)} · ${c.sessions} 次 · ${c.questions} 题 · 正确率 ${Math.round((c.correct / c.questions) * 100)}%`
      : `${fmtDay(c.ts)} · 没有练习`;
    return h('span.hm-cell', {
      class: `lv-${c.level}${i === last ? ' hm-today' : ''}`,
      'data-tip': tip,
      'aria-label': tip,
      role: 'img',
    });
  });

  return h('section.hm-card',
    h('div.hm-head',
      h('b', {}, '练习热力图'),
      h('small', {}, `近 30 天 · 活跃 ${hm.totals.activeDays} 天 · 共 ${hm.totals.questions} 题`),
      h('span.spacer'),
      h('div.hm-legend',
        h('span', {}, '少'),
        h('i.hm-cell.lv-1'), h('i.hm-cell.lv-2'), h('i.hm-cell.lv-3'), h('i.hm-cell.lv-4'),
        h('span', {}, '多'))),
    h('div.hm-strip', cells),
    h('div.hm-foot', h('span', {}, fmtDay(hm.from)), h('span', {}, `今天 · ${fmtDay(hm.to)}`)));
}

/** 「学习档案」：本机练习统计 + 近 30 天练习热力图（数据由宿主自动备份） */
export function renderProfile() {
  const sessions = listSessions();
  const stats = overallStats();
  const mistakes = listMistakes();
  const openCount = mistakes.filter((m) => !m.resolved).length;
  const weak = weakTypeStats(sessions);
  const hasData = stats.attempts > 0;
  const hm = practiceHeatmap(sessions);

  const head = h('div.page-head',
    h('h1', {}, '学习档案'),
    h('p', {}, '练习先保存在当前浏览器，并在连接可用时备份到站点学习空间。'));

  const card = h('div.me-card',
    h('div.me-avatar', { html: AVATAR_SVG }),
    h('div.me-text',
      h('b', {}, new URLSearchParams(location.search).get('nickname')||'学习空间用户'),
      h('small', {}, hasData
        ? `已交卷 ${stats.attempts} 次 · 错题本 ${mistakes.length} 道${openCount ? `（${openCount} 道待订正）` : ''}`
        : '还没有做题记录')),
    h('span.spacer'),
    h('span.badge.na', {}, hasData ? '已保存学习记录' : '尚未产生记录'));

  const statsRow = hasData
    ? h('div.stats-row',
      pill('累计练习', stats.attempts, ' 次'),
      pill('平均正确率', Math.round(stats.accuracy * 100), '%'),
      pill('最近正确率', Math.round(stats.latestAccuracy * 100) + '%'),
      pill('待优先练习', weak.priorityCount, ' 类'))
    : null;

  const links = h('div.me-links',
    h('a.btn.btn-ghost.btn-sm', { href: '#/mistakes' }, `错题本 · ${mistakes.length} 道`),
    h('a.btn.btn-ghost.btn-sm', { href: '#/weak-types' }, '薄弱题型 · 近 30 天'),
    h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '回题库总览'));

  return {
    root: shell({ active: { kind: 'profile' }, title: '学习档案' },
      h('div.page', head, card, statsRow, heatmapBlock(hm), links)),
    teardown() {},
  };
}
