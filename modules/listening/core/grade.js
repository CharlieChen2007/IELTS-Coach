/**
 * 判题内核。输入完整题库（含 correct_answers / distractors）与用户作答，输出三分状态与自动归因。
 * 服务端与本地仓储共用这一份实现，保证「迁移到后端后判分口径完全一致」。
 *
 * 纪律：编辑距离只用于打标签与生成提示，绝不放宽判对；拼错即零分。
 */
import { norm, countWords, levenshtein, hitAnswer, hitDistractor } from "./normalize.js";

/** 单题判定 → { status: 'correct'|'wrong'|'missed', tag: string|null } */
export function judge(item, raw) {
  const ua = String(raw ?? "").trim();

  // 匹配题按选项字母判分；也接受直接写选项文字（官方答案给的是文字）。
  // 与 mcq 不同：匹配题的 correct_answers 可以是 ['F', 'Rooms']。
  if (item.type === "mcq" || item.type === "match") {
    if (!ua) return { status: "missed", tag: null };
    const upper = ua.toUpperCase();
    const alts = (item.correct_answers || []).map((x) => String(x).toUpperCase());
    const ok = alts.includes(upper) || alts.includes(norm(ua).toUpperCase());
    if (!ok) {
      const dis = (item.distractors || []).map((x) => norm(x));
      return { status: "wrong", tag: hitDistractor(norm(ua), dis) ? "DISTRACTOR" : null };
    }
    return { status: "correct", tag: null };
  }

  if (!ua) return { status: "missed", tag: null };

  const u = norm(ua);
  const alts = (item.correct_answers || []).map(norm);
  const hit = hitAnswer(u, alts);
  const wl = item.word_limit || { max_words: 1, allow_number: true };
  const over = countWords(ua, wl.allow_number) > wl.max_words;

  if (hit && !over) return { status: "correct", tag: null };
  if (hit && over) return { status: "wrong", tag: "WORD_LIMIT" };

  // 命中改口前的旧值 / 干扰项 → 高置信「漏听自我更正」
  if (hitDistractor(u, (item.distractors || []).map(norm))) {
    return { status: "wrong", tag: "SELF_CORRECTION_MISS" };
  }

  const ans = alts[0] || "";
  if (u === ans) return { status: "wrong", tag: "WORD_LIMIT" };
  if (levenshtein(u, ans) <= 1 || (ans.length > 6 && levenshtein(u, ans) / ans.length < 0.2)) {
    return { status: "wrong", tag: "SPELLING" };
  }
  if (u.replace(/s$/, "") === ans.replace(/s$/, "")) {
    return { status: "wrong", tag: "SINGULAR_PLURAL" };
  }
  return { status: "wrong", tag: null };
}

/** 批量判定 → { [item_id]: { item_id, status, tag, user_answer } } */
export function gradeAttempt(practice, answers = {}) {
  const results = {};
  for (const item of practice.items) {
    const raw = answers[item.id];
    const { status, tag } = judge(item, raw);
    results[item.id] = {
      item_id: item.id,
      status,
      tag,
      user_answer: String(raw ?? "").trim(),
    };
  }
  return results;
}

/**
 * 把内核结果转成 POST /api/attempts 契约里的 items[]。
 * 仅判卷之后才调用 —— 此时答案 / 证据 / 解析才允许出现在下发给前端的数据里。
 */
export function toContractItems(practice, gradeResult) {
  return practice.items.map((item) => {
    const r = gradeResult[item.id];
    return {
      item_id: item.id,
      number: item.number,
      status: r.status,
      user_answer: r.user_answer,
      correct_answer: item.correct_answers || [],
      explanation: item.explanation || "",
      error_tag: r.tag,
      evidence: item.evidence
        ? {
            audio_id: item.evidence.audio_id,
            quote: item.evidence.quote,
            start: item.evidence.start,
            end: item.evidence.end,
          }
        : null,
      // 判后展示所需的附加字段（本模块扩展，见 docs/API_CONTRACT.md）
      question_type: item.type,
      part: item.part,
      segment: item.segment,
      trap_type: item.trap_type || null,
      word_limit: item.word_limit || null,
      retry_stem: item.retry_stem || "",
      options: item.options || null,
    };
  });
}

/** 把契约 items[] 与脱敏题面合并成结果页可直接渲染的视图模型。 */
export function buildResultView(practice, contractItems) {
  const pub = practice.items || [];
  const byId = Object.fromEntries(pub.map((i) => [i.id, i]));
  const view = {};
  for (const ci of contractItems) {
    const base = byId[ci.item_id] || {};
    view[ci.item_id] = {
      ...base,
      id: ci.item_id,
      type: ci.question_type || base.type,
      correct_answers: ci.correct_answer || [],
      evidence: ci.evidence || null,
      explanation: ci.explanation || "",
      trap_type: ci.trap_type,
      word_limit: ci.word_limit || base.word_limit || null,
      retry_stem: ci.retry_stem,
      options: ci.options || base.options || null,
      status: ci.status,
      tag: ci.error_tag || null,
      user_answer: ci.user_answer || "",
    };
  }
  return view;
}
