import { h, toast } from '../core/dom.js';
import { shell, refreshReadLibBadge, ICON_READLIB } from '../ui/sidebar.js';
import { confirmDialog } from '../ui/dialog.js';
import { allPassages, getPassage } from '../adapters/content.js';
import {
  listReadLib, listNotes, removeLibEntry, clearNotes, notesMap, readLibMap,
} from '../features/store.js';
import {
  libRow, sortLib, libSummary, draftRows,
} from '../features/readlib.js';

const longLabel = (label) => String(label || '').trim() || '未标注';

/**
 * 精读库：列出所有「保存到精读库」的篇目，显示各类标注数量与最近编辑时间。
 * 每条可以继续精读（标注自动同步），也可以删除（连同本篇标注一起清掉）。
 */
export function renderReadLib() {
  const head = h('div.vb-head');
  const bodyBox = h('div.rl-body');

  const root = shell({ active: { kind: 'readlib' }, title: '精读库' },
    h('div.page.rl-page', head, bodyBox));

  const rows = () => sortLib(listReadLib())
    .map((entry) => libRow(entry, { anns: listNotes(entry.passageId), passage: getPassage(entry.passageId) }));

  const deleteRow = async (row) => {
    const ok = await confirmDialog({
      title: '删除这条精读记录',
      message: `「${row.titleZh || row.title}」会从精读库移除，它的 ${row.total} 条标注（划线 / 荧光笔 / 批注）也会一起删除。`,
      note: '删除后无法恢复；如果只是想改标注，点「继续精读」进去改就好。',
      okText: '删除',
      cancelText: '再想想',
      tone: 'danger',
    });
    if (!ok) return;
    removeLibEntry(row.passageId);
    clearNotes(row.passageId);
    refreshReadLibBadge();
    toast(`已删除「${row.titleZh || row.title}」`);
    render();
  };

  const row = (r) => h('div.rl-row', { dataset: { passage: r.passageId } },
    h('span.rl-letter', r.label ? r.label.replace(/[^0-9]/g, '') || '·' : '·'),
    h('div.rl-main',
      h('div.rl-titleline',
        h('b.rl-title', r.title),
        r.titleZh ? h('span.rl-zh', r.titleZh) : null),
      h('div.rl-stats',
        h('span.rl-chip.rl-under', `划线 ${r.under}`),
        h('span.rl-chip.rl-high', `荧光笔 ${r.high}`),
        h('span.rl-chip.rl-note', `批注 ${r.note}`),
        r.total === 0 ? h('span.rl-chip.rl-none', '还没有标注') : null),
      h('div.rl-meta', [
        longLabel(r.label),
        r.source,
        r.when ? `最近编辑 ${r.when}` : '',
      ].filter(Boolean).join(' · '))),
    h('div.rl-side',
      h('a.btn.btn-primary.btn-sm', {
        href: `#/read/${r.passageId}`,
        'data-tip': '进去继续划线、做批注，改动会自动同步',
      }, '继续精读'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onClick: () => deleteRow(r) }, '删除')));

  const emptyCard = () => h('div.vb-empty.rl-empty',
    h('div.vb-empty-mark', { html: ICON_READLIB }),
    h('h2', {}, '精读库还是空的'),
    h('p', {}, '在练习页点「精读」进入本篇原文，划线 / 荧光笔 / 批注之后点顶部的「保存到精读库」，这篇就会连同笔记一起收在这里。'),
    h('a.btn.btn-primary', { href: '#/' }, '去挑一篇'));

  /** 「标了但没保存」的篇目：库为空时也要提示，否则草稿等于隐身 */
  const draftsBlock = (drafts) => (drafts.length
    ? h('div.rl-draft',
      h('span.rl-draft-hint', `还有 ${drafts.length} 篇精读草稿没保存：`),
      ...drafts.map((d) => h('a.rl-draft-chip', {
        href: `#/read/${d.passageId}`,
        'data-tip': '这篇的标注还在本机，进去点「保存到精读库」即可收进来',
      }, `${d.titleZh || d.title}（${d.total} 条）`)))
    : null);

  function render() {
    const list = rows();
    const all = listReadLib();
    const sum = libSummary(list);
    const drafts = draftRows(allPassages(), notesMap(), readLibMap());
    head.replaceChildren(
      h('div',
        h('h1', {}, '精读库'),
        h('p.vb-sub', {}, all.length
          ? `已保存 ${sum.passages} 篇 · 划线 ${sum.under} · 荧光笔 ${sum.high} · 批注 ${sum.note}`
          : '精读时点「保存到精读库」，原文位置和笔记都会留在这里')),
      h('div.vb-actions', h('a.btn.btn-ghost', { href: '#/' }, '去题库')));

    if (!list.length) {
      bodyBox.replaceChildren(...[emptyCard(), draftsBlock(drafts)].filter(Boolean));
      return;
    }

    bodyBox.replaceChildren(
      h('div.vb-count-line', {}, `共 ${list.length} 篇 · 最近编辑的在前`),
      h('div.rl-rows', list.map(row)),
      draftsBlock(drafts));
  }

  render();

  return { root, teardown() {} };
}
