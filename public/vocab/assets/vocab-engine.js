/* =============================================================
 * SpeakLoop · 词库引擎（纯计算，Node 可直接测）
 *
 * 负责：
 *   1) 间隔重复调度（SRS，SM-2 简化版）：again / hard / good / easy
 *   2) 今日队列（到期复习优先，再补新词）
 *   3) 未来到期预测、掌握度分级、记忆保持率估算
 *   4) 听写判分（归一化 + Levenshtein）
 *   5) 每日打卡与连续天数
 *
 * 设计原则：除 recordReview / recordDictation 这两个「明确就地写入」的
 * 便捷函数外，其余都是纯函数，便于单测与替换存储层。
 * ============================================================= */
(function (root) {
  'use strict';

  var MAX_INTERVAL = 180;   // 间隔上限（天）
  var MIN_EASE = 1.3;
  var MAX_EASE = 3.0;

  function pad(n) { return String(n).padStart(2, '0'); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  function dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function today() { return dateStr(new Date()); }

  function parseDate(s) { return new Date(String(s) + 'T00:00:00'); }

  function addDays(s, n) {
    var d = parseDate(s);
    d.setDate(d.getDate() + Number(n || 0));
    return dateStr(d);
  }

  /* to - from，单位天 */
  function diffDays(from, to) {
    if (!from || !to) return 0;
    return Math.round((parseDate(to) - parseDate(from)) / 86400000);
  }

  function uid(prefix) {
    return (prefix || 'X') + '_' + Date.now().toString(36).toUpperCase() + '_' +
      Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* ==================== 卡片 ==================== */
  function newCard(wordId, dateStrNow) {
    return {
      wordId: wordId, reps: 0, ease: 2.5, interval: 0,
      due: dateStrNow || today(), lapses: 0, last: '', history: []
    };
  }

  /* q: 0 again / 1 hard / 2 good / 3 easy */
  function schedule(card, q, dateStrNow) {
    var now = dateStrNow || today();
    var base = card || newCard('', now);
    q = clamp(Math.round(Number(q) || 0), 0, 3);

    var ease = (base.ease || 2.5) + (q === 3 ? 0.15 : q === 2 ? 0 : q === 1 ? -0.15 : -0.2);
    ease = clamp(r2(ease), MIN_EASE, MAX_EASE);

    var interval, reps;
    if (q === 0) {
      /* again：确实忘了 → 重置进度，明天再来 */
      interval = 1;
      reps = 0;
    } else if (q === 1) {
      /* hard：想起来了但很吃力 → 不重置，只小幅延长（×1.2） */
      interval = base.reps === 0 ? 1 : Math.max(1, Math.round(base.interval * 1.2));
      reps = base.reps + 1;
    } else {
      if (base.reps === 0) interval = q === 3 ? 3 : 1;
      else if (base.reps === 1) interval = q === 3 ? 7 : 4;
      else interval = Math.max(1, Math.round(base.interval * ease));
      reps = base.reps + 1;
    }
    interval = clamp(interval, 1, MAX_INTERVAL);

    var history = (base.history || []).slice();
    history.push({ date: now, q: q, interval: interval, ease: ease });

    return {
      wordId: base.wordId,
      reps: reps,
      ease: ease,
      interval: interval,
      due: addDays(now, interval),
      lapses: (base.lapses || 0) + (q === 0 ? 1 : 0),
      last: now,
      history: history
    };
  }

  /* fresh / learning / reviewing / mastered */
  function masteryOf(card) {
    if (!card || !card.reps) return (card && (card.lapses || 0) > 0) ? 'learning' : 'fresh';
    if (card.interval >= 21 && card.reps >= 3) return 'mastered';
    if (card.interval >= 7) return 'reviewing';
    return 'learning';
  }

  /* 估算记忆保持率：按距上次复习天数与当前间隔指数衰减（仅供可视化） */
  function retention(card, dateStrNow) {
    if (!card || !card.last) return 0;
    var elapsed = Math.max(0, diffDays(card.last, dateStrNow || today()));
    var span = Math.max(1, card.interval || 1);
    return clamp(r2(Math.exp(-elapsed / (span * 2.2))), 0.05, 1);
  }

  /* ==================== 队列 ==================== */
  function buildQueue(db, words, dateStrNow, opts) {
    opts = opts || {};
    var now = dateStrNow || today();
    var cards = (db && db.cards) || {};
    var newLimit = opts.newLimit == null ? 20 : opts.newLimit;
    var reviews = [], news = [];

    (words || []).forEach(function (w) {
      var c = cards[w.id];
      var studied = !!(c && c.history && c.history.length);
      if (studied) {
        if (!c.due || c.due <= now) {
          reviews.push({ word: w, card: c, overdue: Math.max(0, diffDays(c.due, now)) });
        }
      } else if (!c || !c.history || !c.history.length) {
        news.push({ word: w, card: c || null, overdue: 0 });
      }
    });

    reviews.sort(function (a, b) { return b.overdue - a.overdue; });
    news.sort(function (a, b) {
      return (a.word.level - b.word.level) || (a.word.id < b.word.id ? -1 : 1);
    });

    var picked = news.slice(0, newLimit);
    return {
      reviews: reviews,
      news: picked,
      all: reviews.concat(picked),
      total: reviews.length + picked.length,
      newTotal: news.length
    };
  }

  /* 未来 n 天到期量；第 0 天含所有逾期 */
  function dueForecast(db, words, dateStrNow, days) {
    var now = dateStrNow || today();
    var cards = (db && db.cards) || {};
    var out = [];
    for (var i = 0; i < (days || 7); i++) {
      var d = addDays(now, i);
      var n = 0;
      (words || []).forEach(function (w) {
        var c = cards[w.id];
        if (!c || !c.history || !c.history.length) return;
        if (i === 0 ? (c.due <= now) : (c.due === d)) n++;
      });
      out.push({ date: d, count: n });
    }
    return out;
  }

  function stats(db, words, dateStrNow) {
    var now = dateStrNow || today();
    var cards = (db && db.cards) || {};
    var d = dailyOf(db, now);
    var s = {
      total: (words || []).length, fresh: 0, learning: 0, reviewing: 0,
      mastered: 0, due: 0, learnedToday: d.learned.length, reviewedToday: d.reviewed.length,
      studiedToday: d.learned.length + d.reviewed.length,
      dictationTotal: d.dictation.total, dictationCorrect: d.dictation.correct,
      accuracy: d.dictation.total ? Math.round(d.dictation.correct / d.dictation.total * 100) : null
    };
    (words || []).forEach(function (w) {
      var c = cards[w.id];
      s[masteryOf(c)]++;
      if (c && c.history && c.history.length && c.due <= now) s.due++;
    });
    return s;
  }

  /* ==================== 每日记录 / 打卡 ==================== */
  function emptyDaily() { return { learned: [], reviewed: [], dictation: { total: 0, correct: 0 } }; }

  function dailyOf(db, dateStrNow) {
    var now = dateStrNow || today();
    if (!db.daily) db.daily = {};
    if (!db.daily[now]) db.daily[now] = emptyDaily();
    var d = db.daily[now];
    if (!d.learned) d.learned = [];
    if (!d.reviewed) d.reviewed = [];
    if (!d.dictation) d.dictation = { total: 0, correct: 0 };
    return d;
  }

  /* 就地写入：更新卡片 + 当日记录，返回本次结果 */
  function recordReview(db, wordId, q, dateStrNow) {
    var now = dateStrNow || today();
    if (!db.cards) db.cards = {};
    var before = db.cards[wordId] || newCard(wordId, now);
    var isNew = !before.history || before.history.length === 0;
    var after = schedule(before, q, now);
    db.cards[wordId] = after;

    var d = dailyOf(db, now);
    if (isNew) { if (d.learned.indexOf(wordId) < 0) d.learned.push(wordId); }
    else if (d.reviewed.indexOf(wordId) < 0) d.reviewed.push(wordId);

    return { card: after, isNew: isNew, interval: after.interval, due: after.due };
  }

  function recordDictation(db, dateStrNow, total, correct) {
    var d = dailyOf(db, dateStrNow || today());
    d.dictation.total += Number(total) || 0;
    d.dictation.correct += Number(correct) || 0;
    return d.dictation;
  }

  function touchDaily(db, dateStrNow) { return dailyOf(db, dateStrNow); }

  /* 今日进度：已学（新学 + 复习）/ 目标 */
  function progressOf(db, target, dateStrNow) {
    var s = stats(db, [], dateStrNow);
    var done = s.studiedToday;
    target = target || 15;
    return {
      done: done, target: target,
      pct: clamp(done / target, 0, 1),
      completed: done >= target
    };
  }

  function streakUp(streak, dateStrNow) {
    var now = dateStrNow || today();
    var s = { days: (streak && streak.days) || 0, last: (streak && streak.last) || '' };
    if (s.last === now) return s;
    s.days = (s.last && diffDays(s.last, now) === 1) ? s.days + 1 : 1;
    s.last = now;
    return s;
  }

  /* ==================== 听写 ==================== */
  function normalizeWord(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');
  }

  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1), cur = new Array(b.length + 1), i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  /* 判分：忽略大小写/空格/连字符；近拼写给「差一点」 */
  function checkSpelling(input, word) {
    var expected = normalizeWord(word);
    var got = normalizeWord(input);
    var dist = levenshtein(got, expected);
    var exact = got.length > 0 && got === expected;
    var near = !exact && got.length > 0 && dist <= (expected.length >= 8 ? 2 : 1);
    return {
      exact: exact, near: near, distance: dist,
      expected: word, normalizedExpected: expected, normalizedInput: got,
      empty: !got.length
    };
  }

  /* 听写抽题：优先「今日复习/新学」，不足补其它已学，再不足补未学 */
  function dictationPool(db, words, dateStrNow, n) {
    var now = dateStrNow || today();
    var cards = (db && db.cards) || {};
    var d = dailyOf(db, now);
    var picked = [], used = {};

    function push(w) { if (!used[w.id]) { used[w.id] = 1; picked.push(w); } }

    d.learned.concat(d.reviewed).forEach(function (id) {
      var w = (words || []).filter(function (x) { return x.id === id; })[0];
      if (w) push(w);
    });
    (words || []).forEach(function (w) {
      var c = cards[w.id];
      if (c && c.history && c.history.length) push(w);
    });
    (words || []).forEach(function (w) { push(w); });

    return picked.slice(0, n || 10);
  }

  var api = {
    uid: uid, clamp: clamp, r1: r1, r2: r2,
    today: today, dateStr: dateStr, addDays: addDays, diffDays: diffDays,
    newCard: newCard, schedule: schedule, masteryOf: masteryOf, retention: retention,
    buildQueue: buildQueue, dueForecast: dueForecast, stats: stats,
    emptyDaily: emptyDaily, dailyOf: dailyOf, recordReview: recordReview,
    recordDictation: recordDictation, touchDaily: touchDaily,
    progressOf: progressOf, streakUp: streakUp,
    normalizeWord: normalizeWord, levenshtein: levenshtein, checkSpelling: checkSpelling,
    dictationPool: dictationPool,
    MAX_INTERVAL: MAX_INTERVAL, MIN_EASE: MIN_EASE, MAX_EASE: MAX_EASE
  };

  root.SL = root.SL || {};
  root.SL.vocabEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
