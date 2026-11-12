// 单词相关纯函数：切词、查词库、句子截取、收藏条目、筛选（便于单测，不碰 DOM）

const WORD_CHAR = /[A-Za-z'’\-]/;

/** 归一化：小写、统一撇号、去掉首尾非字母 */
export function normalizeWord(raw) {
  return String(raw ?? '')
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z]+$/, '');
}

/**
 * 在纯文本里按偏移取单词（点位置落在标点上时向左侧取）。
 * @returns {{ word: string, raw: string, start: number, end: number } | null}
 */
export function wordAt(text, offset) {
  const s = String(text ?? '');
  if (!s) return null;
  let i = Math.max(0, Math.min(Number(offset) || 0, s.length - 1));
  if (!WORD_CHAR.test(s[i] || '')) {
    if (WORD_CHAR.test(s[i - 1] || '')) {
      i -= 1; // 点在空格/逗号上：取左边这个词
    } else {
      while (i < s.length && !WORD_CHAR.test(s[i])) i += 1; // 点在开头引号等符号上：向右找回单词
      if (i >= s.length) return null;
    }
  }
  let start = i;
  while (start > 0 && WORD_CHAR.test(s[start - 1])) start -= 1;
  let end = i;
  while (end < s.length && WORD_CHAR.test(s[end])) end += 1;
  const raw = s.slice(start, end);
  const word = normalizeWord(raw);
  if (!word) return null;
  const lead = raw.length - raw.replace(/^[^A-Za-z]+/, '').length;
  return { word, raw, start: start + lead, end };
}

/** 屈折形式回落：books → book，making → make，happier → happy… */
export function candidates(word) {
  const out = [];
  const push = (v) => {
    if (v && v.length > 1 && v !== word && !out.includes(v)) out.push(v);
  };
  if (word.endsWith('ies')) push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) {
    push(word.slice(0, -2));
    push(word.slice(0, -1));
  }
  if (word.endsWith('s') && !word.endsWith('ss')) push(word.slice(0, -1));
  if (word.endsWith('ed')) {
    push(word.slice(0, -2));
    push(word.slice(0, -1));
    push(word.slice(0, -2).replace(/([b-df-hj-np-tv-z])\1$/, '$1'));
  }
  if (word.endsWith('ing')) {
    push(word.slice(0, -3));
    push(`${word.slice(0, -3)}e`);
    push(word.slice(0, -3).replace(/([b-df-hj-np-tv-z])\1$/, '$1'));
  }
  if (word.endsWith('est')) push(word.slice(0, -3));
  if (word.endsWith('er')) push(word.slice(0, -2));
  if (word.endsWith('ly')) push(word.slice(0, -2));
  return out;
}

function buildEntry(form, value, words, detail) {
  if (!Array.isArray(value)) return null;
  const [pos = '', zh = '', lemma] = value;
  if (!zh) return null;
  // 有原形就用原形当词头（原形条目本身可能不在词库里，这时沿用词形的词性/释义）
  const base = lemma ? words[lemma] : null;
  const word = lemma || form;
  const extra = detail?.[word] || null;
  const entry = {
    form,
    word,
    pos: base ? (base[0] || pos) : pos,
    zh: base ? (base[1] || zh) : zh,
  };
  if (extra) entry.detail = extra;
  return entry;
}

/**
 * 查词库。命中返回 { word(词头), form(点击到的词形), pos, zh, detail? }，未收录返回 null。
 * detail = glossary-detail 的 detail 表（可选）：{ 词头: { ipa:{uk,us}, forms:[], coll:[] } }
 */
export function lookup(glossary, raw, detail = null) {
  const words = glossary?.words || {};
  const word = normalizeWord(raw);
  if (!word) return null;
  const direct = words[word];
  if (direct) return buildEntry(word, direct, words, detail);
  for (const cand of candidates(word)) {
    const hit = words[cand];
    if (hit) return buildEntry(cand, hit, words, detail);
  }
  return null;
}

/** 取单词所在的那一句（以 . ! ? 换行为界），过长时回退到词两侧窗口 */
export function sentenceAt(text, start, end) {
  const s = String(text ?? '');
  const isEnd = (c) => c === '.' || c === '!' || c === '?' || c === '\n';
  let a = Math.max(0, Math.min(start, s.length));
  while (a > 0 && !isEnd(s[a - 1])) a -= 1;
  let b = Math.min(s.length, Math.max(end, a));
  while (b < s.length && !isEnd(s[b])) b += 1;
  if (b < s.length && s[b] !== '\n') b += 1;
  let out = s.slice(a, b).trim().replace(/^["'“”‘’\s]+/, '').replace(/["'“”‘’\s]+$/, '');
  if (out.length > 220) {
    const from = Math.max(0, start - 90);
    const to = Math.min(s.length, end + 110);
    out = `${from > 0 ? '…' : ''}${s.slice(from, to).trim()}${to < s.length ? '…' : ''}`;
  }
  return out;
}

/**
 * 生成一条收藏记录。
 * @param {{passage?: object, paragraph?: string, sentence?: string, word: string, hit?: object|null, now?: number}} opts
 */
export function makeVocabEntry({ passage = null, paragraph = '', sentence = '', word, surface = '', hit = null, now = Date.now() }) {
  const form = normalizeWord(surface) || normalizeWord(word) || hit?.form || '';
  return {
    word: hit?.word || form,
    form,
    pos: hit?.pos || '',
    zh: hit?.zh || '',
    passageId: passage?.id || '',
    passageLabel: passage?.label || '',
    passageTitle: passage?.titleZh || passage?.title || '',
    paragraph: paragraph || '',
    sentence: sentence || '',
    at: now,
  };
}

/** 最近收藏在前，同时间按词头排序 */
export function sortVocab(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const d = (b.at || 0) - (a.at || 0);
    return d !== 0 ? d : String(a.word).localeCompare(String(b.word));
  });
}

/** 关键词（英文词头 / 中文释义）+ 篇章筛选 */
export function filterVocab(list, { query = '', passageId = '' } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  return sortVocab(list).filter((v) => {
    if (passageId && v.passageId !== passageId) return false;
    if (!q) return true;
    return String(v.word).toLowerCase().includes(q)
      || String(v.form || '').toLowerCase().includes(q)
      || String(v.zh || '').toLowerCase().includes(q);
  });
}

/** 单词本统计：总数 + 每篇分布 */
export function vocabStats(list) {
  const items = Array.isArray(list) ? list : [];
  const byPassage = new Map();
  for (const v of items) {
    const id = v.passageId || '';
    const cur = byPassage.get(id) || {
      id, label: v.passageLabel || '', title: v.passageTitle || '', count: 0,
    };
    cur.count += 1;
    byPassage.set(id, cur);
  }
  return { total: items.length, passages: [...byPassage.values()] };
}

/** 拼写判定：忽略大小写、多余空格、首尾标点，撇号统一 */
export function sameWord(input, expected) {
  const norm = (v) => normalizeWord(v).replace(/\s+/g, ' ');
  return norm(input) !== '' && norm(input) === norm(expected);
}
