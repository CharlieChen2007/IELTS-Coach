import { h, toast, fmtAnswer } from '../core/dom.js';
import { shell } from '../ui/sidebar.js';
import { confirmDialog } from '../ui/dialog.js';
import { getPassage } from '../adapters/content.js';
import { listMistakes, removeMistake, clearMistakes } from '../features/store.js';
import { TYPE_LABEL } from '../core/constants.js';

const ORDER = ['p1', 'p2', 'p3'];
const LABEL = { p1: 'Passage 1', p2: 'Passage 2', p3: 'Passage 3' };

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function renderMistakes() {
  let filter = 'all';
  let items = listMistakes();

  const openGroups = new Set();
  const openRows = new Set();

  const listBox = h('div.mx-list');
  const summaryEl = h('p');
  const filterRow = h('div.filter-row');

  const counts = () => ({
    all: items.length,
    open: items.filter((m) => !m.resolved).length,
  });
  const visible = () => (filter === 'open' ? items.filter((m) => !m.resolved) : items);

  const groups = () => {
    const map = new Map();
    for (const m of visible()) {
      if (!map.has(m.passageId)) map.set(m.passageId, []);
      map.get(m.passageId).push(m);
    }
    return [...map.entries()]
      .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
      .map(([id, list]) => [id, list.slice().sort((a, b) => a.number - b.number)]);
  };

  const questionNode = (m) => {
    const open = openRows.has(m.questionId);
    const wrap = h('div.mx-q');
    if (open) wrap.classList.add('open');
    if (m.resolved) wrap.classList.add('resolved');

    const stateBadge = m.resolved
      ? h('span.badge.ok', '已订正')
      : (m.count > 1 ? h('span.badge.no', `错 ${m.count} 次`) : h('span.badge.na', '未订正'));

    const row = h('button.mx-row', { type: 'button' },
      h('span.mx-num', `Q${m.number}`),
      h('span.badge.type', TYPE_LABEL[m.type] || m.type),
      h('span.mx-stem', m.stem),
      h('span.mx-ans',
        h('s', {}, fmtAnswer(m.yourAnswer)),
        h('span.mx-arrow', {}, '→'),
        h('b', {}, fmtAnswer(m.correctAnswer))),
      stateBadge,
      h('span.mx-caret', {}, '›'));

    row.addEventListener('click', () => {
      const next = !wrap.classList.contains('open');
      wrap.classList.toggle('open', next);
      if (next) openRows.add(m.questionId);
      else openRows.delete(m.questionId);
    });

    const detail = h('div.mx-detail',
      h('div.mx-detail-in',
        h('div.mx-why', h('b', {}, '判定理由'), h('span', {}, m.explanation?.verdict || '—')),
        h('div.mx-quote',
          h('b', {}, `原文 · 段落 ${m.explanation?.paragraph || '?'}`),
          h('span', {}, `“${m.explanation?.quote || ''}”`)),
        h('div.mx-actions',
          h('a.btn.btn-ghost.btn-sm', { href: `#/practice/${m.passageId}` }, '重练本篇'),
          h('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onClick: (e) => { e.stopPropagation(); remove(m.questionId); },
          }, '移除'))));

    wrap.append(row, detail);
    return wrap;
  };

  const groupNode = (id, list) => {
    const p = getPassage(id);
    const open = openGroups.has(id);
    const group = h('section.mx-group');
    if (open) group.classList.add('open');

    const openCount = list.filter((m) => !m.resolved).length;
    const lastAt = Math.max(...list.map((m) => m.lastAt || 0));

    const head = h('button.mx-head', { type: 'button' },
      h('span.mx-badge', LABEL[id] || id),
      h('span.mx-title',
        h('b', {}, p ? p.title : (list[0].passageTitle || id)),
        h('small', {}, `${LABEL[id]}${p?.titleZh ? ` · ${p.titleZh}` : ''}`)),
      h('span.mx-meta',
        h('span.mx-count', {}, `${list.length} 道错题`),
        h('span.mx-sub', {}, openCount ? `${openCount} 未订正` : '全部已订正'),
        h('span.mx-sub', {}, `最近 ${fmtDate(lastAt)}`)),
      h('span.mx-caret', {}, '›'));

    head.addEventListener('click', () => {
      const next = !group.classList.contains('open');
      group.classList.toggle('open', next);
      if (next) openGroups.add(id);
      else openGroups.delete(id);
    });

    const body = h('div.mx-body', h('div.mx-inner', list.map(questionNode)));
    group.append(head, body);
    return group;
  };

  const renderSummary = () => {
    const c = counts();
    summaryEl.replaceChildren();
    summaryEl.append(...[
      `共 ${c.all} 道错题`,
      `未订正 ${c.open} 道`,
      c.all ? '点击篇章展开，再点题目看解析' : '做错的题会自动收录、按篇章归类',
    ].flatMap((t, i) => (i ? [' · ', t] : [t])));
  };

  const renderFilters = () => {
    const c = counts();
    filterRow.replaceChildren();
    const defs = [
      ['all', `全部 ${c.all}`],
      ['open', `未订正 ${c.open}`],
    ];
    for (const [key, label] of defs) {
      const b = h('button.seg-tab', { type: 'button' }, label);
      if (key === filter) b.classList.add('on');
      b.addEventListener('click', () => { filter = key; render(); });
      filterRow.appendChild(b);
    }
    filterRow.appendChild(h('span.spacer'));
    if (items.length) {
      filterRow.appendChild(h('button.btn.btn-ghost.btn-sm.btn-danger', {
        type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: '清空错题本',
            message: `确定清空全部 ${items.length} 道错题吗？`,
            note: '此操作不可撤销，清空后错题本会重新开始收录。',
            okText: '全部清空',
            cancelText: '再想想',
            tone: 'danger',
          });
          if (!ok) return;
          items = clearMistakes();
          openGroups.clear();
          openRows.clear();
          toast('错题本已清空');
          render();
          refreshBadge();
        },
      }, '清空错题本'));
    }
  };

  const emptyNode = () => (items.length
    ? h('div.empty',
      h('b', {}, '这个筛选下没有错题'),
      h('p', { style: { margin: '0 0 14px' } }, '切回「全部」看看，或者去做一篇新的阅读。'),
      h('a.btn.btn-primary.btn-sm', { href: '#/practice/p1' }, '开始第一篇 →'))
    : h('div.empty',
      h('b', {}, '错题本还是空的'),
      h('p', { style: { margin: '0 0 14px' } }, '做错的题会自动收录在这里，按篇章归类，并附原文定位与判定理由。'),
      h('a.btn.btn-primary.btn-sm', { href: '#/practice/p1' }, '开始第一篇 →')));

  const refreshBadge = () => {
    const n = items.filter((m) => !m.resolved).length;
    document.querySelectorAll('.sb-item .sb-count').forEach((el) => {
      if (n) el.textContent = String(n);
      else el.remove();
    });
  };

  const remove = (questionId) => {
    items = removeMistake(questionId);
    openRows.delete(questionId);
    toast('已从错题本移除');
    render();
    refreshBadge();
  };

  const render = () => {
    renderSummary();
    renderFilters();
    listBox.replaceChildren();
    const gs = groups();
    if (!gs.length) {
      listBox.appendChild(emptyNode());
      return;
    }
    for (const [id, list] of gs) listBox.appendChild(groupNode(id, list));
  };

  render();

  const root = shell({ active: { kind: 'mistakes' }, title: '错题本' },
    h('div.page',
      h('div.page-head',
        h('h1', {}, '错题本'),
        summaryEl),
      filterRow,
      listBox));

  return { root, teardown() {} };
}
