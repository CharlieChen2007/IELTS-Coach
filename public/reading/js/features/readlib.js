// 精读库：把「保存记录 + 本篇标注」整理成列表行（纯函数，视图与单测共用）
// 保存记录来自 store 的 yl.v1.readlib（{ 篇目: { savedAt, updatedAt } }），
// 标注来自 yl.v1.notes，两边通过篇目 id 关联。

const DAY = 86400000;

const pad2 = (n) => String(n).padStart(2, '0');

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * 时间展示：今天 14:32 / 昨天 14:32 / 11-05 14:32 / 2025-11-05
 * @param {number} ts 毫秒时间戳
 * @param {number} [now] 参照时间（单测注入）
 */
export function formatWhen(ts, now = Date.now()) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  const d = new Date(t);
  const n = new Date(Number(now) || Date.now());
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const diff = Math.round((dayStart(n) - dayStart(d)) / DAY);
  if (diff <= 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (d.getFullYear() === n.getFullYear()) return `${md} ${hm}`;
  return `${d.getFullYear()}-${md}`;
}

/** 一篇标注的分类统计（与 annotation.stats 口径一致，但不依赖标注实现） */
export function noteCounts(anns = []) {
  const out = { under: 0, high: 0, note: 0, total: 0 };
  for (const a of Array.isArray(anns) ? anns : []) {
    if (!a) continue;
    if (a.kind === 'under') out.under++;
    else if (a.kind === 'high') out.high++;
    else if (a.kind === 'note') out.note++;
  }
  out.total = out.under + out.high + out.note;
  return out;
}

/** 最近编辑时间：优先 updatedAt，其次 savedAt，最后标注里最晚的 at */
export function entryTime(entry = {}) {
  const updated = Number(entry.updatedAt) || 0;
  if (updated) return updated;
  const saved = Number(entry.savedAt) || 0;
  if (saved) return saved;
  return latestAnnotAt(entry.anns);
}

function latestAnnotAt(anns) {
  let max = 0;
  for (const a of Array.isArray(anns) ? anns : []) {
    const t = Number(a?.at) || 0;
    if (t > max) max = t;
  }
  return max;
}

/**
 * 精读库列表行
 * @param {{passageId: string, savedAt?: number, updatedAt?: number}} entry
 * @param {{anns?: Array, passage?: object, now?: number}} opts
 */
export function libRow(entry = {}, { anns = [], passage = null, now = Date.now() } = {}) {
  const counts = noteCounts(anns);
  const at = entryTime({ ...entry, anns });
  return {
    passageId: entry.passageId || '',
    title: passage?.title || entry.passageId || '未命名篇目',
    titleZh: passage?.titleZh || '',
    label: passage?.label || '',
    source: passage?.source || '',
    under: counts.under,
    high: counts.high,
    note: counts.note,
    total: counts.total,
    savedAt: Number(entry.savedAt) || 0,
    updatedAt: at,
    when: at ? formatWhen(at, now) : '',
  };
}

/** 按最近编辑排序（不改入参） */
export function sortLib(entries = []) {
  return (Array.isArray(entries) ? entries.slice() : []).sort((a, b) => {
    const ta = entryTime(a) || 0;
    const tb = entryTime(b) || 0;
    if (tb !== ta) return tb - ta;
    return (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0);
  });
}

/** 汇总：已保存篇数 + 各类标注总数 */
export function libSummary(rows = []) {
  const out = { passages: 0, under: 0, high: 0, note: 0, total: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    out.passages++;
    out.under += Number(r?.under) || 0;
    out.high += Number(r?.high) || 0;
    out.note += Number(r?.note) || 0;
  }
  out.total = out.under + out.high + out.note;
  return out;
}

/**
 * 还没保存进精读库、但本机留了标注的篇目（精读库页用来提示「草稿」）。
 * @param {Array} passages 全部篇目
 * @param {Object} notesByPassage 篇目 → 标注数组
 * @param {Object} lib 篇目 → 保存记录
 */
export function draftRows(passages = [], notesByPassage = {}, lib = {}, now = Date.now()) {
  const rows = [];
  for (const p of Array.isArray(passages) ? passages : []) {
    if (!p || !p.id || lib?.[p.id]) continue;
    const anns = notesByPassage?.[p.id];
    if (!Array.isArray(anns) || !anns.length) continue;
    const counts = noteCounts(anns);
    const at = latestAnnotAt(anns);
    rows.push({
      passageId: p.id,
      title: p.title || p.id,
      titleZh: p.titleZh || '',
      label: p.label || '',
      under: counts.under,
      high: counts.high,
      note: counts.note,
      total: counts.total,
      updatedAt: at,
      when: at ? formatWhen(at, now) : '',
    });
  }
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
