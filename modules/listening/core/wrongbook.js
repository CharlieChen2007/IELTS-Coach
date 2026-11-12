/**
 * 错题本内核。纯函数：输入旧列表 + 判卷结果，输出新列表（不修改入参），便于 React state 与单测。
 * 与阅读模块共用同一套结构，靠 skill 字段分区（全队契约）。
 */
import { TAGS } from "./text.js";

export const SOURCE_TYPES = ["redo_original", "new_item_same_type"];

/** 生成 / 更新一条错题条目。必须保留 item_snapshot，否则题库改字后历史记录失真。 */
export function upsertWrongbook(list, { practice, contractItems, userId, practiceId, replayBySegment = {} }) {
  const next = list.slice();
  for (const ci of contractItems) {
    if (ci.status === "correct") continue;
    const idx = next.findIndex((e) => e.item_id === ci.item_id && e.user_id === userId);
    const prev = idx >= 0 ? next[idx] : null;

    const ev = ci.evidence || {};
    const entry = {
      id: `wb_${ci.item_id}_${userId}`,
      user_id: userId,
      skill: "listening",
      item_id: ci.item_id,
      practice_id: practiceId,
      question_type: ci.question_type,
      part: ci.part,
      item_snapshot: {
        prompt: ci.retry_stem || "",
        retry_stem: ci.retry_stem || "",
        options: ci.options || null,
        correct_answers: ci.correct_answer || [],
        quote: ev.quote || "",
        start: ev.start ?? null,
        end: ev.end ?? null,
        segment: ci.segment,
        audio_id: ev.audio_id || ci.segment,
        word_limit: ci.word_limit || null,
        trap_type: ci.trap_type || null,
      },
      user_answer: ci.user_answer || "",
      correct_answer: (ci.correct_answer || [])[0] || "",
      error_tag: ci.error_tag || "OTHER",
      auto_tag: ci.error_tag || null,
      error_tag_source: ci.error_tag ? "auto" : "none",
      wrong_count: prev ? prev.wrong_count + 1 : 1,
      replay_count: replayBySegment[ci.segment] || 0,
      status: prev ? "reviewing" : "new",
      review_history: prev ? prev.review_history.slice() : [],
      created_at: prev ? prev.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) next[idx] = entry;
    else next.unshift(entry);
  }
  return next;
}

/** 用户改选错因：写 error_tag_source='user_corrected'，保留 auto_tag 以便评估系统预判准度。 */
export function setErrorTag(list, entryId, tag) {
  if (!TAGS[tag]) throw new Error(`未知错因标签: ${tag}`);
  return list.map((e) =>
    e.id === entryId
      ? { ...e, error_tag: tag, error_tag_source: "user_corrected", updated_at: new Date().toISOString() }
      : e,
  );
}

/** 追加一次复练记录；连续 2 次 correct 才置 mastered。 */
export function applyReview(list, entryId, { source_type, item_id, result }) {
  if (!SOURCE_TYPES.includes(source_type)) throw new Error(`未知 source_type: ${source_type}`);
  return list.map((e) => {
    if (e.id !== entryId) return e;
    const review_history = [
      ...e.review_history,
      { source_type, item_id, result, at: new Date().toISOString() },
    ];
    const last2 = review_history.slice(-2);
    const status = last2.length === 2 && last2.every((h) => h.result === "correct") ? "mastered" : "reviewing";
    return { ...e, review_history, status, updated_at: new Date().toISOString() };
  });
}

/** 两种复练分别统计正确率（结果页 / 错题本抽屉顶部展示）。 */
export function reviewRates(list, sourceType) {
  const hits = list.flatMap((e) => e.review_history || []).filter((h) => h.source_type === sourceType);
  if (!hits.length) return null;
  return Math.round((hits.filter((h) => h.result === "correct").length / hits.length) * 100);
}

/**
 * 同类换材料抽题：同 skill + question_type、优先同 part、排除原题、优先另一段材料。
 * 正式版接题库后按 skill + question_type + part + error_tag 检索，此处保持同一函数签名。
 */
export function pickSameType(items, entry, rng = Math.random) {
  const t = entry.question_type;
  let pool = items.filter(
    (i) => i.type === t && i.id !== entry.item_id && i.segment !== entry.item_snapshot.segment,
  );
  if (!pool.length) {
    pool = items.filter((i) => i.type === t && i.id !== entry.item_id);
  }
  if (!pool.length) return null;
  const samePart = pool.filter((i) => i.part === entry.part);
  const use = samePart.length ? samePart : pool;
  return use[Math.floor(rng() * use.length)];
}

/** 错题条目 → 可复练的题目（重听原题时用）。 */
export function entryToRetryItem(entry) {
  const s = entry.item_snapshot;
  return {
    id: entry.item_id,
    type: entry.question_type,
    segment: s.segment,
    part: entry.part,
    retry_stem: s.retry_stem,
    options: s.options,
    correct_answers: s.correct_answers,
    word_limit: s.word_limit,
    evidence: {
      audio_id: s.audio_id,
      start: s.start,
      end: s.end,
      quote: s.quote,
    },
  };
}
