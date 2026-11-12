// 进度存储：Step 2 用 localStorage 实现 ProgressStore 接口
// Step 3 换成后端实现时，只替换本文件
const NS = 'yl.v1';
const embedded = window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1';
const scope = new URLSearchParams(location.search).get('scope') || '';
const storageKey = key => embedded ? 'yl.scope.' + encodeURIComponent(scope) + '.' + key.slice(NS.length + 1) : key;
const KEY = {
  sessions: `${NS}.sessions`,
  mistakes: `${NS}.mistakes`,
  draft: (passageId) => `${NS}.draft.${passageId}`,
  vocab: `${NS}.vocab`,
  notes: `${NS}.notes`,
  readlib: `${NS}.readlib`,
  readpos: `${NS}.readpos`,
};
const MAX_SESSIONS = 60;
const MAX_VOCAB = 400;
const MAX_NOTES = 400;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false; // 隐私模式 / 配额满：不阻断练习
  }
}

/* ---------------- 会话 ---------------- */
export function listSessions() {
  return read(KEY.sessions, []);
}

export function getSession(id) {
  return listSessions().find((s) => s.id === id) || null;
}

export function saveSession(session) {
  const all = listSessions().filter(s=>s.id!==session.id);
  all.unshift(session);
  write(KEY.sessions, all.slice(0, MAX_SESSIONS));
  return session;
}

export function lastSessionOf(passageId) {
  return listSessions().find((s) => s.passageId === passageId) || null;
}

/* ---------------- 错题本 ---------------- */
export function listMistakes() {
  const map = read(KEY.mistakes, {});
  return Object.values(map).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

function writeMistakes(map) {
  write(KEY.mistakes, map);
}

/** 交卷后同步：答错入册，答对则把历史错题标记为已订正 */
export function syncMistakes(grade, passage) {
  const map = read(KEY.mistakes, {});
  const now = Date.now();
  for (const r of grade.results) {
    const exist = map[r.questionId];
    if (r.status === 'correct') {
      if (exist && !exist.resolved) {
        exist.resolved = true;
        exist.lastCorrectAt = now;
      }
      continue;
    }
    const item = exist || {
      questionId: r.questionId,
      passageId: passage.id,
      passageTitle: passage.title,
      number: r.number,
      type: r.type,
      count: 0,
      firstAt: now,
      resolved: false,
    };
    Object.assign(item, {
      stem: r.stem,
      options: r.options,
      explanation: r.explanation,
      yourAnswer: r.response || '',
      correctAnswer: r.answer.value,
      reasonCode: r.reasonCode,
      lastAt: now,
      count: (exist?.count || 0) + 1,
      resolved: false,
    });
    map[r.questionId] = item;
  }
  writeMistakes(map);
  return listMistakes();
}

export function removeMistake(questionId) {
  const map = read(KEY.mistakes, {});
  delete map[questionId];
  writeMistakes(map);
  return listMistakes();
}

export function clearMistakes() {
  writeMistakes({});
  return [];
}

/* ---------------- 单词本 ---------------- */
export function listVocab() {
  const map = read(KEY.vocab, {});
  return Object.values(map).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export function getVocab(word) {
  return read(KEY.vocab, {})[word] || null;
}

export function isCollected(word) {
  return !!getVocab(word);
}

function writeVocab(map) {
  write(KEY.vocab, map);
  return listVocab();
}

/** 收藏一个词（同词头覆盖：保留最早的收藏时间） */
export function addVocab(item) {
  if (!item || !item.word) return listVocab();
  const map = read(KEY.vocab, {});
  const exist = map[item.word];
  map[item.word] = exist ? { ...item, at: exist.at || item.at } : item;
  return writeVocab(map);
}

export function removeVocab(word) {
  const map = read(KEY.vocab, {});
  delete map[word];
  return writeVocab(map);
}

/** 切换收藏，返回 { collected, list } */
export function toggleVocab(item) {
  if (!item || !item.word) return { collected: false, list: listVocab() };
  if (isCollected(item.word)) return { collected: false, list: removeVocab(item.word) };
  addVocab(item);
  return { collected: true, list: listVocab() };
}

/* ---------------- 草稿 ---------------- */
export function getDraft(passageId) {
  return read(KEY.draft(passageId), null);
}

export function saveDraft(passageId, data) {
  write(KEY.draft(passageId), { ...data, updatedAt: Date.now() });
}

export function clearDraft(passageId) {
  try {
    localStorage.removeItem(storageKey(KEY.draft(passageId)));
  } catch { /* ignore */ }
}

/* ---------------- 精读标注 ---------------- */
/** 某篇的标注数组（按存储顺序；渲染前用 annotation.sortAnnotations 排序） */
export function listNotes(passageId) {
  const map = read(KEY.notes, {});
  if (!map || typeof map !== 'object') return [];
  const list = map[passageId];
  return Array.isArray(list) ? list : [];
}

/** 覆盖写入某篇的标注；传空数组即删除该篇记录 */
export function saveNotes(passageId, list) {
  const map = read(KEY.notes, {});
  const safe = (Array.isArray(map) ? {} : map) || {};
  if (!Array.isArray(list) || !list.length) delete safe[passageId];
  else safe[passageId] = list.slice(0, MAX_NOTES);
  write(KEY.notes, safe);
  return Array.isArray(list) ? list.slice(0, MAX_NOTES) : [];
}

/** 清空某篇的标注 */
export function clearNotes(passageId) {
  saveNotes(passageId, []);
}

/** 全站标注总数（导航角标用） */
export function notesCount() {
  const map = read(KEY.notes, {});
  if (!map || typeof map !== 'object') return 0;
  return Object.values(map).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

/** 全部标注（篇目 → 标注数组），精读库列表算统计用 */
export function notesMap() {
  const map = read(KEY.notes, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/* ---------------- 精读库 ---------------- */
/**
 * 精读库：只有在本篇精读页点过「保存到精读库」的篇目才在这里。
 * 记录是 { 篇目: { savedAt, updatedAt } }，标注本身仍在 yl.v1.notes。
 */
export function readLibMap() {
  const map = read(KEY.readlib, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/** 已保存的篇目（最近编辑在前） */
export function listReadLib() {
  return Object.entries(readLibMap())
    .map(([passageId, v]) => ({
      passageId,
      savedAt: Number(v?.savedAt) || 0,
      updatedAt: Number(v?.updatedAt) || Number(v?.savedAt) || 0,
    }))
    .sort((a, b) => (b.updatedAt || b.savedAt) - (a.updatedAt || a.savedAt));
}

export function getLibEntry(passageId) {
  const v = readLibMap()[passageId];
  if (!v) return null;
  return {
    passageId,
    savedAt: Number(v.savedAt) || 0,
    updatedAt: Number(v.updatedAt) || Number(v.savedAt) || 0,
  };
}

export function isInLib(passageId) {
  return !!readLibMap()[passageId];
}

/** 保存进精读库（已存在则保留最早的保存时间，只更新编辑时间） */
export function saveLibEntry(passageId, at = Date.now()) {
  if (!passageId) return null;
  const map = readLibMap();
  const exist = map[passageId];
  map[passageId] = {
    savedAt: Number(exist?.savedAt) || at,
    updatedAt: at,
  };
  write(KEY.readlib, map);
  return getLibEntry(passageId);
}

/** 已保存的篇目改动后刷新编辑时间（没保存过则不动） */
export function touchLibEntry(passageId, at = Date.now()) {
  const map = readLibMap();
  const exist = map[passageId];
  if (!exist) return null;
  map[passageId] = { savedAt: Number(exist.savedAt) || at, updatedAt: at };
  write(KEY.readlib, map);
  return getLibEntry(passageId);
}

/** 移出精读库（标注另行清理） */
export function removeLibEntry(passageId) {
  const map = readLibMap();
  delete map[passageId];
  write(KEY.readlib, map);
  return listReadLib();
}

export function readLibCount() {
  return Object.keys(readLibMap()).length;
}

/* ---------------- 精读阅读位置 ---------------- */
/**
 * 精读页的滚动位置：{ 篇目: { top, at } }，只用于「回到上次读到的地方」。
 * 上限 MAX_READPOS 篇，超出按最近使用淘汰。
 */
const MAX_READPOS = 60;

function readPosMap() {
  const map = read(KEY.readpos, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export function getReadPos(passageId) {
  const v = readPosMap()[passageId];
  const top = Number(v?.top);
  return Number.isFinite(top) && top > 0 ? Math.round(top) : 0;
}

export function setReadPos(passageId, top, at = Date.now()) {
  if (!passageId) return;
  const map = readPosMap();
  const value = Math.round(Number(top) || 0);
  if (value <= 0) delete map[passageId];
  else map[passageId] = { top: value, at };
  const keys = Object.keys(map);
  if (keys.length > MAX_READPOS) {
    keys
      .sort((a, b) => (Number(map[a]?.at) || 0) - (Number(map[b]?.at) || 0))
      .slice(0, keys.length - MAX_READPOS)
      .forEach((k) => delete map[k]);
  }
  write(KEY.readpos, map);
}

/* ---------------- 汇总统计 ---------------- */
export function passageProgress(passageId) {
  const sessions = listSessions().filter((s) => s.passageId === passageId);
  if (!sessions.length) return null;
  const last = sessions[0];
  const best = Math.max(...sessions.map((s) => s.correct));
  return { attempts: sessions.length, last, best };
}

export function overallStats() {
  const sessions = listSessions();
  if (!sessions.length) return { attempts: 0, accuracy: 0, band: 0, total: 0, correct: 0 };
  const total = sessions.reduce((n, s) => n + s.total, 0);
  const correct = sessions.reduce((n, s) => n + s.correct, 0);
  const recent = sessions.slice(0, 3);
  const recentAcc = recent.reduce((n, s) => n + s.correct, 0) / Math.max(1, recent.reduce((n, s) => n + s.total, 0));
  return {
    attempts: sessions.length,
    accuracy: total ? correct / total : 0,
    recentAccuracy: recentAcc,
    latestAccuracy: sessions[0].total ? sessions[0].correct / sessions[0].total : 0,
    total,
    correct,
    band: sessions[0].band,
  };
}
