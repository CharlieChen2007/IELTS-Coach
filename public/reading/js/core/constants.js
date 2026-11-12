// 领域常量：题型、枚举项、band 换算表
export const TYPE = {
  TFNG: 'TFNG',
  YNNG: 'YNNG',
  MCQ: 'MCQ',
  SUMMARY_COMPLETION: 'SUMMARY_COMPLETION',
  SENTENCE_COMPLETION: 'SENTENCE_COMPLETION',
  SHORT_ANSWER: 'SHORT_ANSWER',
  MATCHING_HEADINGS: 'MATCHING_HEADINGS',
  MATCHING_INFORMATION: 'MATCHING_INFORMATION',
};

export const TYPE_LABEL = {
  TFNG: '判断题 T/F/NG',
  YNNG: '观点判断 Y/N/NG',
  MCQ: '单选题',
  SUMMARY_COMPLETION: '摘要填空',
  SENTENCE_COMPLETION: '句子填空',
  SHORT_ANSWER: '简答',
  MATCHING_HEADINGS: '标题匹配',
  MATCHING_INFORMATION: '段落信息匹配',
};

// 判断题的三个选项（TFNG 与 YNNG 的措辞不同，这是雅思的硬规则）
export const ENUM_OPTIONS = {
  TFNG: [
    { value: 'TRUE', label: 'TRUE' },
    { value: 'FALSE', label: 'FALSE' },
    { value: 'NOT_GIVEN', label: 'NOT GIVEN' },
  ],
  YNNG: [
    { value: 'YES', label: 'YES' },
    { value: 'NO', label: 'NO' },
    { value: 'NOT_GIVEN', label: 'NOT GIVEN' },
  ],
};

export const ANSWER_LABEL = {
  TRUE: 'TRUE', FALSE: 'FALSE', TRUE_ALT: 'TRUE',
  YES: 'YES', NO: 'NO',
  NOT_GIVEN: 'NOT GIVEN', NG: 'NOT GIVEN',
};

// 同一答案的合法写法
export const ENUM_ALIASES = {
  TRUE: ['TRUE', 'T'],
  FALSE: ['FALSE', 'F'],
  YES: ['YES', 'Y'],
  NO: ['NO', 'N'],
  NOT_GIVEN: ['NOT GIVEN', 'NG', 'NOTGIVEN', 'NOT-GIVEN'],
};

// Academic Reading 原始分（满分 40）→ band，官方逐场微调，此处为通用表
const BAND_BANDS = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5],
  [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5],
];

export function bandFor(correct, total) {
  if (!total) return 0;
  const raw40 = Math.round((correct / total) * 40);
  for (const [min, band] of BAND_BANDS) {
    if (raw40 >= min) return band;
  }
  return 2;
}

export function isTextType(type) {
  return type === TYPE.SUMMARY_COMPLETION
    || type === TYPE.SENTENCE_COMPLETION
    || type === TYPE.SHORT_ANSWER;
}
