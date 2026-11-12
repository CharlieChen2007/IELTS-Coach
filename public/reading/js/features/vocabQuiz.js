// 单词本自测题：选择题（英文 → 中文释义）+ 拼写题（中文释义 → 英文）
// 纯函数 + 可注入 rng，便于单测
import { sameWord, sortVocab } from './vocab.js';

export const QUIZ_TYPE_LABEL = { choice: '选择题', spell: '拼写题' };

function shuffle(list, rng) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 拼写提示：首字母 + 点数，另给字母个数（连字符/撇号不计） */
export function spellHint(word) {
  const letters = String(word).replace(/[^A-Za-z]/g, '');
  const first = letters.slice(0, 1).toLowerCase();
  return { mask: `${first}${'·'.repeat(Math.max(0, letters.length - 1))}`, letters: letters.length };
}

/**
 * 生成一套自测题。
 * @param {Array} entries 收藏的词条
 * @param {{count?: number, pool?: Array, rng?: () => number}} opts pool 为干扰项来源（词库全量词条）
 */
export function buildQuiz(entries, { count = 10, pool = [], rng = Math.random } = {}) {
  // 没有释义的词没法出题（提示 / 干扰项都依赖中文释义），直接跳过
  const usable = (entries || []).filter((x) => x && x.word && String(x.zh || '').trim());
  if (!usable.length) return [];
  const limit = Math.max(1, Math.min(count, usable.length));
  const picked = shuffle(sortVocab(usable), rng).slice(0, limit);
  const allMeanings = [...new Set(
    [...usable, ...(pool || [])].map((v) => String(v.zh || '').trim()).filter(Boolean),
  )];

  return picked.map((item, i) => {
    const zh = String(item.zh).trim();
    const base = {
      word: item.word,
      pos: item.pos || '',
      zh,
      passageId: item.passageId || '',
      passageLabel: item.passageLabel || '',
    };
    const wrong = shuffle(allMeanings.filter((x) => x !== zh), rng).slice(0, 3);
    // 干扰项不足 1 个时不出选择题（否则会变成「只有一个选项」的假题）
    if (i % 2 === 0 && wrong.length >= 1) {
      return { ...base, type: 'choice', prompt: item.word, options: shuffle([zh, ...wrong], rng), answer: zh };
    }
    const hint = spellHint(item.word);
    return { ...base, type: 'spell', prompt: zh, ...hint, answer: item.word };
  });
}

/** 判一道题：choice 传选项文本，spell 传输入串 */
export function judge(question, input) {
  if (question.type === 'choice') {
    const value = String(input ?? '');
    return { ok: value === question.answer, expected: question.answer };
  }
  return { ok: sameWord(input, question.answer), expected: question.answer };
}
