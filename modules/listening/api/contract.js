/**
 * 接口契约（字段名不可在开发中私改）。本文件是「字段常量 + DTO 构造 + 脱敏」的唯一来源，前后端共用。
 *
 * v2：一次练习 = 一个独立 section。每个 section 有自己的 practice_id，
 *     独立交卷、独立结果、独立错题本；服务端按 practice_id 分区存储。
 *
 * 核心接口：
 *   GET  /api/config                          运行配置 + 4 个 section 目录
 *   GET  /api/practices                       section 目录
 *   GET  /api/practices/:practice_id         取题（交卷前，脱敏）
 *   POST /api/attempts                       交卷判分（只判该 section）
 *   GET  /api/wrongbook?practice_id=         该 section 的错题本
 *   POST /api/wrongbook/:id/review           复练记录
 * 扩展：
 *   GET  /api/attempts?practice_id=          该 section 的历史记录
 *   POST /api/wrongbook/:id/tag              改选错因
 *   GET  /api/practices/:id/transcript       该 section 交卷后开放逐句原文
 *   GET  /api/progress?user_id=              4 个 section 的完成状态
 */

export const SKILL = "listening";
export const STATUSES = ["correct", "wrong", "missed"];
export const QUESTION_TYPES = ["table_completion", "mcq", "tfng", "match", "word_bank_completion"];

/** 交卷前必须从题面剥掉的字段。evidence.quote 直接含正确答案，distractors 是归因支点。 */
export const PRIVATE_ITEM_FIELDS = [
  "correct_answers",
  "distractors",
  "explanation",
  "evidence",
  "error_tags",
  "trap_type",
  "retry_stem",
];

/** 交卷前允许下发的题面字段白名单（其余一律剔除，新增字段默认不暴露）。 */
export const PUBLIC_ITEM_FIELDS = [
  "id",
  "number",
  "skill",
  "segment",
  "part",
  "type",
  "table_id",
  "blank",
  "prompt",
  "word_limit",
  "options",
];

/** 公开题面里允许的顶层元信息（不含 transcripts / 答案）。 */
export const PUBLIC_PRACTICE_FIELDS = [
  "title", "subtitle", "section_label", "section_name", "part",
  "type_label", "question_type", "source", "intro", "blurb",
  "tables", "options", "bank_title", "flow_steps",
];

/** 生成交卷前的公开题面。返回新对象，不修改入参。 */
export function toPublicPractice(practice) {
  const items = practice.items.map((it) => {
    const pub = {};
    for (const k of PUBLIC_ITEM_FIELDS) {
      if (it[k] !== undefined) pub[k] = it[k];
    }
    return pub;
  });
  const out = {
    practice_id: practice.practice_id,
    skill: practice.skill || SKILL,
    segments: practice.segments.map((s) => ({
      audio_id: s.audio_id,
      label: s.label,
      name: s.name,
      url: s.url,
      duration: s.duration,
      part: s.part,
      items: s.items,
      intro: s.intro,
    })),
    items,
    answer_policy: "server_graded",
  };
  for (const k of PUBLIC_PRACTICE_FIELDS) {
    if (practice[k] !== undefined) out[k] = practice[k];
  }
  return out;
}

/** section 目录：只含展示与导航所需字段。 */
export function toPublicCatalog(catalog) {
  return (catalog || []).map((c) => ({
    practice_id: c.practice_id,
    label: c.label,
    name: c.name,
    title: c.title,
    part: c.part,
    type_label: c.type_label,
    question_type: c.question_type,
    item_count: c.item_count,
    duration: c.duration,
    blurb: c.blurb,
    source: c.source,
  }));
}

/** 断言公开题面不含任何答案字段 —— 单测与安全边界检查用。 */
export function assertNoAnswers(publicPractice) {
  const leaks = [];
  for (const it of publicPractice.items || []) {
    for (const k of PRIVATE_ITEM_FIELDS) {
      if (k in it) leaks.push(`${it.id}.${k}`);
    }
  }
  if (leaks.length) throw new Error(`题面泄漏答案字段: ${leaks.join(", ")}`);
  return true;
}

/** POST /api/attempts 请求体 */
export function attemptRequest({ userId, practiceId, answers, durationSec = 0 }) {
  return {
    user_id: userId,
    practice_id: practiceId,
    skill: SKILL,
    answers: Object.entries(answers).map(([item_id, answer]) => ({ item_id, answer })),
    duration_sec: durationSec,
  };
}

/** 把请求体里的 answers[] 还原成 { item_id: answer } 映射，供内核判题。 */
export function answersFromRequest(body) {
  const out = {};
  for (const a of body.answers || []) out[a.item_id] = a.answer;
  return out;
}

/** POST /api/attempts 响应体（只包含本次交卷 section 的结果） */
export function attemptResponse({ attemptId, practiceId, sectionLabel, summary, items, report, transcripts, wrongbook }) {
  return {
    attempt_id: attemptId,
    practice_id: practiceId,
    section_label: sectionLabel || "",
    skill: SKILL,
    summary: {
      total: summary.total,
      correct: summary.correct,
      wrong: summary.wrong,
      missed: summary.missed,
      accuracy: summary.accuracy,
      band_estimate: summary.band_estimate,
    },
    items,
    report,
    // 判卷后才下发逐句原文，交卷前接口绝不返回；只含本 section
    transcripts: transcripts || null,
    wrongbook: wrongbook || [],
  };
}

export function makeAttemptId(practiceId, userId, now = new Date()) {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `att_${practiceId}_${ts}_${crypto.randomUUID()}`;
}
