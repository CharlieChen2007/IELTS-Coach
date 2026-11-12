/**
 * 交卷业务编排 —— 本地仓储与 Node 服务端「共用同一份」。
 * 这是「判题移到服务端后行为不变」的关键：两边都调 runAttempt()，只是数据来源不同。
 * 不依赖 DOM / fetch / 存储，可在 Node 与浏览器直接运行。
 */
import {
  gradeAttempt,
  toContractItems,
  summarize,
  buildReport,
  upsertWrongbook,
  judge,
  applyReview,
  pickSameType,
  entryToRetryItem,
  setErrorTag,
} from "../core/index.js";
import { makeAttemptId, attemptResponse, answersFromRequest } from "./contract.js";

/**
 * 判一次完整练习。
 * @returns {{ response, wrongbook, report, attempt }}
 */
export function runAttempt({
  practice,
  transcripts,
  answers,
  requestBody = null,
  userId,
  durationSec = 0,
  wrongbook = [],
  replayBySegment = {},
  now = new Date(),
}) {
  const ans = answers || answersFromRequest(requestBody);
  const practiceId = practice.practice_id;

  const graded = gradeAttempt(practice, ans);
  const items = toContractItems(practice, graded);
  const summary = summarize(graded, items);
  const attemptId = makeAttemptId(practiceId, userId, now);
  const report = buildReport({
    practiceId,
    skill: practice.skill || "listening",
    summary,
    contractItems: items,
    durationSec,
    finishedAt: now.toISOString(),
    attemptId,
  });

  const nextWrongbook = upsertWrongbook(wrongbook, {
    practice,
    contractItems: items,
    userId,
    practiceId,
    replayBySegment,
  });

  const attempt = {
    attempt_id: attemptId,
    user_id: userId,
    practice_id: practiceId,
    skill: "listening",
    total: summary.total,
    correct: summary.correct,
    wrong: summary.wrong,
    missed: summary.missed,
    accuracy: summary.accuracy,
    band_estimate: summary.band_estimate,
    error_tag_counts: summary.error_tag_counts,
    duration_sec: durationSec,
    finished_at: now.toISOString(),
    report,
  };

  return {
    response: attemptResponse({
      attemptId,
      practiceId,
      sectionLabel: practice.section_label || practice.segments?.[0]?.label || "",
      summary,
      items,
      report,
      transcripts,
      wrongbook: nextWrongbook,
    }),
    wrongbook: nextWrongbook,
    report,
    attempt,
  };
}

/** 打开复练弹窗时取题（不含正确答案）。mode: 'redo' | 'new' */
export function prepareReview({ practice, wrongbook, entryId, mode, rng = Math.random }) {
  const entry = wrongbook.find((e) => e.id === entryId);
  if (!entry) return null;

  let item;
  let sourceType;
  if (mode === "redo") {
    item = entryToRetryItem(entry);
    sourceType = "redo_original";
  } else {
    const picked = pickSameType(practice.items, entry, rng);
    if (!picked) return null;
    item = {
      id: picked.id,
      number: picked.number,
      type: picked.type,
      segment: picked.segment,
      part: picked.part,
      prompt: picked.prompt,
      retry_stem: picked.retry_stem,
      options: picked.options || null,
      word_limit: picked.word_limit || null,
      evidence: picked.evidence
        ? { audio_id: picked.evidence.audio_id, start: picked.evidence.start, end: picked.evidence.end }
        : null,
    };
    sourceType = "new_item_same_type";
  }

  // 只下发作答所需字段，正确答案不下发
  return {
    entry_id: entryId,
    mode,
    source_type: sourceType,
    item: {
      id: item.id,
      number: item.number,
      type: item.type,
      prompt: item.prompt,
      retry_stem: item.retry_stem,
      options: item.options,
      word_limit: item.word_limit,
      evidence: item.evidence,
    },
  };
}

/** 提交一次复练：服务端用完整题库判题，前端只传 item_id 与 answer。 */
export function runReview({ practice, wrongbook, entryId, itemId, mode, answer, rng = Math.random }) {
  const entry = wrongbook.find((e) => e.id === entryId);
  if (!entry) return null;

  const full = practice.items.find((i) => i.id === itemId);
  if (!full) return null;

  const r = judge(full, answer);
  const sourceType = mode === "redo" ? "redo_original" : "new_item_same_type";
  const nextWrongbook = applyReview(wrongbook, entryId, {
    source_type: sourceType,
    item_id: itemId,
    result: r.status,
  });
  const nextEntry = nextWrongbook.find((e) => e.id === entryId);

  return {
    result: r.status,
    tag: r.tag,
    correct_answer: (full.correct_answers || [])[0] || "",
    evidence: full.evidence
      ? { audio_id: full.evidence.audio_id, start: full.evidence.start, end: full.evidence.end }
      : null,
    source_type: sourceType,
    item_id: itemId,
    entry: nextEntry,
    wrongbook: nextWrongbook,
  };
}

/** 改选错因（用户修正系统预判）。 */
export function runSetTag({ wrongbook, entryId, tag }) {
  return setErrorTag(wrongbook, entryId, tag);
}
