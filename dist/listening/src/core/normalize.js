/**
 * 文本归一化与计词 —— 判题口径的唯一来源。
 * 纯函数、零依赖、零 DOM，浏览器 / Node / React / Vue 均可直接 import。
 *
 * 口径（见 docs/API_CONTRACT.md 与交接文档第六节，不得放宽）：
 *  - 大小写不计分；拼写错误即零分；英美拼写通过 correct_answers 允许数组兼容
 *  - 归一化顺序：NFKC → 小写 → 引号统一 → 去标点(保留 - 与 ') → 合并空格 → trim
 *  - 计词按官方规则而非空格数：连字符词算 1 词；AND/OR A NUMBER 下数字不占词数
 */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}\s'\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 按官方规则计词。allowNumber=true 时纯数字 / 日期 / 金额 token 不占词数。 */
export function countWords(s, allowNumber = true) {
  const toks = norm(s).split(" ").filter(Boolean);
  let words = 0;
  let nums = 0;
  for (const t of toks) {
    if (/^[\d.,:/-]+$/.test(t)) nums++;
    else words++;
  }
  return allowNumber ? words : words + nums;
}

/** Levenshtein 编辑距离。只用于「诊断 / 打标签」，绝不用于放宽判对。 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** 内容是否命中允许答案（含去连字符、去撇号变体）。userNorm 与 alternatives 都应是 norm() 后的值。 */
export function hitAnswer(userNorm, alternatives) {
  return alternatives.some(
    (a) =>
      a === userNorm ||
      a === userNorm.replace(/-/g, " ") ||
      a === userNorm.replace(/'/g, ""),
  );
}

/** 用户答案是否落在「改口前 / 干扰项」里 —— 自动归因「漏听自我更正」的支点。 */
export function hitDistractor(userNorm, distractors) {
  return distractors.includes(userNorm);
}
