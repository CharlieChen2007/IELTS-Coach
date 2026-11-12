import { h } from '../core/dom.js';
import { shell } from '../ui/sidebar.js';
import { allPassages, questionCount } from '../adapters/content.js';
import { overallStats, listMistakes } from '../features/store.js';

// 题库按 IELTS 卷面结构分成三个栏目：Passage 1 / 2 / 3
const BANKS = [
  { id: 'p1', label: 'Passage 1', tier: '基础', en: 'Foundation', accent: '#2f6b8f' },
  { id: 'p2', label: 'Passage 2', tier: '中等', en: 'Standard', accent: '#4388c4' },
  { id: 'p3', label: 'Passage 3', tier: '进阶', en: 'Advanced', accent: '#279783' },
];

function statPill(label, value, unit = '') {
  return h('div.stat-pill', label, h('b', String(value)), unit);
}

/** 一个题库栏目：主体只讲这个题库有多少篇，底部给入口与建议时长 */
function bankCard(bank, passages) {
  const totalQ = passages.reduce((n, p) => n + questionCount(p), 0);
  const totalMin = passages.reduce((n, p) => n + p.minutes, 0);
  const types = [...new Set(passages.flatMap((p) => p.tags || []))];

  const card = h('article.bank-card.glass',
    h('div.bank-top',
      h('span.level-badge', `${bank.label} · ${bank.tier}`),
      h('span.bank-en', bank.en)),

    h('div.bank-main', h('b', String(passages.length)), h('span', '篇目')),

    h('div.meta-row', types.map((t) => h('span.chip.tag', t))),

    h('a.btn.bank-cta', { href: `#/bank/${bank.id}` }, '开始练习'),

    h('div.bank-meta', `${totalQ} 题 · 建议 ${totalMin} 分钟`));

  card.style.setProperty('--accent', bank.accent);
  return card;
}

export function renderHome() {
  const passages = allPassages();
  const stats = overallStats();
  const mistakes = listMistakes();

  // 篇目归哪个栏目由 p.bank 决定（自编三篇沿用 p.id === 栏目 id）
  const banks = BANKS
    .map((bank) => ({ bank, passages: passages.filter((p) => (p.bank || p.id) === bank.id) }))
    .filter((x) => x.passages.length > 0);
  const totalQ = passages.reduce((n, p) => n + questionCount(p), 0);
  const typeCount = new Set(passages.flatMap((p) => p.sections.map((s) => s.type))).size;

  const root = shell({ active: { kind: 'home' }, title: '题库总览' },
    h('div.home',

    h('section.hero.reading-hero',
      h('div.reading-hero-copy',
      h('h1', h('em', {}, '按题型练，回到原文找依据')),
      h('p', {},
        `收录 ${typeCount} 类雅思阅读题型、共 ${totalQ} 道题。左侧读原文、右侧作答，`
        + '交卷后逐题回到原文核对依据，错题自动收进错题本。'),
      h('div.stats-row',
        statPill('累计练习', stats.attempts, ' 次'),
        statPill('平均正确率', stats.attempts ? Math.round(stats.accuracy * 100) : 0, '%'),
        statPill('错题本', mistakes.length, ' 道'),
        statPill('最近正确率', stats.attempts ? Math.round(stats.latestAccuracy * 100) + '%' : '—'))),
      h('img.reading-hero-art', { src: '/subject-art/reading-book.svg', alt: '', width: '390', height: '310', 'aria-hidden': 'true', decoding: 'async' })),

    h('div.section-head',
      h('h2', {}, '题库'),
      h('span', {}, `P1 → P3 难度递增，共 ${totalQ} 题`)),

    h('div.passage-grid', banks.map(({ bank, passages: list }) => bankCard(bank, list))),

    ));

  return { root, teardown() {} };
}
