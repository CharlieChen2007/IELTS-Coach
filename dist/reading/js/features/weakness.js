// 薄弱题型统计：只看近 30 天，每道题只取「窗口内第一次作答」
import { TYPE_LABEL } from '../core/constants.js';

export const WEAK_RULES = { days: 30, minSample: 3, threshold: 0.6 };

const DAY = 86400000;

/** 会话归属时间：优先交卷时间 */
function atOf(session) {
  return session && (session.finishedAt || session.startedAt) || 0;
}

/**
 * 按题型汇总首次回答的正确率。
 * @param {Array<{passageId: string, finishedAt?: number, startedAt?: number, results?: Array}>} sessions
 * @param {{now?: number, days?: number, minSample?: number, threshold?: number}} options
 */
export function weakTypeStats(sessions = [], options = {}) {
  const days = options.days ?? WEAK_RULES.days;
  const minSample = options.minSample ?? WEAK_RULES.minSample;
  const threshold = options.threshold ?? WEAK_RULES.threshold;
  const now = options.now ?? Date.now();
  const from = now - days * DAY;

  const inWindow = sessions
    .filter((s) => atOf(s) >= from && atOf(s) <= now)
    .sort((a, b) => atOf(a) - atOf(b));

  // 首次回答：同一道题在窗口内做过多次，只保留最早那一次
  const first = new Map();
  for (const session of inWindow) {
    for (const r of session.results || []) {
      if (!r || r.number === undefined || r.number === null) continue;
      const key = `${session.passageId}:${r.number}`;
      if (!first.has(key)) first.set(key, r);
    }
  }

  const buckets = new Map(Object.keys(TYPE_LABEL).map(type=>[type,{type,total:0,correct:0,blank:0}]));
  for (const r of first.values()) {
    const type = r.type || 'UNKNOWN';
    if (!buckets.has(type)) buckets.set(type, { type, total: 0, correct: 0, blank: 0 });
    const bucket = buckets.get(type);
    bucket.total += 1;
    if (r.status === 'correct') bucket.correct += 1;
    else if (r.status === 'blank') bucket.blank += 1;
  }

  const types = [...buckets.values()].map((bucket) => {
    const accuracy = bucket.total ? bucket.correct / bucket.total : 0;
    const flag = bucket.total < minSample
      ? 'insufficient'
      : (accuracy < threshold ? 'priority' : 'ok');
    return { ...bucket, accuracy, flag, label: TYPE_LABEL[bucket.type] || bucket.type };
  });

  const RANK = { priority: 0, insufficient: 1, ok: 2 };
  types.sort((a, b) => RANK[a.flag] - RANK[b.flag] || a.accuracy - b.accuracy || b.total - a.total);

  return {
    from,
    to: now,
    days,
    minSample,
    threshold,
    answered: first.size,
    types,
    priorityCount: types.filter((t) => t.flag === 'priority').length,
    insufficientCount: types.filter((t) => t.flag === 'insufficient').length,
    okCount: types.filter((t) => t.flag === 'ok').length,
  };
}
