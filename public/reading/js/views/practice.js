import {
  h, clock, toast, fmtAnswer, highlightQuote,
} from '../core/dom.js';
import { shell, refreshVocabBadge } from '../ui/sidebar.js';
import { confirmDialog } from '../ui/dialog.js';
import { openWordCard, closeWordCard } from '../ui/wordcard.js';
import { getPassage, getGlossary, getGlossaryDetail, questionCount } from '../adapters/content.js';
import {
  getDraft, saveDraft, clearDraft, saveSession, syncMistakes, isCollected, toggleVocab,
} from '../features/store.js';
import {
  lookup, wordAt, sentenceAt, makeVocabEntry,
} from '../features/vocab.js';
import { gradePassage, wordCount } from '../features/grading.js';
import { submitToHost, openHostReport, embedded } from '../../assets/reading-host.js';
import {
  TYPE, TYPE_LABEL, ENUM_OPTIONS, bandFor, isTextType,
} from '../core/constants.js';
import { caretRangeAt, offsetInRoot, rangeByOffset } from '../core/selection.js';

function typeStats(results) {
  const map = new Map();
  for (const r of results) {
    const cur = map.get(r.type) || { type: r.type, total: 0, correct: 0 };
    cur.total += 1;
    if (r.status === 'correct') cur.correct += 1;
    map.set(r.type, cur);
  }
  return [...map.values()].map((t) => ({ ...t, acc: Math.round((t.correct / t.total) * 100) }));
}

export function renderPractice(passageId) {
  const passage = getPassage(passageId);
  if (!passage) {
    return {
      root: h('div.page', h('h1', {}, '篇目不存在'), h('a.btn.btn-primary', { href: '#/' }, '返回题库')),
      teardown() {},
    };
  }

  const draft = getDraft(passageId) || {};
  const answers = { ...(draft.answers || {}) };
  const flags = { ...(draft.flags || {}) };
  const total = questionCount(passage);
  const startedAt = Date.now() - (draft.elapsed || 0) * 1000;
  const limitSec = passage.minutes * 60;

  let submitted = false;
  let submitting = false;
  const submissionId = 's_'+crypto.randomUUID().replaceAll('-','_');
  let session = null;
  let saveTimer = null;
  let ticker = null;
  let hiPara = null;
  let originQuestion = null;

  const timerEl = h('span.timer', clock(draft.elapsed || 0));
  const answeredEl = h('span.answered-pill');
  const chips = new Map();
  const qEls = new Map();
  const paraMap = new Map();

  const allQuestions = passage.sections.flatMap((s) => s.questions);
  const isNarrow = () => window.matchMedia('(max-width: 960px)').matches;

  const refreshAnswered = () => {
    const n = Object.values(answers).filter((v) => String(v).trim() !== '').length;
    answeredEl.innerHTML = `已答 <b>${n}</b> / ${total}`;
  };

  const refreshChip = (qid) => {
    const chip = chips.get(qid);
    if (!chip) return;
    chip.classList.toggle('done', String(answers[qid] ?? '').trim() !== '');
  };

  const persist = () => {
    if (submitted) return;
    saveDraft(passageId, {
      answers,
      flags,
      elapsed: Math.floor((Date.now() - startedAt) / 1000),
    });
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  };

  const setAnswer = (qid, value) => {
    if (submitted) return; // 交卷后答案锁定，只能「重做本篇」
    if (value === '' || value === null || value === undefined) delete answers[qid];
    else answers[qid] = value;
    refreshChip(qid);
    refreshAnswered();
    scheduleSave();
  };

  /* ---------- 各题型控件 ---------- */
  const enumControl = (q, section) => {
    const seg = h('div.seg');
    const btns = ENUM_OPTIONS[section.type].map((opt) => {
      const b = h('button', { type: 'button' }, opt.label);
      b.dataset.v = opt.value;
      if (answers[q.id] === opt.value) b.classList.add('on');
      b.addEventListener('click', () => {
        if (submitted) return;
        const next = answers[q.id] === opt.value ? '' : opt.value;
        setAnswer(q.id, next);
        btns.forEach((x) => x.classList.toggle('on', x.dataset.v === next));
      });
      return b;
    });
    seg.append(...btns);
    return h('div.answer-area', seg);
  };

  const mcqControl = (q) => {
    const box = h('div.opts');
    const btns = q.options.map((o) => {
      const b = h('button.opt', { type: 'button' },
        h('span.opt-key', o.id),
        h('span', o.text));
      b.dataset.v = o.id;
      if (answers[q.id] === o.id) b.classList.add('on');
      b.addEventListener('click', () => {
        if (submitted) return;
        const next = answers[q.id] === o.id ? '' : o.id;
        setAnswer(q.id, next);
        btns.forEach((x) => x.classList.toggle('on', x.dataset.v === next));
      });
      return b;
    });
    box.append(...btns);
    return h('div.answer-area', box);
  };

  const matchControl = (q, section) => {
    const isHeadings = section.type === TYPE.MATCHING_HEADINGS;
    const options = isHeadings
      ? section.options
      : passage.paragraphs.map((p) => ({ id: p.id }));
    const sel = h('select.match');
    sel.appendChild(h('option', { value: '' }, isHeadings ? '选择标题…' : '选择段落…'));
    for (const o of options) {
      sel.appendChild(h('option', { value: o.id },
        isHeadings ? `${o.id}. ${o.text}` : `段落 ${o.id}`));
    }
    sel.value = answers[q.id] || '';
    sel.addEventListener('change', () => setAnswer(q.id, sel.value));
    return h('div.answer-area', h('div.select-wrap', sel));
  };

  const completionControl = (q, section) => {
    const parts = String(q.stem).split('______');
    const limit = section.wordLimit || 0;
    const hintEl = limit ? h('div.limit-hint') : null;
    const upd = () => {
      if (!hintEl) return;
      const n = wordCount(answers[q.id] || '');
      hintEl.textContent = `限 ${limit} 个词 · 当前 ${n}`;
      hintEl.classList.toggle('over', n > limit);
    };
    const fill = h('div.fill', { style: { flex: '1' } });
    parts.forEach((part, i) => {
      if (part) fill.appendChild(document.createTextNode(part));
      if (i === parts.length - 1) return;
      const input = h('input.blank', {
        type: 'text', placeholder: '作答', autocomplete: 'off', spellcheck: 'false',
      });
      input.value = answers[q.id] || '';
      if (input.value.trim()) input.classList.add('filled');
      input.addEventListener('input', () => {
        if (submitted) return;
        setAnswer(q.id, input.value);
        input.classList.toggle('filled', input.value.trim() !== '');
        upd();
      });
      fill.appendChild(input);
    });
    upd();
    return { node: h('div', { style: { flex: '1' } }, fill, hintEl), hintEl };
  };

  /* ---------- 原文高亮联动 ---------- */
  const paintPara = (id, quote) => {
    const item = paraMap.get(id);
    if (item) item.textEl.innerHTML = highlightQuote(item.text, quote || '');
  };
  const clearHighlight = () => {
    if (!hiPara) return;
    paraMap.get(hiPara)?.root.classList.remove('focus');
    paintPara(hiPara, '');
    hiPara = null;
  };
  const highlightPara = (id, quote, scroll = true) => {
    const item = paraMap.get(id);
    if (!item) return;
    if (hiPara && hiPara !== id) {
      paraMap.get(hiPara).root.classList.remove('focus');
      paintPara(hiPara, '');
    }
    hiPara = id;
    item.root.classList.add('focus');
    paintPara(id, quote);
    if(scroll)item.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  /* ---------- 单题 ---------- */
  const renderQuestion = (q, section) => {
    const flagBtn = h('button.flag-btn', { type: 'button', 'data-tip': '标记待回看', 'aria-label': '标记待回看' }, '⚑');
    if (flags[q.id]) flagBtn.classList.add('on');
    flagBtn.addEventListener('click', () => {
      if (submitted) return;
      flags[q.id] = !flags[q.id];
      flagBtn.classList.toggle('on', flags[q.id]);
      chips.get(q.id)?.classList.toggle('flagged', flags[q.id]);
      scheduleSave();
    });
    chips.get(q.id)?.classList.toggle('flagged', !!flags[q.id]);

    const row = h('div.q-stem-line', h('span.q-num', String(q.number)));
    const qEl = h('div.q', { id: `q-${q.id}` });
    const textType = isTextType(section.type);

    if (textType) {
      row.appendChild(completionControl(q, section).node);
    } else {
      row.appendChild(h('div.q-stem', q.stem));
    }
    row.appendChild(flagBtn);
    qEl.appendChild(row);

    if (section.type === TYPE.TFNG || section.type === TYPE.YNNG) qEl.appendChild(enumControl(q, section));
    else if (section.type === TYPE.MCQ) qEl.appendChild(mcqControl(q));
    else if (section.type === TYPE.MATCHING_HEADINGS || section.type === TYPE.MATCHING_INFORMATION) {
      qEl.appendChild(matchControl(q, section));
    }
    qEls.set(q.id, qEl);
    return qEl;
  };

  const renderSection = (section) => {
    const box = h('section.q-section');
    if (section.instruction) box.appendChild(h('div.q-instruction', section.instruction));
    if (section.type === TYPE.MATCHING_HEADINGS && section.options) {
      box.appendChild(h('ol.headings-list',
        section.options.map((o) => h('li', h('b', o.id), o.text))));
    }
    for (const q of section.questions) box.appendChild(renderQuestion(q, section));
    return box;
  };

  /* ---------- 交卷后的就地复盘 ---------- */
  const evidenceBlock = (ex) => {
    const node = h('div.rv-evidence', { 'data-para': ex.paragraph, 'data-quote': ex.quote,role:'button',tabIndex:0,'aria-label':'定位到原文段落 '+ex.paragraph },
      h('div.rv-ev-head',
        h('b', {}, '原文依据'),
        h('span.para-badge', {}, `段落 ${ex.paragraph}`)),
      h('div.quote-line', {}, `“${ex.quote}”`),
      h('div.rv-tip', {}, '点击定位原文，悬停高亮对应句'));

    const fire = (scroll = true) => {
      originQuestion=node.closest('.q');
      if (isNarrow()) {
        switchPane('passage');
        highlightPara(ex.paragraph, ex.quote, scroll);
        backBtn.classList.add('show');
      } else {
        highlightPara(ex.paragraph, ex.quote, scroll);
      }
    };
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !isNarrow()) fire(false);
    });
    node.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !isNarrow()) clearHighlight();
    });
    node.addEventListener('click', () => fire());
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fire()}});
    return node;
  };

  const reviewBlock = (r) => {
    const cls = r.status === 'correct' ? 'ok' : (r.status === 'blank' ? 'na' : 'no');
    const badge = r.status === 'correct' ? '✓ 正确' : (r.status === 'blank' ? '未作答' : '✗ 错误');
    const ex = r.explanation || {};

    return h(`div.q-review.${cls}`,
      h('div.rv-head',
        h(`span.badge.${cls}`, badge),
        h('span.rv-type', TYPE_LABEL[r.type] || r.type)),
      (r.status === 'correct'
        ? h('div.rv-ans.correct',
          h('span.rv-label', {}, '你的答案'),
          h('b.mine', {}, fmtAnswer(r.response)))
        : h('div.rv-ans',
          h('span.rv-label', {}, '你的答案'),
          h('b.mine', {}, fmtAnswer(r.response)),
          h('span.rv-arrow', {}, '→'),
          h('span.rv-label', {}, '正确答案'),
          h('b.right', {}, fmtAnswer(r.answer.value)))),
      (r.reasonCode === 'word_limit_exceeded' || r.reasonCode === 'spelling_suspect')
        ? h('div.limit-hint.over', r.detail) : null,
      ex.verdict ? h('div.rv-line', h('b', {}, '判定理由'), h('span', {}, ex.verdict)) : null,
      ex.quote ? evidenceBlock(ex) : null,
      (ex.trap && r.status !== 'correct')
        ? h('div.rv-line.rv-trap', h('b', {}, '易错点'), h('span', {}, ex.trap)) : null);
  };

  const lockQuestion = (qEl, r) => {
    qEl.querySelectorAll('button, input, select').forEach((el) => {
      el.disabled = true;
      if (el.tagName === 'INPUT') el.readOnly = true;
    });
    const right = r.answer.value;
    qEl.querySelectorAll('.opt, .seg button').forEach((b) => {
      b.classList.remove('on');
      if (b.dataset.v === right) b.classList.add('right');
      else if (r.response && b.dataset.v === r.response) b.classList.add('picked-wrong');
    });
    if (r.answer.value && !qEl.querySelector('.opt, .seg')) {
      qEl.querySelectorAll('input.blank, select').forEach((el) => {
        el.classList.add(r.status === 'correct' ? 'right' : 'wrong');
      });
    }
  };

  const buildTypeCard = (results) => h('details.type-summary',
    h('summary', {},
      h('span.ts-title', {}, '题型正确率'),
      h('span.ts-sub', {}, `${results.length} 题 · 展开看逐题型`)),
    h('div.type-bars',
      typeStats(results).map((t) => h('div.type-bar',
        h('span.tname', TYPE_LABEL[t.type] || t.type),
        h('div.bar', h('i', {
          style: { width: `${t.acc}%`, background: 'linear-gradient(90deg,#4f46e5,#22d3ee)' },
        })),
        h('span.tval', `${t.correct}/${t.total}`)))));

  const showReview = (grade) => {
    for (const r of grade.results) {
      const qEl = qEls.get(r.questionId);
      if (!qEl) continue;
      lockQuestion(qEl, r);
      qEl.appendChild(reviewBlock(r));
      const chip = chips.get(r.questionId);
      if (chip) {
        chip.classList.remove('done', 'flagged');
        chip.classList.add(r.status === 'correct' ? 'ok' : (r.status === 'blank' ? 'na' : 'no'));
      }
    }

    timerEls.remove();
    submitBtn.remove();
    barTitle.querySelector('.pb-bank-back')?.replaceWith(h('b', passage.title));
    bar.append(
      h('div.pb-result',
        h('b', {}, `${session.correct}/${session.total}`),
        h('span.pb-sep', {}, '·'),
        h('span.pb-band', {}, `正确率 ${Math.round(session.correct / Math.max(1,session.total) * 100)}%`),
        h('span.pb-sep', {}, '·'),
        h('span', {}, `用时 ${clock(Math.floor(session.durationMs / 1000))}`)),
      h('div.pb-actions',
        h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '返回题库'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onClick: () => location.reload() }, '重做本篇'),
        h('a.btn.btn-ghost.btn-sm', { href: '#/mistakes' }, '错题本'),
        embedded ? h('button.btn.btn-primary.btn-sm', {type:'button',onClick:()=>openHostReport(session.id)}, '学习报告') : null));
    bar.classList.add('submitted');

    questionPane.insertBefore(buildTypeCard(grade.results), questionPane.firstChild);
  };

  const submit = async () => {
    if (submitted || submitting) return;
    const blanks = total - Object.values(answers).filter((v) => String(v).trim() !== '').length;
    if (blanks > 0) {
      submitting = true;
      const ok = await confirmDialog({
        title: '还有题没作答',
        message: `还有 ${blanks} 题未作答，确定交卷吗？`,
        note: '未作答的题会判错、收录进错题本，也计入题型统计的分母。',
        okText: '交卷',
        cancelText: '继续做题',
      });
      submitting = false;
      if (!ok) return;
    }

    submitting=true;
    submitBtn.disabled=true;
    submitBtn.textContent='正在交卷…';
    const grade=gradePassage(passage,answers),now=Date.now();
    const localSession={...grade,id:submissionId,passageId:passage.id,passageTitle:passage.title,
      passageLabel:passage.label,startedAt,finishedAt:now,durationMs:now-startedAt,
      band:bandFor(grade.correct,grade.total),answers:{...answers},paragraphs:passage.paragraphs.map(p=>p.text)};
    try{
      session=embedded?await submitToHost(localSession):localSession;
      submitted=true;
      clearInterval(ticker);clearTimeout(saveTimer);
      saveSession(session);
      syncMistakes(session,passage);
      clearDraft(passageId);
      showReview(session);
      toast('已交卷，答案已锁定，可对照原文逐题复盘。');
    }catch(error){
      toast(error.message||'交卷未完成，请重试。');
      persist();
    }finally{
      submitting=false;
      if(!submitted){submitBtn.disabled=false;submitBtn.textContent='交卷'}
    }
  };

  /* ---------- 布局 ---------- */
  const timerEls = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
    timerEl, answeredEl);

  const barMenuBtn = h('button.menu-btn', { type: 'button', 'aria-label': '打开导航' }, '☰');
  const barTitle = h('div.pb-title',
    h('a.pb-bank-back', {href:'#/',title:'返回题库','aria-label':'返回题库'},
      h('span', {'aria-hidden':'true'}, '←'),h('b', passage.title)),
    h('span', `${passage.label} · ${passage.titleZh} · ${passage.level}`));
  const submitBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', onClick: submit }, '交卷');
  const readBtn = h('a.btn.btn-ghost.btn-sm', {
    href: `#/read/${passage.id}`,
    'data-tip': '精读：划线 / 荧光笔 / 批注',
  }, '精读');

  const bar = h('div.practice-bar',
    barMenuBtn,
    barTitle,
    h('span.spacer'),
    timerEls,
    readBtn,
    submitBtn);

  const backBtn = h('button.back-to-q', { type: 'button' }, '← 回到题目');
  backBtn.addEventListener('click', () => {
    switchPane('question');
    backBtn.classList.remove('show');
    clearHighlight();
    originQuestion?.scrollIntoView({block:'center',behavior:'smooth'});
  });

  const passagePane = h('section.pane.passage-pane.mobile-active', {'aria-label':'阅读原文',tabIndex:0},
    h('div.pane-inner',
      h('div.passage-head',
        h('h2', {}, passage.title),
        h('p.intro', {}, passage.intro)),
      passage.paragraphs.map((p) => {
        const textEl = h('p.para-text', {}, p.text);
        const root = h('div.para', { id: `para-${p.id}` },
          h('span.para-letter', p.id),
          textEl);
        paraMap.set(p.id, { root, textEl, text: p.text });
        return root;
      })),
    backBtn);


  /* ---------- 点词查义 ---------- */
  const glossary = getGlossary();
  const wordDetail = getGlossaryDetail();
  const onWordClick = (e) => {
    if (!e.clientX && !e.clientY) return; // 键盘触发的 click 没有坐标
    const textEl = e.target.closest?.('.para-text');
    if (!textEl) return;
    if (window.getSelection() && !window.getSelection().isCollapsed) return; // 正在划词
    const caret = caretRangeAt(e.clientX, e.clientY);
    if (!caret || !textEl.contains(caret.startContainer)) return;
    const para = textEl.closest('.para');
    const id = String(para?.id || '').replace('para-', '');
    const source = paraMap.get(id)?.text || '';
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
          paragraph: id,
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

  const questionPane = h('section.pane.question-pane', {'aria-label':'题目与解析',tabIndex:0},
    h('div.q-nav',
      allQuestions.map((q) => {
        const chip = h('button.q-chip', { type: 'button', 'data-tip': `第 ${q.number} 题`, 'aria-label': `第 ${q.number} 题` }, String(q.number));
        chip.addEventListener('click', () => {
          document.getElementById(`q-${q.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        chips.set(q.id, chip);
        return chip;
      })),
    h('div', { style: { paddingBottom: '40px' } }, passage.sections.map(renderSection)));

  const switchPane = (target) => {
    passagePane.classList.toggle('mobile-active', target === 'passage');
    questionPane.classList.toggle('mobile-active', target === 'question');
    tabPassage.classList.toggle('on', target === 'passage');
    tabQuestion.classList.toggle('on', target === 'question');
    tabPassage.setAttribute('aria-pressed',String(target === 'passage'));
    tabQuestion.setAttribute('aria-pressed',String(target === 'question'));
  };
  const tabPassage = h('button.on', { type: 'button', 'aria-pressed':'true', onClick: () => switchPane('passage') }, '阅读原文');
  const tabQuestion = h('button', { type: 'button', 'aria-pressed':'false', onClick: () => switchPane('question') }, '做题');

  passagePane.addEventListener('click', onWordClick);

  const root = shell({ mode: 'mode-practice', active: { kind: 'lesson', passageId: passage.id }, title: passage.titleZh },
    bar,
    h('div.mobile-tabs', tabPassage, tabQuestion),
    h('div.split', passagePane, questionPane));

  refreshAnswered();
  for (const q of allQuestions) refreshChip(q.id);
  if (draft.updatedAt) toast('已恢复上次进度');

  ticker = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = clock(elapsed);
    timerEl.classList.toggle('over', elapsed > limitSec);
  }, 1000);

  const onHide = () => { if (document.visibilityState === 'hidden') persist(); };
  document.addEventListener('visibilitychange', onHide);

  return {
    root,
    teardown() {
      clearTimeout(saveTimer);
      if (!submitted) persist(); // 去精读页 / 换页前把刚输入的内容落成草稿
      submitted = true;
      passagePane.removeEventListener('click', onWordClick);
      closeWordCard();
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}
