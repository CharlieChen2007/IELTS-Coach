import {
  h, toast,
} from '../core/dom.js';
import { shell, refreshVocabBadge, refreshReadLibBadge } from '../ui/sidebar.js';
import { confirmDialog, dialogChoice } from '../ui/dialog.js';
import { openWordCard, closeWordCard } from '../ui/wordcard.js';
import { getPassage, allPassages, getGlossary, getGlossaryDetail } from '../adapters/content.js';
import {
  listNotes, saveNotes, clearNotes, isCollected, toggleVocab,
  getLibEntry, saveLibEntry, touchLibEntry, removeLibEntry,
  getReadPos, setReadPos,
} from '../features/store.js';
import { formatWhen } from '../features/readlib.js';
import {
  addAnnotation, removeAnnotation, updateNote, stats, annotationsOf,
  buildSegments, normalizeRange, NOTE_MAX,
} from '../features/annotation.js';
import {
  caretRangeAt, offsetInRoot, rangeByOffset, nodeElement, clearSelection,
} from '../core/selection.js';
import {
  lookup, wordAt, sentenceAt, makeVocabEntry,
} from '../features/vocab.js';

const DOTS = {
  under: '划线',
  high: '荧光',
  note: '批注',
};

const COLOR_LABEL = { yellow: '黄', green: '绿', blue: '蓝' };

/**
 * 精读页：本篇原文 + 划线 / 荧光笔 / 批注。
 * 标注按「段落 + 纯文本偏移」存 localStorage（yl.v1.notes），换设备不同步。
 */
export function renderRead(passageId) {
  const passage = getPassage(passageId);
  if (!passage) {
    return {
      root: h('div.page', h('h1', {}, '篇目不存在'), h('a.btn.btn-primary', { href: '#/' }, '返回题库')),
      teardown() {},
    };
  }

  const glossary = getGlossary();
  const wordDetail = getGlossaryDetail();
  const bankId = passage.bank || passage.id;
  const siblings = allPassages().filter((p) => (p.bank || p.id) === bankId);
  const selfIdx = siblings.findIndex((p) => p.id === passage.id);
  const prevPassage = selfIdx > 0 ? siblings[selfIdx - 1] : null;
  const nextPassage = selfIdx >= 0 && selfIdx < siblings.length - 1 ? siblings[selfIdx + 1] : null;
  const paraMap = new Map();
  let anns = listNotes(passageId);
  let pending = null; // 当前选区：{para,start,end,quote}
  let undoStack = []; // 历史状态快照，撤销用
  let tools = null;
  let pop = null;
  let dialog = null;
  let selTimer = null;

  /* ---------------- 顶部条 ---------------- */
  const statEl = h('div.rb-stat');
  const stateChip = h('span.rb-state.is-draft', '未保存');
  const saveBtn = h('button.btn.btn-primary.btn-sm', {
    type: 'button',
    'data-tip': '把这篇原文和标注收进侧边栏的「精读库」',
  }, '保存到精读库');
  const libLink = h('a.btn.btn-ghost.btn-sm', { href: '#/readlib', 'data-tip': '去精读库查看' }, '精读库');
  libLink.style.display = 'none';
  const undoBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, '撤销');
  const clearBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, '清除标注');
  const listLink = h('a.btn.btn-ghost.btn-sm.rb-wide', { href: `#/bank/${bankId}`, 'data-tip': '回到本篇所在栏目的篇目列表' }, '篇目列表');

  // 段落快速跳转（A–F）
  const paraJump = h('div.rb-paras', { role: 'group', 'aria-label': '跳到段落' });
  passage.paragraphs.forEach((p) => {
    paraJump.appendChild(h('button.rb-para', {
      type: 'button',
      'data-para': p.id,
      'data-tip': `跳到段落 ${p.id}`,
      'aria-label': `跳到段落 ${p.id}`,
    }, p.id));
  });

  // 同一栏目的上一篇 / 下一篇
  const prevBtn = h('button.rb-step', {
    type: 'button',
    'aria-label': '上一篇精读',
    'data-tip': prevPassage ? `上一篇：${prevPassage.titleZh}` : '已经是该栏目第一篇',
  }, '‹');
  const nextBtn = h('button.rb-step', {
    type: 'button',
    'aria-label': '下一篇精读',
    'data-tip': nextPassage ? `下一篇：${nextPassage.titleZh}` : '已经是该栏目最后一篇',
  }, '›');
  prevBtn.disabled = !prevPassage;
  nextBtn.disabled = !nextPassage;
  const stepBox = h('div.rb-steps.rb-wide', prevBtn, nextBtn);

  // ≤960px 收进「更多」菜单
  const menuStat = h('div.rb-menu-stat');
  const menuUndo = h('button.rb-menu-item', { type: 'button' }, '撤销上一步');
  const menuClear = h('button.rb-menu-item', { type: 'button' }, '清除标注');
  const menuPrev = h('button.rb-menu-item', { type: 'button' }, '上一篇');
  const menuNext = h('button.rb-menu-item', { type: 'button' }, '下一篇');
  const menuList = h('a.rb-menu-item', { href: `#/bank/${bankId}` }, '返回篇目列表');
  const moreMenu = h('div.rb-menu', { role: 'menu' }, menuStat, menuUndo, menuClear, menuPrev, menuNext, menuList);
  const moreBtn = h('button.btn.btn-ghost.btn-sm.rb-more', {
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'data-tip': '更多操作（撤销 / 清除 / 上下篇）',
  }, '更多');
  const moreWrap = h('div.rb-more-wrap', moreBtn, moreMenu);

  const head = h('div.read-bar',
    h('a.read-back', { href: `#/practice/${passage.id}` }, '← 返回做题'),
    h('div.rb-title',
      h('b', {}, passage.title),
      h('span', {}, `${passage.label} · ${passage.titleZh} · ${passage.paragraphs.length} 段`)),
    paraJump,
    h('span.spacer'),
    stateChip,
    statEl,
    saveBtn,
    libLink,
    undoBtn,
    clearBtn,
    stepBox,
    listLink,
    moreWrap);

  /* ---------------- 正文 ---------------- */
  const paper = h('div.read-paper');
  const notesBox = h('section.read-notes');

  const buildPara = (p) => {
    const textEl = h('p.rpara-text', { 'data-para': p.id });
    const root = h('div.rpara', { id: `rpara-${p.id}` },
      h('span.rpara-letter', p.id),
      textEl);
    paraMap.set(p.id, { root, textEl, text: p.text });
    return root;
  };

  const paraNodes = passage.paragraphs.map(buildPara);

  const segNode = (seg) => {
    const cls = [
      seg.under ? 'annot annot-under' : '',
      seg.color ? `annot annot-high high-${seg.color}` : '',
      seg.noteId ? 'annot annot-note' : '',
    ].filter(Boolean).join(' ');
    if (!cls) return document.createTextNode(seg.text);
    const attrs = { class: cls, 'data-plain': seg.ids.filter((id) => id !== seg.noteId).join(' ') };
    if (seg.noteId) attrs['data-note'] = seg.noteId;
    return h('span', attrs, seg.text);
  };

  const paintPara = (p) => {
    const item = paraMap.get(p.id);
    if (!item) return;
    const segs = buildSegments(p.text, annotationsOf(anns, p.id));
    item.textEl.replaceChildren(...segs.map(segNode));
  };

  const paintAll = () => {
    for (const p of passage.paragraphs) paintPara(p);
  };

  /** 顶部条状态：未保存（可点保存）/ 已保存（显示最近编辑时间） */
  const renderSaveState = () => {
    const lib = getLibEntry(passage.id);
    const saved = !!lib;
    stateChip.className = `rb-state ${saved ? 'is-saved' : 'is-draft'}`;
    stateChip.textContent = saved ? `已保存 · ${formatWhen(lib.updatedAt)}` : '未保存';
    stateChip.setAttribute('data-tip', saved
      ? '改动会自动同步到精读库'
      : '点「保存到精读库」才会收进精读库，返回时也会再问一次');
    saveBtn.style.display = saved ? 'none' : '';
    libLink.style.display = saved ? '' : 'none';
  };

  const renderStat = () => {
    const s = stats(anns);
    statEl.textContent = `划线 ${s.under} · 荧光笔 ${s.high} · 批注 ${s.note}`;
    undoBtn.disabled = undoStack.length === 0;
    undoBtn.classList.toggle('is-off', undoStack.length === 0);
    clearBtn.disabled = s.total === 0;
    clearBtn.classList.toggle('is-off', s.total === 0);
    menuStat.textContent = statEl.textContent;
    menuUndo.disabled = undoBtn.disabled;
    menuUndo.classList.toggle('is-off', undoBtn.disabled);
    menuClear.disabled = clearBtn.disabled;
    menuClear.classList.toggle('is-off', clearBtn.disabled);
    menuPrev.disabled = !prevPassage;
    menuPrev.classList.toggle('is-off', !prevPassage);
    menuNext.disabled = !nextPassage;
    menuNext.classList.toggle('is-off', !nextPassage);
    renderSaveState();
  };

  /* ---------------- 批注列表 ---------------- */
  const renderNotesList = () => {
    const items = anns.filter((a) => a.kind === 'note');
    if (!items.length) {
      notesBox.replaceChildren(h('div.rn-head',
        h('h3', {}, '本篇批注'),
        h('span.rn-hint', '还没写批注：选中一句话，点「批注」即可写下注释')));
      return;
    }
    notesBox.replaceChildren(
      h('div.rn-head',
        h('h3', {}, `本篇批注（${items.length}）`),
        h('span.rn-hint', '点一条跳到原文位置')),
      ...items.map((a) => h('div.rn-row', { dataset: { note: a.id } },
        h('span.rn-letter', a.para),
        h('div.rn-main',
          h('div.rn-quote', `“${a.quote}”`),
          h('div.rn-note', a.note || '')),
        h('button.rn-del', {
          type: 'button',
          'data-tip': '删除这条批注',
          'aria-label': '删除这条批注',
          onClick: (e) => {
            e.stopPropagation();
            commit(removeAnnotation(anns, a.id), '已删除批注');
          },
        }, '删除'))));
  };

  const refresh = () => {
    paintAll();
    renderNotesList();
    renderStat();
  };

  /* ---------------- 写入 / 撤销 / 存进精读库 ---------------- */
  const commit = (next, msg = '') => {
    undoStack.push(anns);
    if (undoStack.length > 20) undoStack = undoStack.slice(-20);
    anns = next;
    saveNotes(passage.id, anns);
    if (getLibEntry(passage.id)) touchLibEntry(passage.id); // 已保存的篇目自动同步编辑时间
    refresh();
    if (msg) toast(msg);
  };

  const undo = () => {
    if (!undoStack.length) {
      toast('没有可撤销的操作');
      return;
    }
    anns = undoStack.pop();
    saveNotes(passage.id, anns);
    if (getLibEntry(passage.id)) touchLibEntry(passage.id);
    refresh();
    toast('已撤销上一步');
  };

  const saveToLib = () => {
    if (!anns.length) {
      toast('先划线或写批注，再保存到精读库');
      return;
    }
    if (getLibEntry(passage.id)) {
      toast('已经在精读库里了');
      return;
    }
    saveLibEntry(passage.id);
    refresh();
    refreshReadLibBadge();
    toast('已保存到精读库');
  };

  const clearAll = async () => {
    if (!anns.length) return;
    const saved = !!getLibEntry(passage.id);
    const ok = await confirmDialog({
      title: '清除本篇标注',
      message: `将删除本篇全部 ${anns.length} 条标注（划线 / 荧光笔 / 批注）`,
      note: saved
        ? '清除后可以用「撤销」恢复上一步；本篇会同时从「精读库」移除。'
        : '清除后可以用「撤销」恢复上一步，但再撤销就只能一条条恢复。',
      okText: '全部清除',
      cancelText: '再想想',
      tone: 'danger',
    });
    if (!ok) return;
    if (saved) {
      removeLibEntry(passage.id);
      refreshReadLibBadge();
    }
    commit([], '已清除本篇标注');
  };

  /* ---------------- 选区 → 工具条 ---------------- */
  const currentPending = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const startEl = nodeElement(range.startContainer)?.closest?.('.rpara-text');
    const endEl = nodeElement(range.endContainer)?.closest?.('.rpara-text');
    if (!startEl || startEl !== endEl) return null;
    const paraId = startEl.getAttribute('data-para');
    const item = paraMap.get(paraId);
    if (!item) return null;
    const start = offsetInRoot(startEl, range.startContainer, range.startOffset);
    const end = offsetInRoot(startEl, range.endContainer, range.endOffset);
    const range2 = normalizeRange(item.text, start, end);
    if (!range2) return null;
    return { para: paraId, start: range2.start, end: range2.end, quote: range2.quote, rect: range.getBoundingClientRect() };
  };

  const hideTools = () => {
    if (tools) tools.classList.remove('show');
  };

  const removeTools = () => {
    if (tools) { tools.remove(); tools = null; }
  };

  const ensureTools = () => {
    if (tools) return tools;
    const mkBtn = (label, hint, fn) => {
      const b = h('button.rt-btn', { type: 'button', 'data-tip': hint }, label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };

    const swatchRow = h('div.rt-swatches');
    let swatchOpen = false;
    const swatches = ['yellow', 'green', 'blue'].map((color) => {
      const b = h('button.rt-sw', {
        type: 'button',
        class: `sw-${color}`,
        'data-color': color,
        'aria-label': `${COLOR_LABEL[color]}色荧光笔`,
        'data-tip': `${COLOR_LABEL[color]}色荧光笔`,
        onClick: () => apply('high', color),
      });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      swatchRow.appendChild(b);
      return b;
    });
    swatchRow.style.display = 'none';

    const highBtn = mkBtn('荧光笔', '荧光笔：选一种颜色', () => {
      swatchOpen = !swatchOpen;
      swatchRow.style.display = swatchOpen ? '' : 'none';
      swatches[0].focus({ preventScroll: true });
    });

    tools = h('div.read-tools', { role: 'toolbar', 'aria-label': '标注工具' },
      h('div.rt-row',
        mkBtn('划线', '给选中的文字加下划线', () => apply('under')),
        highBtn,
        mkBtn('批注', '给选中的文字写批注', () => startNote())),
      swatchRow,
      h('div.rt-hint', 'Esc 收起'));
    tools.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(tools);
    return tools;
  };

  const showTools = (rect) => {
    const el = ensureTools();
    const sw = el.querySelector('.rt-swatches');
    if (sw) sw.style.display = 'none';
    el.classList.add('show');
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const m = 10;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - w - m));
    let top = rect.top - hgt - 8;
    if (top < m) top = Math.min(rect.bottom + 8, window.innerHeight - hgt - m);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  const onSelectionChange = () => {
    clearTimeout(selTimer);
    selTimer = window.setTimeout(() => {
      const found = currentPending();
      if (!found) {
        pending = null;
        hideTools();
        return;
      }
      pending = found;
      showTools(found.rect);
    }, 60);
  };

  document.addEventListener('selectionchange', onSelectionChange);

  const apply = (kind, color) => {
    if (!pending) {
      toast('先选中要标注的文字');
      return;
    }
    const res = addAnnotation(anns, {
      para: pending.para,
      kind,
      color,
      start: pending.start,
      end: pending.end,
      text: paraMap.get(pending.para)?.text || '',
    });
    if (!res.ok) {
      toast(res.reason);
      return;
    }
    commit(res.list, kind === 'under' ? '已划线' : `已用${COLOR_LABEL[color]}色荧光笔`);
    hideTools();
    clearSelection();
    pending = null;
  };

  /* ---------------- 批注编辑 ---------------- */
  const closeDialog = () => {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    document.removeEventListener('keydown', onDialogKey, true);
  };

  function onDialogKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog();
    }
  }

  const openNoteDialog = ({ title, initial = '', onSave }) => {
    closeDialog();
    const ta = h('textarea.rd-ta', {
      rows: 4,
      maxlength: NOTE_MAX,
      placeholder: '写下你在这句话里看到的东西：生词、同义替换、作者的让步…',
    });
    ta.value = initial;
    const counter = h('span.rd-count', `${initial.length} / ${NOTE_MAX}`);
    ta.addEventListener('input', () => {
      counter.textContent = `${ta.value.length} / ${NOTE_MAX}`;
    });
    const saveBtn = h('button.btn.btn-primary.btn-sm', { type: 'button' }, '保存批注');
    const card = h('div.rd-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h3', {}, title),
      ta,
      h('div.rd-meta', counter),
      h('div.rd-actions',
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onClick: closeDialog }, '取消'),
        saveBtn));
    const overlay = h('div.rd-overlay', card);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeDialog();
    });
    saveBtn.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) {
        toast('批注不能为空');
        ta.focus();
        return;
      }
      const done = onSave(text);
      if (done !== false) closeDialog();
    });
    document.body.appendChild(overlay);
    dialog = overlay;
    document.addEventListener('keydown', onDialogKey, true);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  const startNote = () => {
    if (!pending) {
      toast('先选中要批注的文字');
      return;
    }
    const target = { ...pending };
    hideTools();
    openNoteDialog({
      title: '写批注',
      onSave: (text) => {
        const res = addAnnotation(anns, {
          para: target.para,
          kind: 'note',
          start: target.start,
          end: target.end,
          text: paraMap.get(target.para)?.text || '',
          note: text,
        });
        if (!res.ok) {
          toast(res.reason);
          return false;
        }
        commit(res.list, '已写批注');
        clearSelection();
        pending = null;
        return true;
      },
    });
  };

  /* ---------------- 标注弹层（查看 / 编辑 / 删除） ---------------- */
  const closePop = () => {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener('mousedown', onPopOutside, true);
    window.removeEventListener('resize', closePop);
    window.removeEventListener('scroll', closePop, true);
  };

  function onPopOutside(e) {
    if (pop && !pop.contains(e.target)) closePop();
  }

  const openPop = (ann, rect) => {
    closePop();
    if (!ann) return;
    const title = DOTS[ann.kind] || '标注';
    const label = ann.kind === 'high' ? `荧光笔（${COLOR_LABEL[ann.color] || '黄'}色）` : title;
    const actions = [];
    if (ann.kind === 'note') {
      actions.push(h('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onClick: () => {
          const id = ann.id;
          closePop();
          openNoteDialog({
            title: '改批注',
            initial: ann.note || '',
            onSave: (text) => {
              const res = updateNote(anns, id, text);
              if (!res.ok) {
                toast(res.reason);
                return false;
              }
              commit(res.list, '已更新批注');
              return true;
            },
          });
        },
      }, '编辑'));
    }
    actions.push(h('button.btn.btn-danger.btn-sm', {
      type: 'button',
      onClick: () => {
        commit(removeAnnotation(anns, ann.id), '已删除标注');
        closePop();
      },
    }, '删除'));

    pop = h('div.note-pop', { role: 'dialog', 'aria-label': `${label}操作` },
      h('div.np-head', label),
      h('div.np-quote', `“${ann.quote}”`),
      ann.note ? h('div.np-note', ann.note) : null,
      h('div.np-actions', ...actions));
    document.body.appendChild(pop);
    const m = 10;
    const r = pop.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - r.width / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - r.width - m));
    let top = rect.top - r.height - 8;
    if (top < m) top = Math.min(rect.bottom + 8, window.innerHeight - r.height - m);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.classList.add('show');

    document.addEventListener('mousedown', onPopOutside, true);
    window.addEventListener('resize', closePop);
    window.addEventListener('scroll', closePop, true);
  };

  const annById = (id) => anns.find((a) => a.id === id) || null;

  /* ---------------- 点词查义 / 点标注 ---------------- */
  const onPaperClick = (e) => {
    const annotated = e.target.closest?.('.annot');
    if (annotated) {
      const noteId = annotated.getAttribute('data-note');
      const plainIds = (annotated.getAttribute('data-plain') || '').split(' ').filter(Boolean);
      const hit = (noteId && annById(noteId)) || plainIds.map(annById).filter(Boolean)[0];
      if (hit) {
        openPop(hit, annotated.getBoundingClientRect());
        return;
      }
    }
    if (!e.clientX && !e.clientY) return; // 键盘触发
    const textEl = e.target.closest?.('.rpara-text');
    if (!textEl) return;
    if (window.getSelection() && !window.getSelection().isCollapsed) return;
    const caret = caretRangeAt(e.clientX, e.clientY);
    if (!caret || !textEl.contains(caret.startContainer)) return;
    const paraId = textEl.getAttribute('data-para');
    const source = paraMap.get(paraId)?.text || '';
    if (!source) return;
    const abs = offsetInRoot(textEl, caret.startContainer, caret.startOffset);
    const found = wordAt(source, abs);
    if (!found) return;
    const wordRange = rangeByOffset(textEl, found.start, found.end);
    const rect = wordRange.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const hit = lookup(glossary, found.word, wordDetail);
    openWordCard({
      rect,
      word: found.word,
      entry: hit,
      collected: isCollected(hit?.word || found.word),
      onToggle: () => {
        const entry = makeVocabEntry({
          passage,
          paragraph: paraId,
          word: found.word,
          surface: found.word,
          hit,
          sentence: sentenceAt(source, found.start, found.end),
        });
        const { collected } = toggleVocab(entry);
        refreshVocabBadge();
        toast(collected ? `已收藏「${entry.word}」` : `已取消收藏「${entry.word}」`);
        return collected;
      },
    });
  };

  /* ---------------- 列表 / 定位 ---------------- */
  const flashAnn = (id) => {
    const el = paper.querySelector(`[data-note="${id}"]`)
      || [...paper.querySelectorAll('[data-plain]')].find((n) => (n.getAttribute('data-plain') || '').split(' ').includes(id));
    if (!el) return;
    el.classList.add('flash');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => el.classList.remove('flash'), 1400);
  };

  notesBox.addEventListener('click', (e) => {
    const del = e.target.closest?.('.rn-del');
    if (del) return;
    const row = e.target.closest?.('.rn-row');
    if (!row) return;
    flashAnn(row.dataset.note);
  });

  /**
   * 离开前的「是否保存」：未保存且有标注时，点站内任何 hash 链接都会先问一次
   * （保存并离开 / 不保存直接离开 / 再想想）。已保存的篇目自动同步，不再打扰。
   */
  const askLeave = () => dialogChoice({
    title: '还没保存到精读库',
    message: `本篇有 ${anns.length} 条标注还没存进精读库。`,
    note: '保存后会出现在侧边栏「精读库」里，笔记与原文位置都保留着；不保存则本次标注会被清掉。',
    actions: [
      { key: 'save', text: '保存并离开', tone: 'primary' },
      { key: 'discard', text: '不保存，直接离开', tone: 'danger' },
      { key: 'cancel', text: '再想想', tone: 'ghost' },
    ],
    cancelKey: 'cancel',
  });

  let leaving = false;
  const leaveFor = async (href) => {
    const key = await askLeave();
    if (key === 'save') {
      saveLibEntry(passage.id);
      refresh();
      refreshReadLibBadge();
    } else if (key === 'discard') {
      clearNotes(passage.id);
    } else {
      return; // 再想想：留在本页
    }
    leaving = true;
    location.hash = href;
  };

  const onDocClick = (e) => {
    if (leaving || getLibEntry(passage.id) || !anns.length) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#/')) return;
    if (href === `#/read/${passage.id}`) return;
    e.preventDefault();
    e.stopPropagation();
    leaveFor(href);
  };

  document.addEventListener('click', onDocClick, true);

  /* ---------------- 段落跳转 / 上下篇 / 更多菜单 ---------------- */
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const jumpToPara = (paraId) => {
    const node = paraMap.get(paraId)?.root;
    if (!node) return;
    const offset = head.offsetHeight + 20;
    const top = node.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: reduceMotion() ? 'auto' : 'smooth' });
    node.classList.add('jump');
    window.setTimeout(() => node.classList.remove('jump'), 1200);
    hideTools();
    clearSelection();
    pending = null;
  };

  const closeMore = () => {
    if (!moreWrap.classList.contains('show')) return;
    moreWrap.classList.remove('show');
    moreBtn.setAttribute('aria-expanded', 'false');
  };

  const openMore = () => {
    moreWrap.classList.add('show');
    moreBtn.setAttribute('aria-expanded', 'true');
  };

  /** 同一栏目内切篇：未保存且有标注时照旧走离开提醒 */
  const goStep = async (target) => {
    closeMore();
    if (!target) return;
    const href = `#/read/${target.id}`;
    if (getLibEntry(passage.id) || !anns.length) {
      leaving = true;
      location.hash = href;
      return;
    }
    await leaveFor(href);
  };

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreWrap.classList.contains('show')) closeMore();
    else openMore();
  });
  moreMenu.addEventListener('click', (e) => e.stopPropagation());
  menuUndo.addEventListener('click', () => { closeMore(); undo(); });
  menuClear.addEventListener('click', () => { closeMore(); clearAll(); });
  menuPrev.addEventListener('click', () => goStep(prevPassage));
  menuNext.addEventListener('click', () => goStep(nextPassage));
  menuList.addEventListener('click', () => closeMore());
  prevBtn.addEventListener('click', () => goStep(prevPassage));
  nextBtn.addEventListener('click', () => goStep(nextPassage));
  paraJump.addEventListener('click', (e) => {
    const chip = e.target.closest?.('.rb-para');
    if (chip) jumpToPara(chip.getAttribute('data-para'));
  });

  const onDocClickAway = (e) => {
    if (!moreWrap.contains(e.target)) closeMore();
  };
  document.addEventListener('click', onDocClickAway);

  /* ---------------- Esc 收起工具条 / 菜单 / 标注弹层 ---------------- */
  const onKeydown = (e) => {
    if (e.key !== 'Escape') return;
    if (dialog || document.querySelector('.dlg-overlay')) return; // 对话框自己处理 Esc
    closeMore();
    if (pop) closePop();
    if (tools?.classList.contains('show')) {
      hideTools();
      clearSelection();
      pending = null;
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKeydown);

  /* ---------------- 记住本篇读到的位置 ---------------- */
  const savedTop = getReadPos(passage.id);
  let posSaveTimer = 0;
  let posRestoreTimer = 0;
  let lastPos = -1;
  const flushPos = () => {
    const top = Math.round(window.scrollY);
    if (top === lastPos) return;
    lastPos = top;
    setReadPos(passage.id, top);
  };
  const onScroll = () => {
    clearTimeout(posSaveTimer);
    posSaveTimer = window.setTimeout(flushPos, 400);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  if (savedTop > 0) {
    // 主容器在 render() 里会先归零，所以放到下一帧之后再定位
    const restore = () => window.scrollTo(0, savedTop);
    requestAnimationFrame(restore);
    posRestoreTimer = window.setTimeout(() => {
      if (Math.abs(window.scrollY - savedTop) > 4) restore();
    }, 260);
  }
  paper.addEventListener('click', onPaperClick);
  saveBtn.addEventListener('click', saveToLib);
  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearAll);

  const wrap = h('div.read-wrap',
    h('div.read-hero',
      h('div.passage-head',
        h('h2', {}, passage.title),
        h('p.intro', {}, passage.intro)),
      h('div.read-tip', '选中文字 → 划线 / 荧光笔 / 批注；点已有标注可以查看或删除；点单词看释义。')),
    ...paraNodes,
    notesBox);

  paper.appendChild(wrap);

  const root = shell({
    mode: 'mode-read',
    active: { kind: 'readlib', passageId: passage.id },
    title: `${passage.titleZh} · 精读`,
  }, head, paper);

  refresh();

  return {
    root,
    teardown() {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('click', onDocClickAway);
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('scroll', onScroll);
      clearTimeout(selTimer);
      clearTimeout(posSaveTimer);
      clearTimeout(posRestoreTimer);
      flushPos();
      paper.removeEventListener('click', onPaperClick);
      closeDialog();
      closePop();
      removeTools();
      closeWordCard();
    },
  };
}
