// 练习热力图：近 N 天每天做了多少题（纯函数，输入 sessions）
export const HEATMAP_RULES = { days: 30, levels: [5, 10, 19] };

const DAY = 86400000;

function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function levelOf(questions, levels = HEATMAP_RULES.levels) {
  if (questions <= 0) return 0; // 没做题 = 空格子，不能算最浅一档
  for (let i = 0; i < levels.length; i++) if (questions <= levels[i]) return i + 1;
  return levels.length + 1;
}

/**
 * @param {Array} sessions 交卷会话
 * @param {{now?: number, days?: number}} opts
 * @returns {{days:number, from:number, to:number,
 *   cells:Array<{ts:number, sessions:number, questions:number, correct:number, level:number}>,
 *   totals:{sessions:number, questions:number, correct:number, activeDays:number, max:number}}}
 */
export function practiceHeatmap(sessions = [], opts = {}) {
  const { now = Date.now(), days = HEATMAP_RULES.days } = opts;
  const to = startOfLocalDay(now);
  const from = to - (days - 1) * DAY;

  const buckets = new Map();
  for (const s of sessions) {
    const ts = s?.finishedAt || s?.startedAt;
    if (!ts || ts < from || ts >= to + DAY) continue;
    const key = startOfLocalDay(ts);
    const b = buckets.get(key) || { sessions: 0, questions: 0, correct: 0 };
    b.sessions += 1;
    for (const r of s.results || []) {
      b.questions += 1;
      if (r.status === 'correct') b.correct += 1;
    }
    buckets.set(key, b);
  }

  const cells = [];
  let activeDays = 0;
  let totalSessions = 0;
  let totalQuestions = 0;
  let totalCorrect = 0;
  let max = 0;
  for (let i = 0; i < days; i++) {
    const ts = from + i * DAY;
    const b = buckets.get(ts) || { sessions: 0, questions: 0, correct: 0 };
    const level = levelOf(b.questions);
    cells.push({ ts, sessions: b.sessions, questions: b.questions, correct: b.correct, level });
    if (b.questions > 0) activeDays += 1;
    totalSessions += b.sessions;
    totalQuestions += b.questions;
    totalCorrect += b.correct;
    if (b.questions > max) max = b.questions;
  }

  return {
    days,
    from,
    to,
    cells,
    totals: { sessions: totalSessions, questions: totalQuestions, correct: totalCorrect, activeDays, max },
  };
}
