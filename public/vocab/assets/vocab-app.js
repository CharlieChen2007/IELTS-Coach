/* =============================================================
 * SpeakLoop · 词库页面交互
 * 卡牌（翻面 / 四档评分 / 发音）/ 听写 / 记忆曲线 / 词表
 * 数据：SL.vocabData ｜ 调度：SL.vocabEngine ｜ 朗读：SL.audio
 * ============================================================= */
(function () {
  'use strict';

  var D = window.SL.vocabData;
  var E = window.SL.vocabEngine;
  var A = window.SL.audio;

  var viewEl = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var modalEl = document.getElementById('modal');
  var modalInner = document.getElementById('modalInner');
  var navEl = document.getElementById('nav');

  var LS_USERS = 'speakloop.users.v1';
  var LS_LAST = 'speakloop.lastUser.v1';

  function $(s, r) { return (r || document).querySelector(s); }
  function keyOf(id) { return 'speakloop.vocab.' + id; }
  function today() { return E.today(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 3000);
  }
  function mmdd(iso) { var p = String(iso).split('-'); return p.length === 3 ? (Number(p[1]) + '/' + Number(p[2])) : iso; }
  function daysLabel(n) { return n <= 1 ? '明天' : n + ' 天后'; }

  var state = {
    view: 'cards', user: null, db: null,
    queue: [], idx: 0, flipped: false,
    dict: null, curveWord: '',
    filter: { q: '', topic: 'all', status: 'all' }, listPage: 1
  };

  /* ==================== 存储 ==================== */
  function users() { try { return JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch (e) { return []; } }
  function saveUsers(l) { localStorage.setItem(LS_USERS, JSON.stringify(l)); }

  function emptyDb() {
    return { version: 1, cards: {}, daily: {}, streak: { days: 0, last: '' }, settings: { target: 15, newLimit: 20 } };
  }

  function loadDb() {
    try { state.db = JSON.parse(localStorage.getItem(keyOf(state.user.id)) || 'null') || emptyDb(); }
    catch (e) { state.db = emptyDb(); }
    var d = state.db;
    if (!d.cards) d.cards = {};
    if (!d.daily) d.daily = {};
    if (!d.streak) d.streak = { days: 0, last: '' };
    if (!d.settings) d.settings = { target: 15, newLimit: 20 };
    if (!d.settings.target || d.settings.target < 5) d.settings.target = 15;
    if (!d.settings.newLimit || d.settings.newLimit < 5) d.settings.newLimit = 20;
    E.touchDaily(d, today());
  }
  /* 云端补齐前用户是否已产生操作：有则不用云端覆盖本地进度。 */
  var touched = false;

  /* 嵌入学习空间时，进度经 vocab-host.js 同时写本机与站点数据库；
     独立站仍只写 localStorage，不依赖任何后端。 */
  function saveDb() {
    touched = true;
    var key = keyOf(state.user.id);
    var host = window.SL.vocabHost;
    if (host && host.embedded) host.persist(state.db, key);
    else localStorage.setItem(key, JSON.stringify(state.db));
  }

  function normalize(d) {
    if (!d.cards) d.cards = {};
    if (!d.daily) d.daily = {};
    if (!d.streak) d.streak = { days: 0, last: '' };
    if (!d.settings) d.settings = { target: 15, newLimit: 20 };
    if (!d.settings.target || d.settings.target < 5) d.settings.target = 15;
    if (!d.settings.newLimit || d.settings.newLimit < 5) d.settings.newLimit = 20;
    E.touchDaily(d, today());
    return d;
  }

  /* ==================== 启动 ==================== */
  function boot() {
    var host = window.SL.vocabHost;
    if (host && host.embedded) {
      /* 账号由宿主决定，不再自动建「新学员」；先用本机镜像立刻出画面，
         云端记录到达后再补齐（换设备 / 清缓存后进度不丢）。 */
      state.user = host.user;
      touched = false;
      loadDb();
      rebuildQueue(0);
      render();
      host.ready();
      host.load().then(function (cloud) {
        if (touched || !cloud || typeof cloud !== 'object' || !cloud.cards) return;
        state.db = normalize(cloud);
        try { localStorage.setItem(keyOf(state.user.id), JSON.stringify(state.db)); } catch (e) {}
        rebuildQueue(0);
        render();
      });
      return;
    }
    var list = users();
    if (!list.length) {
      var u = { id: E.uid('U'), name: '新学员' };
      list.push(u); saveUsers(list); localStorage.setItem(LS_LAST, u.id);
    }
    var last = localStorage.getItem(LS_LAST);
    state.user = list.filter(function (x) { return x.id === last; })[0] || list[0];
    loadDb();
    rebuildQueue(0);
    render();
    if (host) host.ready();
  }

  function rebuildQueue(resetIdx) {
    var q = E.buildQueue(state.db, D.WORDS, today(), { newLimit: state.db.settings.newLimit });
    state.queue = q.all;
    if (resetIdx !== undefined) state.idx = resetIdx;
    if (state.idx > state.queue.length) state.idx = state.queue.length;
    state.reviews = q.reviews.length;
    state.news = q.news.length;
  }

  function currentItem() { return state.queue[state.idx] || null; }
  function currentWord() { var it = currentItem(); return it ? it.word : null; }

  function isDone(id) {
    var d = E.dailyOf(state.db, today());
    return d.learned.indexOf(id) >= 0 || d.reviewed.indexOf(id) >= 0;
  }

  /* ==================== 通用片段 ==================== */
  /* 例句里的 ~ 是本词占位符（扩充词条为了少写一遍单词） */
  function exText(w) { return String((w && w.ex) || '').replace(/~/g, (w && w.word) || ''); }

  /* 新增词条可能只有释义 / 例句 / 搭配，缺失字段整块隐藏，不留空行 */
  function metaHtml(w) {
    var cells = [];
    if (w.colloc) cells.push('<div><b>常见搭配</b>' + esc(w.colloc) + '</div>');
    if (w.syn) cells.push('<div><b>同义替换</b>' + esc(w.syn) + '</div>');
    if (w.tip) cells.push('<div class="vc-meta-full"><b>记忆提示</b>' + esc(w.tip) + '</div>');
    return cells.length ? '<div class="vc-meta">' + cells.join('') + '</div>' : '';
  }

  function detailGrid(w) {
    var cells = [];
    if (w.colloc) cells.push('<div><b>常见搭配</b>' + esc(w.colloc) + '</div>');
    if (w.syn) cells.push('<div><b>同义替换</b>' + esc(w.syn) + '</div>');
    if (w.tip) cells.push('<div style="grid-column:1/-1"><b>记忆提示</b>' + esc(w.tip) + '</div>');
    return cells.length ? '<div class="vd-grid">' + cells.join('') + '</div>' : '';
  }

  function hlWord(text, word) {
    var safe = esc(text);
    var pattern = String(word).split('-').map(escRe).join('[- ]?');
    try {
      return safe.replace(new RegExp('\\b(' + pattern + '[a-z]{0,4})\\b', 'gi'), '<b>$1</b>');
    } catch (e) { return safe; }
  }

  function say(text, rate) {
    if (!text) return;
    if (A && A.speak) A.speak(text, { rate: rate || 0.9 });
  }

  function nextLabel(q) {
    var it = currentItem();
    if (!it) return '';
    var base = state.db.cards[it.word.id] || E.newCard(it.word.id, today());
    var n = E.schedule(base, q, today()).interval;
    return daysLabel(n);
  }

  function masteryBadge(m) {
    var map = { fresh: '未学', learning: '学习中', reviewing: '复习中', mastered: '已掌握' };
    return '<span class="vw-badge ' + m + '">' + (map[m] || m) + '</span>';
  }

  /* ==================== 渲染 ==================== */
  function render() {
    updateChrome();
    if (state.view === 'cards') renderCards();
    else if (state.view === 'dictation') renderDictation();
    else if (state.view === 'curve') renderCurve();
    else renderList();
  }

  function updateChrome() {
    var p = E.progressOf(state.db, state.db.settings.target, today());
    var label = document.getElementById('miniProgLabel');
    var bar = document.getElementById('miniProgBar');
    if (label) label.textContent = '今日 ' + p.done + '/' + p.target;
    if (bar) bar.style.width = Math.round(p.pct * 100) + '%';
    var nm = document.getElementById('accountName');
    var av = document.getElementById('avatar');
    if (nm) nm.textContent = state.user.name;
    if (av) av.textContent = String(state.user.name || 'S').slice(0, 1);
    if (navEl) {
      Array.prototype.forEach.call(navEl.querySelectorAll('[data-nav]'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-nav') === state.view);
      });
    }
  }

  function heroHtml(p, st) {
    var pct = Math.round(p.pct * 100);
    var rest = Math.max(0, p.target - p.done);
    return '<section class="vc-hero">' +
      '<div class="vc-hero-main">' +
      '<div class="vc-eyebrow">DAILY VOCAB · 今日目标</div>' +
      '<h1>今日 <b>' + p.done + '</b> / ' + p.target + ' 词</h1>' +
      '<p>待复习 <b>' + st.due + '</b> · 未学 <b>' + st.fresh + '</b> · 已掌握 <b>' + st.mastered + '</b> · 连续打卡 <b>' + (state.db.streak.days || 0) + '</b> 天</p>' +
      '<div class="vc-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="vc-prog-meta"><span>完成 ' + pct + '%</span><span>' +
      (p.completed ? '今日已达标 ✓' : '还差 ' + rest + ' 个达标') + '</span></div>' +
      '</div>' +
      '<div class="vc-hero-side">' +
      '<button class="btn" data-act="gotoCards">继续学习 →</button>' +
      '<button class="btn ghost" data-act="startDict">🎧 听写 10 题</button>' +
      '</div></section>';
  }

  function sideHtml(st, p) {
    var shown = state.queue.slice(0, 8);
    var restCount = Math.max(0, state.queue.length - shown.length);
    var items = shown.map(function (it) {
      var w = it.word, done = isDone(w.id);
      var kind = (it.card && it.card.history && it.card.history.length) ? 'rev' : 'fresh';
      return '<div class="vc-q' + (done ? ' done' : '') + '">' +
        (done ? '<span class="vc-tick">✓</span>' : '<span class="vc-tick" style="color:#dfe3f0">○</span>') +
        '<span class="vc-q-w">' + esc(w.word) + '</span>' +
        '<span class="vc-q-pos">' + esc(w.pos) + '</span>' +
        '<span class="vc-q-badge ' + kind + '">' + (kind === 'rev' ? '复习' : '新词') + '</span>' +
        '</div>';
    }).join('') || '<div class="vc-empty">今天的队列已清空</div>';

    var total = st.fresh + st.learning + st.reviewing + st.mastered;
    function seg(n, cls) { return total ? '<i class="' + cls + '" style="width:' + (n / total * 100) + '%"></i>' : ''; }

    return '<aside class="vc-side">' +
      '<div class="card vc-panel"><h3>今日队列 <span>' + p.done + ' / ' + state.queue.length + '</span></h3>' +
      '<div class="vc-queue">' + items + '</div>' +
      (restCount ? '<div class="small muted" style="padding-top:9px">队列里还有 ' + restCount + ' 个词</div>' : '') +
      '</div>' +
      '<div class="card vc-panel"><h3>掌握分布 <span>' + total + ' 词</span></h3>' +
      '<div class="vc-stack">' + seg(st.fresh, 'p0') + seg(st.learning, 'p1') + seg(st.reviewing, 'p2') + seg(st.mastered, 'p3') + '</div>' +
      '<div class="vc-legend">' +
      '<span><em class="p0" style="background:#dce8ed"></em>未学 ' + st.fresh + '</span>' +
      '<span><em style="background:#4b8ca8"></em>学习中 ' + st.learning + '</span>' +
      '<span><em style="background:#279783"></em>复习中 ' + st.reviewing + '</span>' +
      '<span><em style="background:#16a34a"></em>已掌握 ' + st.mastered + '</span>' +
      '</div></div>' +
      '<div class="card vc-panel"><h3>连续打卡</h3>' +
      '<div class="vc-streak"><b>' + (state.db.streak.days || 0) + '</b><span>天 · ' +
      (p.completed ? '今日已达标' : '今天还差 ' + Math.max(0, p.target - p.done) + ' 词') + '</span></div></div>' +
      '</aside>';
  }

  function renderCards() {
    var p = E.progressOf(state.db, state.db.settings.target, today());
    var st = E.stats(state.db, D.WORDS, today());
    var it = currentItem();

    if (!it) {
      viewEl.innerHTML = heroHtml(p, st) + '<div class="vc-grid"><section class="card vc-stage">' +
        '<div class="vc-done"><div class="vc-done-ico">' + (p.completed ? '🎉' : '✅') + '</div>' +
        '<h2>' + (p.completed ? '今日目标达成' : '今日队列已清空') + '</h2>' +
        '<p>今天已学 ' + p.done + ' 个词 · 待复习 ' + st.due + ' · 连续打卡 ' + (state.db.streak.days || 0) + ' 天</p>' +
        '<div class="vc-done-acts">' +
        '<button class="btn primary" data-act="startDict">🎧 听写 10 题</button>' +
        '<button class="btn" data-act="nav" data-nav="curve">看记忆曲线</button>' +
        '<button class="btn soft" data-act="restartQueue">再来一轮</button>' +
        '</div></div></section>' + sideHtml(st, p) + '</div>';
      return;
    }

    var w = it.word;
    var kind = (it.card && it.card.history && it.card.history.length) ? 'rev' : 'fresh';
    var topic = D.topicOf(w.topic);
    var base = state.db.cards[w.id] || E.newCard(w.id, today());
    var m = E.masteryOf(base);

    var stage = '<section class="card vc-stage">' +
      '<div class="vc-stage-top">' +
      '<span class="pill" style="background:' + (kind === 'rev' ? '#fff2db' : '#e7f1f6') + ';color:' + (kind === 'rev' ? '#96630a' : '#285f80') + '">' +
      (kind === 'rev' ? '复习' : '新词') + '</span>' +
      '<span class="pill">' + topic.icon + ' ' + esc(topic.name) + '</span>' +
      '<span class="pill">Band ' + (w.level === 3 ? '7.5+' : '6.5–7') + '</span>' +
      '<span class="vc-idx">' + (state.idx + 1) + ' / ' + state.queue.length + '</span>' +
      '</div>' +

      '<div class="vc-card' + (state.flipped ? ' flipped' : '') + '" data-act="flip" tabindex="0" role="button" aria-label="点击翻开释义">' +
      '<div class="vc-inner">' +
      '<div class="vc-face vc-front">' +
      '<span class="vc-pos">' + esc(w.pos) + '</span>' +
      '<h2>' + esc(w.word) + '</h2>' +
      '<div class="vc-phon">' + esc(w.phonetic) + '</div>' +
      '<button class="vc-say" data-act="say" data-text="' + esc(w.word) + '" title="朗读单词">🔊</button>' +
      '<div class="vc-hint">点击卡牌 / 空格 显示释义</div>' +
      '</div>' +
      '<div class="vc-face vc-back">' +
      '<div class="vc-back-bar"></div>' +
      '<div class="vc-back-in">' +
      '<h2>' + esc(w.zh) + '</h2>' +
      (w.def ? '<div class="vc-def">' + esc(w.def) + '</div>' : '') +
      '<div class="vc-ex">' + hlWord(exText(w), w.word) + '</div>' +
      '<div class="vc-exzh">' + esc(w.exZh) + '</div>' +
      metaHtml(w) +
      '<div class="vc-exsay"><button class="btn sm" data-act="sayEx" data-text="' + esc(exText(w)) + '">🔊 朗读例句</button>' +
      '<span class="small muted" style="align-self:center">' +
      (base.history && base.history.length ? '第 ' + base.history.length + ' 次接触' : '首次学习') + '</span></div>' +
      '</div></div>' +
      '</div></div>' +

      '<div class="vc-reveal' + (state.flipped ? ' hidden' : '') + '">' +
      '<button class="btn primary lg" data-act="flip">👀 显示释义</button></div>' +

      '<div class="vc-grades' + (state.flipped ? ' on' : '') + '">' +
      '<button class="vc-grade g0" data-act="grade" data-q="0">😵 忘了<small>' + nextLabel(0) + '</small></button>' +
      '<button class="vc-grade g1" data-act="grade" data-q="1">🤔 有点难<small>' + nextLabel(1) + '</small></button>' +
      '<button class="vc-grade g2" data-act="grade" data-q="2">🙂 记住了<small>' + nextLabel(2) + '</small></button>' +
      '<button class="vc-grade g3" data-act="grade" data-q="3">😎 太简单<small>' + nextLabel(3) + '</small></button>' +
      '</div>' +

      '<div class="vc-kbd"><kbd>空格</kbd> 翻面 · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>/<kbd>4</kbd> 评分 · <kbd>D</kbd> 发音' +
      (state.flipped ? '' : ' · 翻面后才能评分') + '</div>' +
      '</section>';

    viewEl.innerHTML = heroHtml(p, st) + '<div class="vc-grid">' + stage + sideHtml(st, p) + '</div>';
  }

  /* ==================== 卡牌动作 ==================== */
  function flip() {
    if (!currentItem()) return;
    state.flipped = !state.flipped;
    var card = $('.vc-card');
    if (card) card.classList.toggle('flipped', state.flipped);
    var rev = $('.vc-reveal'); if (rev) rev.classList.toggle('hidden', state.flipped);
    var gr = $('.vc-grades'); if (gr) gr.classList.toggle('on', state.flipped);
  }

  function grade(q) {
    var it = currentItem();
    if (!it) return;
    if (!state.flipped) { toast('先翻面看释义，再评估自己记得怎么样'); return; }

    var before = E.progressOf(state.db, state.db.settings.target, today());
    var r = E.recordReview(state.db, it.word.id, q, today());
    var after = E.progressOf(state.db, state.db.settings.target, today());

    var msg;
    if (q === 0) msg = '已加入明天复习';
    else if (q === 1) msg = '间隔小幅延长到 ' + daysLabel(r.interval);
    else if (q === 2) msg = '记住了，' + daysLabel(r.interval) + '后再复习';
    else msg = '太简单，' + daysLabel(r.interval) + '后再复习';

    if (after.completed && state.db.streak.last !== today()) {
      state.db.streak = E.streakUp(state.db.streak, today());
      msg = '今日目标达成 🎉 连续打卡 ' + state.db.streak.days + ' 天';
    }
    saveDb();
    toast(msg);
    state.flipped = false;
    state.idx++;
    render();
  }

  function restartQueue() {
    rebuildQueue(0);
    state.flipped = false;
    render();
    if (!state.queue.length) toast('暂时没有到期或未学的词，明天再来');
    else toast('已重新排好今天的队列');
  }

  /* ==================== 听写 ==================== */
  function startDict() {
    var pool = E.dictationPool(state.db, D.WORDS, today(), 10);
    state.dict = { pool: pool, idx: 0, feedback: null, correct: 0, wrong: [], done: false };
    state.view = 'dictation';
    render();
    setTimeout(sayWord, 260);
  }

  function sayWord() {
    var d = state.dict;
    if (!d || d.done) return;
    var w = d.pool[d.idx];
    if (w) say(w.word, 0.85);
  }

  function submitDict() {
    var d = state.dict;
    if (!d || d.done || d.feedback) return;
    var inp = $('#dictInput');
    var val = inp ? inp.value : '';
    if (!val.trim()) { toast('先把你听到的单词拼出来'); if (inp) inp.focus(); return; }

    var w = d.pool[d.idx];
    var r = E.checkSpelling(val, w.word);
    if (r.exact) d.correct += 1;
    else d.wrong.push({ word: w, input: val, near: r.near });

    d.feedback = { r: r, word: w, input: val };

    /* 听写只更新该词的 SRS，不计入卡牌「今日已学」，避免污染进度 */
    var base = state.db.cards[w.id] || E.newCard(w.id, today());
    state.db.cards[w.id] = E.schedule(base, r.exact ? 2 : (r.near ? 1 : 0), today());
    E.recordDictation(state.db, today(), 1, r.exact ? 1 : 0);
    saveDb();
    render();
  }

  function nextDict() {
    var d = state.dict;
    if (!d) return;
    if (d.idx + 1 >= d.pool.length) { d.done = true; d.feedback = null; render(); return; }
    d.idx += 1;
    d.feedback = null;
    render();
    setTimeout(sayWord, 200);
  }

  function renderDictation() {
    var d = state.dict;
    var p = E.progressOf(state.db, state.db.settings.target, today());
    var st = E.stats(state.db, D.WORDS, today());

    if (!d) {
      viewEl.innerHTML = heroHtml(p, st) +
        '<section class="card vc-dict mt16" style="margin-top:18px">' +
        '<div class="vc-dict-head"><span class="pill">听写</span><span>10 题一组 · 优先今日学过的词</span></div>' +
        '<div class="vc-dict-body">' +
        '<div style="font-size:44px;line-height:1">🎧</div>' +
        '<h2 style="margin:8px 0 4px;font-size:22px">听发音，拼单词</h2>' +
        '<p class="muted" style="max-width:460px;font-size:13px;margin:0">系统只朗读单词、不显示拼写。输入后立即判分；答错的词会进入明天的复习队列。</p>' +
        '<button class="btn primary lg" data-act="startDict" style="margin-top:18px">开始听写 →</button>' +
        '</div>' +
        (st.accuracy === null ? '' : '<div class="small muted" style="text-align:center;padding-bottom:8px">今日听写正确率 ' + st.accuracy + '%（' + st.dictationCorrect + '/' + st.dictationTotal + '）</div>') +
        '</section>';
      return;
    }

    if (d.done) {
      var acc = d.pool.length ? Math.round(d.correct / d.pool.length * 100) : 0;
      var comment = acc >= 90 ? '很稳，这组词的拼写已经进长期记忆了。'
        : acc >= 70 ? '整体不错，错词已经排进明天的复习队列。'
          : '错得有点多，建议先用卡牌把这组词过一遍再来听写。';
      var wrongHtml = d.wrong.length ? '<div class="vc-wrong"><div class="label" style="margin-bottom:6px">需要再看的词</div>' +
        d.wrong.map(function (x) {
          return '<div class="vc-wrong-item"><b>' + esc(x.word.word) + '</b>' +
            '<span>' + esc(x.word.zh) + (x.near ? ' · 你写的是「' + esc(x.input) + '」，差一点' : '') + '</span></div>';
        }).join('') + '</div>' : '';

      viewEl.innerHTML = heroHtml(p, st) + '<section class="card vc-dict" style="margin-top:18px">' +
        '<div class="vc-dict-sum">' +
        '<div class="vc-score">' + acc + '<small>% · ' + d.correct + '/' + d.pool.length + '</small></div>' +
        '<p class="muted" style="margin:8px 0 0">' + comment + '</p>' +
        wrongHtml +
        '<div class="flex gap8" style="justify-content:center;margin-top:18px;flex-wrap:wrap">' +
        '<button class="btn primary" data-act="startDict">再来一组</button>' +
        '<button class="btn" data-act="nav" data-nav="cards">回去背卡</button>' +
        '<button class="btn soft" data-act="nav" data-nav="curve">看记忆曲线</button>' +
        '</div></div></section>';
      return;
    }

    var w = d.pool[d.idx];
    var fb = '';
    if (d.feedback) {
      var r = d.feedback.r, cls = r.exact ? 'ok' : (r.near ? 'near' : 'bad');
      var title = r.exact ? '✓ 完全正确' : (r.near ? '≈ 差一点' : '✗ 拼写不对');
      fb = '<div class="vc-feedback ' + cls + '">' +
        '<div class="vf-line"><b>' + title + '</b><span class="vf-word">' + esc(d.feedback.word.word) + '</span>' +
        '<span style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + esc(d.feedback.word.phonetic) + '</span>' +
        '<span class="pill">' + esc(d.feedback.word.pos) + '</span></div>' +
        '<div class="vf-sub">' + esc(d.feedback.word.zh) + ' · ' + esc(d.feedback.word.def) +
        (r.exact ? '' : '<br>你写的是「' + esc(d.feedback.input) + '」' + (r.near ? '（差 ' + r.distance + ' 个字母）' : '')) +
        '</div>' +
        '<div class="vf-acts"><button class="btn sm primary" data-act="nextDict">' +
        (d.idx + 1 >= d.pool.length ? '看结果 →' : '下一题 →') + '</button>' +
        '<button class="btn sm" data-act="sayWord">🔊 再听一次</button></div>' +
        '</div>';
    }

    viewEl.innerHTML = heroHtml(p, st) + '<section class="card vc-dict" style="margin-top:18px">' +
      '<div class="vc-dict-head"><span class="pill">听写</span>第 <b style="color:var(--ink)">' + (d.idx + 1) + '</b> / ' + d.pool.length + ' 题' +
      '<span class="vc-dict-score">✓ ' + d.correct + ' · ✗ ' + d.wrong.length + '</span></div>' +
      '<div class="vc-dict-body">' +
      '<button class="vc-play" data-act="sayWord" title="播放发音">🔊</button>' +
      '<div class="vc-dict-tip">点击喇叭再听一遍（可重复）' + (d.idx === 0 && !d.feedback ? ' · 也可以按空格播放' : '') + '</div>' +
      '<div class="vc-dict-input">' +
      '<input id="dictInput" class="input" placeholder="type what you hear…" autocomplete="off" spellcheck="false" ' +
      (d.feedback ? 'disabled ' : '') + '>' +
      '<button class="btn primary" data-act="submitDict"' + (d.feedback ? ' disabled' : '') + '>提交</button>' +
      '</div>' + fb +
      '</div></section>';

    var inp = $('#dictInput');
    if (inp && !d.feedback) inp.focus();
  }

  /* ==================== 记忆曲线 ==================== */
  function sparkSvg(card, word) {
    var h = (card && card.history) || [];
    if (!h.length) {
      return '<div class="vc-empty">「' + esc(word.word) + '」还没有复习记录。<br>' +
        '先去卡牌给它评一次分，这里就会出现间隔增长曲线。</div>';
    }
    var W = 640, H = 160, PL = 44, PR = 18, PT = 16, PB = 30;
    var maxI = Math.max.apply(null, h.map(function (x) { return x.interval; }).concat([1]));
    var pts = h.map(function (x, i) {
      var px = PL + (h.length === 1 ? (W - PL - PR) / 2 : i / (h.length - 1) * (W - PL - PR));
      var py = H - PB - Math.sqrt(x.interval / maxI) * (H - PT - PB);
      return { x: px, y: py, i: x.interval, d: x.date, q: x.q };
    });
    var line = pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');

    var grid = '', labels = '', seen = {};
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = H - PB - f * (H - PT - PB);
      grid += '<line class="grid" x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '"/>';
      /* 间隔很小时用一位小数，避免四行刻度都显示成同一个数 */
      var txt = (maxI >= 8 ? String(Math.round(maxI * f)) : (maxI * f).toFixed(1)) + 'd';
      if (seen[txt]) return;
      seen[txt] = 1;
      labels += '<text class="lbl" x="' + (PL - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + txt + '</text>';
    });
    /* 只有一次记录时补一条虚线，避免折线只有一个点、看不出趋势 */
    var single = pts.length === 1
      ? '<line x1="' + PL + '" y1="' + pts[0].y.toFixed(1) + '" x2="' + pts[0].x.toFixed(1) + '" y2="' + pts[0].y.toFixed(1) + '" stroke="#c8dfe9" stroke-width="2" stroke-dasharray="5 5"/>'
      : '';
    labels += '<text class="lbl" x="' + PL + '" y="' + (H - 8) + '">' + mmdd(h[0].date) + '</text>';
    if (h.length > 1) {
      labels += '<text class="lbl" x="' + (W - PR) + '" y="' + (H - 8) + '" text-anchor="end">' + mmdd(h[h.length - 1].date) + '</text>';
    }
    var dots = pts.map(function (p) {
      return '<circle class="dot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4"><title>' +
        p.d + ' · 间隔 ' + p.i + ' 天</title></circle>';
    }).join('');

    return '<svg class="vc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      grid + single + '<polyline class="line" points="' + line + '"/>' + dots + labels + '</svg>' +
      '<div class="small muted" style="padding:0 6px">共复习 ' + h.length + ' 次，当前间隔 ' + h[h.length - 1].interval +
      ' 天；估算记忆保持率 ' + Math.round(E.retention(card, today()) * 100) + '%（仅作可视化，不是分数）。</div>';
  }

  function renderCurve() {
    var st = E.stats(state.db, D.WORDS, today());
    var fc = E.dueForecast(state.db, D.WORDS, today(), 7);
    var max = Math.max.apply(null, fc.map(function (x) { return x.count; }).concat([1]));

    var bars = fc.map(function (x, i) {
      var hgt = Math.round(x.count / max * 100);
      return '<div class="vc-bar' + (i === 0 ? ' today' : '') + (x.count ? '' : ' zero') + '">' +
        '<span class="vc-bar-v">' + x.count + '</span>' +
        '<i style="height:' + Math.max(4, hgt) + '%"></i>' +
        '<small>' + (i === 0 ? '今天' : mmdd(x.date)) + '</small></div>';
    }).join('');

    var learned = st.learning + st.reviewing + st.mastered;
    var wordsWithHistory = D.WORDS.filter(function (w) {
      var c = state.db.cards[w.id];
      return c && c.history && c.history.length;
    });
    if (!state.curveWord || !state.db.cards[state.curveWord]) {
      state.curveWord = (wordsWithHistory[0] || D.WORDS[0]).id;
    }
    var selWord = D.find(state.curveWord) || D.WORDS[0];
    var selCard = state.db.cards[selWord.id];

    var options = D.WORDS.map(function (w) {
      var c = state.db.cards[w.id];
      var tag = c && c.history && c.history.length ? ' · ' + c.history.length + ' 次' : ' · 未学';
      return '<option value="' + w.id + '"' + (w.id === selWord.id ? ' selected' : '') + '>' + esc(w.word) + tag + '</option>';
    }).join('');

    viewEl.innerHTML = '<section class="vc-stats">' +
      '<div class="vc-stat s0"><b>' + st.due + '</b><span>今日待复习</span></div>' +
      '<div class="vc-stat s1"><b>' + learned + '</b><span>学习中 / 复习中</span></div>' +
      '<div class="vc-stat s2"><b>' + st.mastered + '</b><span>已掌握（间隔 ≥21 天）</span></div>' +
      '<div class="vc-stat s3"><b>' + (st.accuracy === null ? '—' : st.accuracy + '%') + '</b><span>今日听写正确率</span></div>' +
      '</section>' +

      '<div class="vc-grid" style="margin-top:0">' +
      '<section class="card vc-panel"><h3>未来 7 天复习量 <span>第 1 天含逾期</span></h3>' +
      '<div class="vc-bars">' + bars + '</div></section>' +

      '<aside class="vc-side"><div class="card vc-panel"><h3>今日状态</h3>' +
      '<div class="vc-stack">' +
      (st.fresh ? '<i class="p0" style="width:' + (st.fresh / Math.max(1, D.WORDS.length) * 100) + '%"></i>' : '') +
      (st.learning ? '<i class="p1" style="width:' + (st.learning / Math.max(1, D.WORDS.length) * 100) + '%"></i>' : '') +
      (st.reviewing ? '<i class="p2" style="width:' + (st.reviewing / Math.max(1, D.WORDS.length) * 100) + '%"></i>' : '') +
      (st.mastered ? '<i class="p3" style="width:' + (st.mastered / Math.max(1, D.WORDS.length) * 100) + '%"></i>' : '') +
      '</div>' +
      '<div class="vc-legend"><span>未学 ' + st.fresh + '</span><span>学习中 ' + st.learning + '</span>' +
      '<span>复习中 ' + st.reviewing + '</span><span>已掌握 ' + st.mastered + '</span></div>' +
      '<div class="small muted" style="margin-top:12px;line-height:1.7">间隔按 SM-2 简化版推进：' +
      'again 次日重来；hard 只小幅延长；good 乘 ease；easy 起步更长。间隔上限 180 天。</div>' +
      '</div></aside></div>' +

      '<section class="card vc-panel" style="margin-top:16px">' +
      '<div class="vc-curve-head"><h3 style="margin:0">单卡复习历史</h3>' +
      '<select id="curveWord" class="input" style="height:34px;padding:0 10px">' + options + '</select>' +
      '<span class="small muted">' + esc(selWord.word) + ' · ' + esc(selWord.phonetic) + '</span></div>' +
      '<div id="sparkBox">' + sparkSvg(selCard, selWord) + '</div>' +
      '</section>';
  }

  /* ==================== 词表 ==================== */
  function filteredWords() {
    var f = state.filter;
    return D.WORDS.filter(function (w) {
      if (f.topic !== 'all' && w.topic !== f.topic) return false;
      if (f.status !== 'all') {
        var m = E.masteryOf(state.db.cards[w.id]);
        if (f.status === 'mastered' && m !== 'mastered') return false;
        if (f.status === 'learning' && !(m === 'learning' || m === 'reviewing')) return false;
        if (f.status === 'fresh' && m !== 'fresh') return false;
      }
      if (f.q) {
        var q = f.q.toLowerCase();
        if (w.word.toLowerCase().indexOf(q) < 0 && w.zh.indexOf(f.q) < 0 && w.def.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function wordsHtml(list) {
    if (!list.length) return '<div class="vc-empty">没有符合条件的词，换个筛选或搜索词试试。</div>';
    return list.map(function (w) {
      var m = E.masteryOf(state.db.cards[w.id]);
      var t = D.topicOf(w.topic);
      return '<div class="vc-word" data-act="detail" data-id="' + w.id + '">' +
        '<div class="vw-top"><b>' + esc(w.word) + '</b><span class="vw-pos">' + esc(w.pos) + '</span>' + masteryBadge(m) + '</div>' +
        '<div class="vw-phon">' + esc(w.phonetic) + '</div>' +
        '<div class="vw-zh">' + esc(w.zh) + '</div>' +
        '<div class="small muted" style="margin-top:6px">' + t.icon + ' ' + esc(t.name) + '</div>' +
        '</div>';
    }).join('');
  }

  var WORD_PAGE_SIZE = 24;
  function wordPage(list) {
    var pages = Math.max(1, Math.ceil(list.length / WORD_PAGE_SIZE));
    state.listPage = Math.max(1, Math.min(pages, state.listPage));
    var start = (state.listPage - 1) * WORD_PAGE_SIZE;
    return { pages: pages, start: start, end: Math.min(list.length, start + WORD_PAGE_SIZE), words: list.slice(start, start + WORD_PAGE_SIZE) };
  }
  function paginationHtml(list, page) {
    return '<div class="vc-pagination" aria-label="词表分页">' +
      '<span class="small muted">共 ' + list.length + ' 个词 · 当前 ' + (list.length ? page.start + 1 : 0) + '–' + page.end + ' · 第 ' + state.listPage + ' / ' + page.pages + ' 页</span>' +
      '<div><button type="button" class="btn sm" data-act="listPage" data-v="' + (state.listPage - 1) + '" ' + (state.listPage <= 1 ? 'disabled' : '') + '>上一页</button>' +
      '<button type="button" class="btn sm" data-act="listPage" data-v="' + (state.listPage + 1) + '" ' + (state.listPage >= page.pages ? 'disabled' : '') + '>下一页</button></div></div>';
  }

  function renderList() {
    var list = filteredWords();
    var page = wordPage(list);
    var topics = '<button class="vc-chip' + (state.filter.topic === 'all' ? ' on' : '') + '" data-act="filterTopic" data-v="all">全部主题</button>' +
      D.TOPICS.map(function (t) {
        return '<button class="vc-chip' + (state.filter.topic === t.id ? ' on' : '') + '" data-act="filterTopic" data-v="' + t.id + '">' +
          t.icon + ' ' + esc(t.name) + '</button>';
      }).join('');
    var statuses = [['all', '全部'], ['fresh', '未学'], ['learning', '学习中 / 复习中'], ['mastered', '已掌握']]
      .map(function (s) {
        return '<button class="vc-chip' + (state.filter.status === s[0] ? ' on' : '') + '" data-act="filterStatus" data-v="' + s[0] + '">' + s[1] + '</button>';
      }).join('');

    viewEl.innerHTML = '<section class="card vc-panel">' +
      '<div class="vc-filters">' +
      '<div class="vc-search"><input id="vocabSearch" class="input" placeholder="搜索单词 / 中文释义…" value="' + esc(state.filter.q) + '" autocomplete="off">' +
      '<span class="small muted" id="vocabCount">共 ' + list.length + ' 个词</span></div>' +
      '<div class="vc-chips">' + topics + '</div>' +
      '<div class="vc-chips">' + statuses + '</div>' +
      '</div>' +
      '<div class="vc-words" id="vcWords" tabindex="-1">' + wordsHtml(page.words) + '</div>' +
      '<div id="vocabPaging">' + paginationHtml(list, page) + '</div>' +
      '</section>';
  }

  function renderListResults() {
    var list = filteredWords();
    var page = wordPage(list);
    var box = $('#vcWords'), cnt = $('#vocabCount');
    if (box) box.innerHTML = wordsHtml(page.words);
    if (cnt) cnt.textContent = '共 ' + list.length + ' 个词';
    var paging = $('#vocabPaging');
    if (paging) paging.innerHTML = paginationHtml(list, page);
  }

  /* ==================== 详情 / 账号 ==================== */
  function detailModal(id) {
    var w = D.find(id);
    if (!w) return;
    var card = state.db.cards[w.id];
    var m = E.masteryOf(card);
    var t = D.topicOf(w.topic);
    var status = '还没学过';
    if (card && card.history && card.history.length) {
      status = '已接触 ' + card.history.length + ' 次 · 下次复习 ' + (card.due || '—') +
        ' · 当前间隔 ' + card.interval + ' 天 · 保持率约 ' + Math.round(E.retention(card, today()) * 100) + '%';
    }

    modalInner.innerHTML = '<div class="modal-head"><h3>词条详情</h3><button class="btn sm" data-act="closeModal">关闭</button></div>' +
      '<div class="modal-body vc-detail">' +
      '<h2>' + esc(w.word) + '</h2>' +
      '<div class="vd-phon">' + esc(w.phonetic) + ' · ' + esc(w.pos) + ' · ' + t.icon + ' ' + esc(t.name) + ' · Band ' + (w.level === 3 ? '7.5+' : '6.5–7') + '</div>' +
      '<div class="vd-zh">' + esc(w.zh) + '</div>' +
      (w.def ? '<div class="vd-def">' + esc(w.def) + '</div>' : '') +
      '<div class="vd-ex">' + hlWord(exText(w), w.word) + '</div>' +
      '<div class="vd-exzh">' + esc(w.exZh) + '</div>' +
      detailGrid(w) +
      '<div class="vd-status">掌握状态：' + masteryBadge(m) + ' ｜ ' + esc(status) + '</div>' +
      '<div class="vd-acts">' +
      '<button class="btn sm primary" data-act="say" data-text="' + esc(w.word) + '">🔊 读单词</button>' +
      '<button class="btn sm" data-act="sayEx" data-text="' + esc(exText(w)) + '">🔊 读例句</button>' +
      '<button class="btn sm soft" data-act="studyWord" data-id="' + w.id + '">现在复习这个词</button>' +
      '</div></div>';
    modalEl.classList.remove('hidden');
  }

  function accountModal() {
    var list = users();
    modalInner.innerHTML = '<div class="modal-head"><h3>账号 · 记录按账号隔离</h3><button class="btn sm" data-act="closeModal">关闭</button></div>' +
      '<div class="modal-body"><div class="label">切换账号</div>' +
      list.map(function (u) {
        return '<button class="btn sm' + (u.id === state.user.id ? ' soft' : '') + '" style="margin:0 6px 6px 0" data-act="switchUser" data-id="' + esc(u.id) + '">' +
          esc(u.name) + (u.id === state.user.id ? '（当前）' : '') + '</button>';
      }).join('') +
      '<div class="divider"></div><div class="label">新建账号（可从零验收）</div>' +
      '<div class="flex gap8"><input class="input" id="newUserName" placeholder="例如：验收账号 C"><button class="btn primary" data-act="newUser">创建并切换</button></div>' +
      '<div class="small muted mt12">当前账号：' + esc(state.user.id) + ' ｜ 存储键 ' + esc(keyOf(state.user.id)) + '</div></div>';
    modalEl.classList.remove('hidden');
  }

  function closeModal() { modalEl.classList.add('hidden'); }

  /* ==================== 事件 ==================== */
  document.addEventListener('click', function (e) {
    var nav = e.target.closest && e.target.closest('[data-nav]');
    if (nav) {
      var v = nav.getAttribute('data-nav');
      if (v) { state.view = v; state.flipped = false; render(); return; }
    }
    if (e.target.closest && e.target.closest('#accountBtn')) { accountModal(); return; }
    if (e.target === modalEl) { closeModal(); return; }

    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var q = el.getAttribute('data-q');

    switch (act) {
      case 'flip': flip(); break;
      case 'say': say(el.getAttribute('data-text'), 0.9); break;
      case 'sayEx': say(el.getAttribute('data-text'), 0.86); break;
      case 'grade': grade(parseInt(q, 10)); break;
      case 'gotoCards': state.view = 'cards'; state.flipped = false; render(); break;
      case 'restartQueue': restartQueue(); break;
      case 'startDict': startDict(); break;
      case 'sayWord': sayWord(); break;
      case 'submitDict': submitDict(); break;
      case 'nextDict': nextDict(); break;
      case 'filterTopic': state.filter.topic = el.getAttribute('data-v'); state.listPage = 1; render(); break;
      case 'filterStatus': state.filter.status = el.getAttribute('data-v'); state.listPage = 1; render(); break;
      case 'listPage': {
        state.listPage = Math.max(1, Number(el.getAttribute('data-v')) || 1);
        renderListResults();
        var words = $('#vcWords');
        if (words) words.focus({ preventScroll: true });
        if (window.parent !== window && window.frameElement) {
          var top = window.frameElement.getBoundingClientRect().top + parent.scrollY + viewEl.offsetTop;
          var header = parent.document.querySelector('.topbar');
          parent.scrollTo({ top: Math.max(0, top - (header ? header.offsetHeight : 0) - 16), behavior: 'smooth' });
        } else viewEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
        break;
      }
      case 'detail': detailModal(id); break;
      case 'studyWord': {
        var w = D.find(id);
        if (w) {
          state.queue.splice(state.idx, 0, { word: w, card: state.db.cards[w.id] || null, overdue: 0 });
          state.view = 'cards'; state.flipped = false;
          closeModal(); render();
          toast('已插入当前队列，翻面后即可评分');
        }
        break;
      }
      case 'closeModal': closeModal(); break;
      case 'switchUser':
        localStorage.setItem(LS_LAST, id);
        boot(); closeModal(); toast('已切换账号');
        break;
      case 'newUser': {
        var nm = ($('#newUserName') || {}).value || '';
        nm = nm.trim() || ('学员 ' + (users().length + 1));
        var u = { id: E.uid('U'), name: nm };
        var l = users(); l.push(u); saveUsers(l); localStorage.setItem(LS_LAST, u.id);
        boot(); closeModal(); toast('已创建并切换到「' + nm + '」，记录从零开始');
        break;
      }
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'vocabSearch') {
      state.filter.q = e.target.value;
      state.listPage = 1;
      renderListResults();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'curveWord') {
      state.curveWord = e.target.value;
      var w = D.find(state.curveWord) || D.WORDS[0];
      var box = $('#sparkBox');
      if (box) box.innerHTML = sparkSvg(state.db.cards[w.id], w);
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Enter' && e.target.id === 'dictInput') { e.preventDefault(); submitDict(); }
      return;
    }
    if (e.key === 'Escape') { closeModal(); return; }

    if (state.view === 'cards') {
      if (e.code === 'Space') { e.preventDefault(); flip(); }
      else if (e.key === '1') grade(0);
      else if (e.key === '2') grade(1);
      else if (e.key === '3') grade(2);
      else if (e.key === '4') grade(3);
      else if (e.key === 'd' || e.key === 'D') { var w = currentWord(); if (w) say(w.word, 0.9); }
    } else if (state.view === 'dictation') {
      if (e.code === 'Space') { e.preventDefault(); sayWord(); }
    }
  });

  boot();
})();

