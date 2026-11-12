/**
 * 错因标签字典与文案模板。纯字符串函数，框架无关。
 * 12 个标签枚举由听力 / 阅读模块共用，字段值不可私改（全队契约）。
 */

export const TAGS = {
  SELF_CORRECTION_MISS: "漏听自我更正",
  DISTRACTOR: "被干扰项带走",
  NUMBER_DATE: "数字/日期听错",
  SPELLING: "拼写错误",
  SINGULAR_PLURAL: "单复数听错",
  SYNONYM_MISS: "同义替换没听出",
  NEGATION: "否定/转折漏判",
  WORD_LIMIT: "超出字数限制",
  SPEED_LOST: "语速跟不上",
  ATTENTION_LAPSE: "注意力中断",
  UNKNOWN_WORD: "生词没听懂",
  MISREAD_PROMPT: "审题不清",
  OTHER: "其他/说不清",
};

/** 三层分组，供结果页 / 统计面板渲染，不改变枚举值。 */
export const TAG_LAYERS = [
  { layer: "音形", tags: ["SPELLING", "SINGULAR_PLURAL", "NUMBER_DATE", "WORD_LIMIT"] },
  { layer: "语义", tags: ["SYNONYM_MISS", "DISTRACTOR", "NEGATION"] },
  { layer: "注意", tags: ["SELF_CORRECTION_MISS", "SPEED_LOST", "ATTENTION_LAPSE", "UNKNOWN_WORD", "MISREAD_PROMPT"] },
];

export const QUESTION_TYPE_LABELS = {
  table_completion: "表格填空",
  mcq: "单选题",
  tfng: "判断题",
  match: "匹配题",
  word_bank_completion: "流程图选词填空",
};

/** 一句话可执行改进建议。evidence 为判后可见的出处对象；模型不可用时用它兜底。 */
export function tipFor(tag, evidence = null) {
  const at = evidence && Number.isFinite(evidence.start) ? ` ${evidence.start.toFixed(1)}s 处` : "答案出处";
  switch (tag) {
    case "SELF_CORRECTION_MISS":
      return `你写的是改口前的信息。${at}说话人用 “Sorry / hold on” 更正，答案取后半句。下次听到这类信号词，先划掉已写内容再落笔。`;
    case "DISTRACTOR":
      return "这题的干扰项在正确答案附近，且念得更响。练习时先看题干关键词，听到第一个相似信息不要立刻作答。";
    case "SYNONYM_MISS":
      return "题干与原文换了说法，需要做同义替换映射。把这一组替换抄进同义替换库，下次先预测可能出现的表达。";
    case "SPELLING":
      return "答案听对了但拼写有误，雅思拼错不得分。把该词加入拼写清单，听写时按音节拆开写。";
    case "SINGULAR_PLURAL":
      return "只差单复数。听的时候注意词尾的 /s/、/z/ 音，以及 a / two 这类限定词给出的提示。";
    case "NUMBER_DATE":
      return "数字或日期听错，注意 -teen 与 -ty 的重音位置，以及日期先说日后说月的顺序。";
    case "WORD_LIMIT":
      return "内容对了但超出字数限制，同样不得分。先看清题目允许几个词，再决定写不写冠词。";
    default:
      return "回听答案出处，确认是没听到、听错，还是被前面的信息带走，再在错题本里选一个最接近的原因。";
  }
}

/** 把出处句里的答案词高亮。纯字符串处理，返回可插入 innerHTML 的片段。 */
export function highlightQuote(quote = "", key = null) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let q = esc(quote);
  if (key) {
    const raw = esc(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q = q.replace(new RegExp(raw, "i"), (m) => `<em>${m}</em>`);
  } else {
    q = q.replace(/(sorry|hold on|actually|\bno\b|\bbut\b|let's see|I'm afraid)/gi, (m) => `<em>${m}</em>`);
  }
  return q;
}
