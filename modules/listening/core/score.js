/**
 * 汇总、分数换算与「六模块共用报告格式」生成。纯函数、框架无关。
 * 这一层补齐了 Demo 未实现的 next_actions / band_estimate（交接文档第九节待办 5、6）。
 */
import { TAGS, QUESTION_TYPE_LABELS } from "./text.js";

/**
 * Academic Listening 原始分 /40 → band 常用对照（IDP / IELTS Australia 公布口径）。
 * 练习只有 12 题，按比例折算到 /40 后查表，仅供参考，不能当作正式成绩。
 */
export const BAND_TABLE = [
  { min: 39, max: 40, band: 9.0 },
  { min: 37, max: 38, band: 8.5 },
  { min: 35, max: 36, band: 8.0 },
  { min: 32, max: 34, band: 7.5 },
  { min: 30, max: 31, band: 7.0 },
  { min: 26, max: 29, band: 6.5 },
  { min: 23, max: 25, band: 6.0 },
  { min: 18, max: 22, band: 5.5 },
  { min: 16, max: 17, band: 5.0 },
  { min: 13, max: 15, band: 4.5 },
  { min: 10, max: 12, band: 4.0 },
  { min: 8, max: 9, band: 3.5 },
  { min: 6, max: 7, band: 3.0 },
  { min: 4, max: 5, band: 2.5 },
];

export function rawToBand(raw40) {
  const hit = BAND_TABLE.find((r) => raw40 >= r.min && raw40 <= r.max);
  return hit ? hit.band : 2.0;
}

/** 把 n 题练习按比例折算成 /40 再查表；样本小，标注「仅供参考」。 */
export function estimateBand(correct, total) {
  if (!total) return null;
  return rawToBand(Math.round((correct / total) * 40));
}

/** 从内核 gradeResult 汇总。返回契约 summary 的超集（含 error_tag_counts）。 */
export function summarize(gradeResult, contractItems = []) {
  const vals = Object.values(gradeResult);
  const total = vals.length;
  const correct = vals.filter((r) => r.status === "correct").length;
  const wrong = vals.filter((r) => r.status === "wrong").length;
  const missed = vals.filter((r) => r.status === "missed").length;
  const error_tag_counts = {};
  for (const r of vals) {
    if (r.status !== "correct" && r.tag) {
      error_tag_counts[r.tag] = (error_tag_counts[r.tag] || 0) + 1;
    }
  }
  return {
    total,
    correct,
    wrong,
    missed,
    accuracy: total ? +(correct / total).toFixed(2) : 0,
    band_estimate: estimateBand(correct, total),
    error_tag_counts,
  };
}

/**
 * 生成 next_actions —— 前端每日任务的唯一内容源。
 * 必须是可执行动作（含数量、材料、动作），不能写「多练习」这类空泛建议。
 */
export function nextActions(summary, contractItems = []) {
  const actions = [];
  const counts = summary.error_tag_counts || {};
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const replayTag = sorted.find(([tag]) => ["SELF_CORRECTION_MISS", "DISTRACTOR", "SYNONYM_MISS"].includes(tag));
  if (replayTag) {
    actions.push(`回听 ${replayTag[1]} 道「${TAGS[replayTag[0]]}」题的答案出处，各跟读一遍改口句`);
  }
  if (counts.WORD_LIMIT) {
    actions.push(`复做 ${counts.WORD_LIMIT} 道超词数填空，只写题干要求的关键词`);
  }
  if (counts.SPELLING) {
    actions.push(`听写 ${counts.SPELLING} 个拼错的答案词，按音节拆分各抄 3 遍`);
  }
  if (summary.missed) {
    actions.push(`补做 ${summary.missed} 道漏答题，练习先读题划关键词再听`);
  }

  // 换材料做同题型新题：按错题最多的题型给一条
  const wrongTypes = {};
  for (const ci of contractItems) {
    if (ci.status !== "correct") {
      const t = ci.question_type || "table_completion";
      wrongTypes[t] = (wrongTypes[t] || 0) + 1;
    }
  }
  const topType = Object.entries(wrongTypes).sort((a, b) => b[1] - a[1])[0];
  if (topType) {
    const label = QUESTION_TYPE_LABELS[topType[0]] || topType[0];
    actions.push(`从本段错题本换一道${label}，留意题干中的定位词`);
  }
  if (!actions.length) {
    actions.push("本段全部答对，选择另一段原声，练习不同场景下的信息定位");
  }
  return actions.slice(0, 3);
}

/**
 * 六模块共用报告格式。前端分数曲线读 accuracy / error_tag_counts，
 * 每日任务读 next_actions，学习记录只需回写 items_done / accuracy / error_tag_counts。
 */
export function buildReport({
  practiceId,
  skill = "listening",
  summary,
  contractItems = [],
  durationSec = 0,
  finishedAt = new Date().toISOString(),
  attemptId = null,
}) {
  return {
    practice_id: practiceId,
    skill,
    attempt_id: attemptId,
    total: summary.total,
    correct: summary.correct,
    wrong: summary.wrong,
    missed: summary.missed,
    accuracy: summary.accuracy,
    band_estimate: summary.band_estimate,
    error_tag_counts: summary.error_tag_counts,
    duration_sec: durationSec,
    finished_at: finishedAt,
    next_actions: nextActions(summary, contractItems),
  };
}

/** 学习记录回写的最小三字段（给前端进度条 / 分数曲线用）。 */
export function toLearningRecord(report) {
  return {
    items_done: report.total,
    accuracy: report.accuracy,
    error_tag_counts: report.error_tag_counts,
  };
}
