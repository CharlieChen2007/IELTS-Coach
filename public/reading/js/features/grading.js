// 判分引擎：纯函数，无 DOM 依赖，可单测
import { ENUM_ALIASES, isTextType, TYPE } from '../core/constants.js';

const FULLWIDTH = { '：': ':', '，': ',', '。': '.', '；': ';', '（': '(', '）': ')', '　': ' ' };

// 英美拼写差异（对答案无实质影响，雅思允许）
const SPELLING = [
  ['colour', 'color'], ['favour', 'favor'], ['behaviour', 'behavior'], ['labour', 'labor'],
  ['organise', 'organize'], ['realise', 'realize'], ['recognise', 'recognize'], ['analyse', 'analyze'],
  ['centre', 'center'], ['metre', 'meter'], ['litre', 'liter'], ['theatre', 'theater'],
  ['travelling', 'traveling'], ['travelled', 'traveled'], ['modelling', 'modeling'],
  ['practise', 'practice'], ['defence', 'defense'], ['licence', 'license'], ['programme', 'program'],
  ['catalogue', 'catalog'], ['judgement', 'judgment'], ['grey', 'gray'],
];

export function normalize(input) {
  let s = String(input ?? '');
  // 全角 ASCII（Ａ-Ｚ、０-９、：，等）→ 半角
  s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  for (const [a, b] of Object.entries(FULLWIDTH)) s = s.split(a).join(b);
  s = s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  s = s.replace(/[.,;:!?]+$/g, '').trim();
  return s;
}

function stripArticles(s) {
  return s.replace(/^(a|an|the)\s+/, '');
}

function unifySpelling(s) {
  for (const [a, b] of SPELLING) {
    if (s.includes(a)) s = s.split(a).join(b);
  }
  return s;
}

function squash(s) {
  // 连字符、空格、撇号差异不应影响判分
  return s.replace(/[\s'\-]/g, '');
}

export function wordCount(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** 返回 { status, normalized, reasonCode, detail } */
export function judge(question, section, response) {
  const empty = response === undefined || response === null || String(response).trim() === '';
  if (empty) {
    return { status: 'blank', normalized: '', reasonCode: 'blank', detail: '未作答' };
  }

  const type = section.type;
  const raw = String(response);

  // 枚举类：TRUE/FALSE/NOT GIVEN、YES/NO/NOT GIVEN、单选、标题匹配、段落匹配
  if (type === TYPE.TFNG || type === TYPE.YNNG || type === TYPE.MCQ
    || type === TYPE.MATCHING_HEADINGS || type === TYPE.MATCHING_INFORMATION) {
    const answerKey = String(question.answer.value).replace(/[\s\-]+/g, '_').toUpperCase();
    const got = normalize(raw).replace(/[\s\-]/g, '_').toUpperCase();
    const aliases = ENUM_ALIASES[answerKey] || [String(question.answer.value)];
    const ok = aliases.some((a) => normalize(a).replace(/[\s\-]/g, '_').toUpperCase() === got);
    return {
      status: ok ? 'correct' : 'wrong',
      normalized: raw,
      reasonCode: ok ? 'enum_match' : 'enum_mismatch',
      detail: ok ? '' : '与标准答案不符',
    };
  }

  // 文本类：填空
  if (isTextType(type)) {
    const limit = question.wordLimit ?? section.wordLimit ?? 0;
    const words = wordCount(raw);
    if (limit && words > limit) {
      return {
        status: 'wrong',
        normalized: normalize(raw),
        reasonCode: 'word_limit_exceeded',
        detail: `答案 ${words} 个词，超过上限 ${limit} 个词`,
        words,
        limit,
      };
    }

    const target = String(question.answer.value);
    const accepted = [target, ...(question.answer.accepted || [])];
    const gotNorm = normalize(raw);
    const variants = new Set([
      gotNorm,
      stripArticles(gotNorm),
      unifySpelling(gotNorm),
      stripArticles(unifySpelling(gotNorm)),
      squash(gotNorm),
    ]);

    let matched = false;
    for (const cand of accepted) {
      const cBase = normalize(cand);
      const cands = new Set([
        cBase, stripArticles(cBase), unifySpelling(cBase), stripArticles(unifySpelling(cBase)), squash(cBase),
        // 单复数容错
        cBase.endsWith('s') ? cBase.slice(0, -1) : `${cBase}s`,
      ]);
      for (const c of cands) if (variants.has(c)) matched = true;
    }
    if (matched) {
      return { status: 'correct', normalized: gotNorm, reasonCode: 'text_match', detail: '', words, limit };
    }

    // 近似判定：只用于给出「疑似拼写错误」提示，仍判错
    const near = accepted.some((cand) => {
      const c = squash(normalize(cand));
      const g = squash(gotNorm);
      return Math.abs(c.length - g.length) <= 1 && c.length >= 5 && editDistance(c, g) <= 1;
    });
    return {
      status: 'wrong',
      normalized: gotNorm,
      reasonCode: near ? 'spelling_suspect' : 'text_mismatch',
      detail: near ? '疑似拼写错误（雅思拼写错误不得分）' : '与答案不一致',
      words,
      limit,
    };
  }

  return { status: 'wrong', normalized: raw, reasonCode: 'unsupported', detail: '未知题型' };
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** 判整篇：返回每题的判定结果 + 汇总 */
export function gradePassage(passage, answers) {
  const results = [];
  for (const section of passage.sections) {
    for (const q of section.questions) {
      const r = judge(q, section, answers[q.id]);
      results.push({
        questionId: q.id,
        number: q.number,
        sectionId: section.id,
        type: section.type,
        stem: q.stem,
        options: q.options || null,
        answer: q.answer,
        response: answers[q.id] ?? '',
        explanation: q.explanation,
        ...r,
      });
    }
  }
  const total = results.length;
  const correct = results.filter((r) => r.status === 'correct').length;
  const blank = results.filter((r) => r.status === 'blank').length;
  return { results, total, correct, blank, wrong: total - correct };
}
