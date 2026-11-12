import { h, toast } from '../core/dom.js';
import { shell, refreshVocabBadge } from '../ui/sidebar.js';
import { getGlossary, getGlossaryDetail } from '../adapters/content.js';
import { listVocab, removeVocab } from '../features/store.js';
import { filterVocab, vocabStats } from '../features/vocab.js';
import { buildQuiz, judge, QUIZ_TYPE_LABEL } from '../features/vocabQuiz.js';

const STAR = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3.7l2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 17.07l-5.24 2.76 1-5.84L3.52 9.86l5.86-.85z" fill="currentColor"/></svg>';

const dateText = (ts) => {
  const d = new Date(ts || Date.now());
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

/** 「Passage 1」→「第 1 篇」 */
const shortLabel = (label) => {
  const m = /(\d+)/.exec(String(label || ''));
  return m ? `第 ${m[1]} 篇` : (label || '未标注');
};

function starButton(on, onClick) {
  const btn = h('button.star-btn', {
    type: 'button',
    'aria-label': on ? '取消收藏' : '收藏到阅读生词本',
    'aria-pressed': on ? 'true' : 'false',
    'data-tip': on ? '取消收藏' : '收藏到阅读生词本',
  }, h('span.star', { html: STAR }));
  btn.classList.toggle('on', on);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** 词库全量词条（作为选择题干扰项来源） */
function poolFromGlossary() {
  const words = getGlossary().words || {};
  return Object.entries(words).map(([form, v]) => ({
    word: Array.isArray(v) && v[2] && words[v[2]] ? v[2] : form,
    form,
    pos: Array.isArray(v) ? v[0] : '',
    zh: Array.isArray(v) ? v[1] : '',
  }));
}

export function renderVocab() {
  let items = listVocab();
  let query = '';
  let passageId = '';
  let quiz = null; // { questions, index, score, results, answered }
  const DETAIL = getGlossaryDetail();

  const stats = vocabStats(items);
  const head = h('div.vb-head',
    h('div',
      h('h1', {}, '阅读生词本'),
      h('p.vb-sub', {}, stats.total
        ? `已收藏 ${stats.total} 词 · 来自 ${stats.passages.length} 篇原文`
        : '在原文里点任意单词，点 ★ 即可收藏到这里')),
    h('div.vb-actions'));

  const searchInput = h('input.vb-search', {
    type: 'search',
    placeholder: '搜索单词或中文释义…',
    'aria-label': '搜索单词或中文释义',
    autocomplete: 'off',
  });

  const chipsBox = h('div.vb-chips');
  const toolbar = h('div.vb-toolbar', searchInput, chipsBox);
  const bodyBox = h('div.vb-body');

  const root = shell({ active: { kind: 'vocab' }, title: '阅读生词本' },
    h('div.page.vb-page', head, toolbar, bodyBox));

  /* ---------- 列表 ---------- */
  const renderChips = () => {
    const p = vocabStats(listVocab()).passages;
    const mk = (label, value) => {
      const btn = h('button.vb-chip', { type: 'button' }, label);
      btn.classList.toggle('on', value === passageId);
      btn.addEventListener('click', () => {
        passageId = value;
        render();
      });
      return btn;
    };
    chipsBox.replaceChildren(
      mk('全部', ''),
      ...p.map((x) => mk(`${shortLabel(x.label)}${x.title ? ` · ${x.title}` : ''}`, x.id)),
    );
    chipsBox.style.display = p.length ? '' : 'none';
  };

  const ipaText = (word) => {
    const ipa = DETAIL[word]?.ipa;
    if (!ipa) return '';
    const uk = String(ipa.uk || '').trim();
    const us = String(ipa.us || '').trim();
    if (!uk && !us) return '';
    if (!uk || !us || uk === us) return uk || us;
    return `英 ${uk} · 美 ${us}`;
  };

  const row = (v) => h('div.vb-row',
    h('div.vb-main',
      h('div.vb-wordline',
        h('b.vb-word', v.word),
        v.pos ? h('span.vb-pos', v.pos) : null,
        ipaText(v.word) ? h('span.vb-ipa', ipaText(v.word)) : null,
        h('span.vb-time', dateText(v.at))),
      h('div.vb-mean', v.zh || '释义待补充'),
      v.sentence ? h('div.vb-sent', `“${v.sentence}”`) : null,
      h('div.vb-src', [
        v.passageLabel ? `${shortLabel(v.passageLabel)} · ${v.passageTitle}` : '出处未记录',
        v.paragraph ? `段落 ${v.paragraph}` : '',
        v.form && v.form !== v.word ? `原文形式 ${v.form}` : '',
      ].filter(Boolean).join(' · '))),
    starButton(true, () => {
      removeVocab(v.word);
      items = listVocab();
      refreshVocabBadge();
      toast(`已移除「${v.word}」`);
      render();
    }));

  const emptyCard = (title, desc, action) => h('div.vb-empty',
    h('div.vb-empty-mark', { html: STAR }),
    h('h2', {}, title),
    h('p', {}, desc),
    action || null);

  const renderList = () => {
    const shown = filterVocab(items, { query, passageId });
    if (!items.length) {
      bodyBox.replaceChildren(emptyCard(
        '阅读生词本还是空的',
        '去练习页读原文，点任意一个单词就能看到释义；点卡片上的 ★ 收藏，之后回到这里复习和自测。',
        h('a.btn.btn-primary', { href: '#/' }, '去练习'),
      ));
      return;
    }
    if (!shown.length) {
      bodyBox.replaceChildren(emptyCard('没有匹配的单词', '换个关键词，或把筛选切回「全部」。'));
      return;
    }
    bodyBox.replaceChildren(
      h('div.vb-count-line', {}, `共 ${shown.length} 词`),
      h('div.vb-rows', shown.map(row)),
    );
  };

  /* ---------- 自测 ---------- */
  const quizBox = h('div.vb-quiz');

  const quizHeader = () => {
    const q = quiz.questions[quiz.index];
    return h('div.qz-head',
      h('div.qz-progress',
        h('span.qz-step', `第 ${quiz.index + 1} / ${quiz.questions.length} 题`),
        h('span.qz-type', QUIZ_TYPE_LABEL[q.type])),
      h('div.qz-bar', h('i', { style: { width: `${(quiz.index / quiz.questions.length) * 100}%` } })));
  };

  const finishQuiz = () => {
    const wrong = quiz.results.filter((r) => !r.ok);
    quizBox.replaceChildren(h('div.qz-done',
      h('div.qz-score',
        h('b', {}, `${quiz.score}/${quiz.results.length}`),
        h('span', {}, `正确率 ${Math.round((quiz.score / Math.max(1, quiz.results.length)) * 100)}%`)),
      wrong.length
        ? h('div.qz-wrong',
          h('div.qz-wrong-title', `需要再看的 ${wrong.length} 个词`),
          wrong.map((r) => h('div.qz-wrong-row',
            h('b', {}, r.q.word),
            h('span', {}, r.q.zh || ''),
            h('span.qz-yours', `你的作答：${r.input || '（未填）'}`))))
        : h('p.qz-perfect', '全部答对，这一组词可以过了。'),
      h('div.qz-actions',
        h('button.btn.btn-primary', { type: 'button', onClick: () => startQuiz() }, '再来一组'),
        h('button.btn.btn-ghost', { type: 'button', onClick: () => exitQuiz() }, '返回阅读生词本'))));
  };

  const step = () => {
    if (quiz.index >= quiz.questions.length) {
      finishQuiz();
      return;
    }
    const q = quiz.questions[quiz.index];
    quiz.answered = null;
    const feedback = h('div.qz-feedback');
    const actions = h('div.qz-actions');

    const next = () => {
      quiz.index += 1;
      step();
    };

    const commit = (input, ok) => {
      quiz.answered = { input, ok };
      if (ok) quiz.score += 1;
      quiz.results.push({ q, input, ok });
    };

    let bodyNode;
    if (q.type === 'choice') {
      const btns = q.options.map((opt) => {
        const b = h('button.qz-opt', { type: 'button' }, opt);
        b.addEventListener('click', () => {
          if (quiz.answered) return;
          const { ok } = judge(q, opt);
          commit(opt, ok);
          btns.forEach((x) => {
            x.disabled = true;
            if (x.textContent === q.answer) x.classList.add('ok');
            else if (x === b && !ok) x.classList.add('no');
          });
          feedback.replaceChildren(
            h('div.qz-line', h('b', {}, ok ? '✓ 正确' : '✗ 错了'),
              h('span', {}, ok ? '' : `正确答案：${q.answer}`)),
            q.zh ? h('div.qz-line.qz-weak', `${q.word} · ${q.pos ? `${q.pos} ` : ''}${q.zh}`) : null,
          );
          actions.replaceChildren(h('button.btn.btn-primary', { type: 'button', onClick: next }, '下一题'));
        });
        return b;
      });
      bodyNode = h('div.qz-body',
        h('div.qz-prompt', q.prompt),
        h('div.qz-ask', '选择它的中文意思'),
        h('div.qz-opts', btns));
    } else {
      const input = h('input.qz-input', {
        type: 'text',
        placeholder: '在这里拼写…',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': '拼写答案',
      });
      const submit = () => {
        if (quiz.answered) return;
        const value = input.value.trim();
        const { ok } = judge(q, value);
        commit(value, ok);
        input.disabled = true;
        input.classList.add(ok ? 'ok' : 'no');
        feedback.replaceChildren(
          h('div.qz-line', h('b', {}, ok ? '✓ 拼对了' : '✗ 拼错了'),
            h('span', {}, ok ? '' : `正确答案：${q.answer}`)),
          h('div.qz-line.qz-weak', `${q.word} · ${q.pos ? `${q.pos} ` : ''}${q.zh}`),
        );
        actions.replaceChildren(h('button.btn.btn-primary', { type: 'button', onClick: next }, '下一题'));
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      bodyNode = h('div.qz-body',
        h('div.qz-prompt.qz-zh', q.prompt || '（无释义）'),
        h('div.qz-ask', `写出对应英文 · ${q.pos ? `${q.pos} · ` : ''}${q.letters} 个字母`),
        h('div.qz-hint', h('span.qz-mask', q.mask)),
        h('div.qz-input-row', input,
          h('button.btn.btn-primary.btn-sm', { type: 'button', onClick: submit }, '提交')));
      setTimeout(() => input.focus(), 0);
    }

    quizBox.replaceChildren(quizHeader(), bodyNode, feedback, actions);
  };

  const exitQuiz = () => {
    quiz = null;
    toolbar.style.display = '';
    head.querySelector('.vb-actions').replaceChildren(startBtn());
    bodyBox.replaceChildren();
    render();
  };

  const startQuiz = () => {
    items = listVocab();
    if (!items.length) {
      toast('先收藏几个单词再自测');
      return;
    }
    const questions = buildQuiz(items, { count: Math.min(10, items.length), pool: poolFromGlossary() });
    if (!questions.length) {
      toast('收藏的词还没有释义，暂时不能自测');
      return;
    }
    quiz = {
      questions,
      index: 0,
      score: 0,
      results: [],
      answered: null,
    };
    toolbar.style.display = 'none';
    head.querySelector('.vb-actions').replaceChildren(
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onClick: () => exitQuiz() }, '退出自测'));
    bodyBox.replaceChildren(quizBox);
    step();
  };

  const startBtn = () => {
    const btn = h('button.btn.btn-primary', {
      type: 'button',
      disabled: items.length === 0,
      'data-tip': items.length ? '从收藏的词里抽一组题' : '至少收藏 1 个单词',
      onClick: () => startQuiz(),
    }, '开始自测');
    return btn;
  };

  /* ---------- 渲染入口 ---------- */
  const render = () => {
    items = listVocab();
    if (passageId && !items.some((x) => x.passageId === passageId)) passageId = '';
    if (quiz) {
      bodyBox.replaceChildren(quizBox);
      return;
    }
    renderChips();
    renderList();
    head.querySelector('.vb-actions').replaceChildren(startBtn());
    const sub = head.querySelector('.vb-sub');
    if (sub) {
      const st = vocabStats(items);
      sub.textContent = st.total
        ? `已收藏 ${st.total} 词 · 来自 ${st.passages.length} 篇原文`
        : '在原文里点任意单词，点 ★ 即可收藏到这里';
    }
  };

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderList();
  });

  render();

  return {
    root,
    teardown() {
      quiz = null;
    },
  };
}

