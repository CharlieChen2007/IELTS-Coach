// 精读标注的纯逻辑：新增 / 删除 / 改批注 / 分段渲染 / 统计
// 不碰 DOM，位置全部用「段落纯文本偏移」，方便单测与后续同步到后端。

export const KINDS = ['under', 'high', 'note'];
export const COLORS = ['yellow', 'green', 'blue'];
export const MAX_ANNOTATIONS = 400;
export const NOTE_MAX = 200;

const KIND_OF = new Set(KINDS);
const COLOR_OF = new Set(COLORS);

/** 简单唯一的 id：时间戳 + 随机后缀 */
export function makeId(at = Date.now(), rnd = Math.random) {
  return `a${Number(at).toString(36)}${Math.floor(rnd() * 1296).toString(36).padStart(2, '0')}`;
}

/** 偏移裁剪到文本长度内，并去掉首尾空白；无效区间返回 null */
export function normalizeRange(text, start, end) {
  const s0 = String(text ?? '');
  const len = s0.length;
  let s = Number(start);
  let e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  s = Math.max(0, Math.min(Math.round(s), len));
  e = Math.max(0, Math.min(Math.round(e), len));
  if (e <= s) return null;
  const raw = s0.slice(s, e);
  const lead = raw.length - raw.replace(/^\s+/, '').length;
  const trail = raw.length - raw.replace(/\s+$/, '').length;
  const ns = s + lead;
  const ne = e - trail;
  if (ne <= ns) return null;
  return { start: ns, end: ne, quote: s0.slice(ns, ne) };
}

export function isOverlap(a, b) {
  return a.para === b.para && a.start < b.end && b.start < a.end;
}

/**
 * 新增一条标注。
 * @param {Array} list 现有标注（不会被修改）
 * @param {{para:string,kind:'under'|'high'|'note',start:number,end:number,text:string,
 *          color?:string,note?:string,id?:string,at?:number}} input text 是所属段落的纯文本
 * @returns {{ok:true,list:Array,item:object}|{ok:false,reason:string}}
 */
export function addAnnotation(list, input = {}) {
  const arr = Array.isArray(list) ? list : [];
  const kind = String(input.kind || '');
  if (!KIND_OF.has(kind)) return { ok: false, reason: '未知的标注类型' };
  if (arr.length >= MAX_ANNOTATIONS) return { ok: false, reason: `本篇标注已达上限（${MAX_ANNOTATIONS} 条）` };

  const para = String(input.para || '');
  if (!para) return { ok: false, reason: '缺少段落' };
  const range = normalizeRange(input.text, input.start, input.end);
  if (!range) return { ok: false, reason: '选中的文字太短' };

  let color = null;
  if (kind === 'high') {
    color = COLOR_OF.has(input.color) ? input.color : 'yellow';
  }

  let note = null;
  if (kind === 'note') {
    note = String(input.note ?? '').trim();
    if (!note) return { ok: false, reason: '批注不能为空' };
    if (note.length > NOTE_MAX) return { ok: false, reason: `批注最多 ${NOTE_MAX} 字` };
  }

  const item = {
    id: String(input.id || makeId(input.at)),
    para,
    kind,
    start: range.start,
    end: range.end,
    quote: range.quote,
    at: Number(input.at) || Date.now(),
  };
  if (color) item.color = color;
  if (note) item.note = note;

  if (arr.some((a) => a.para === item.para && a.kind === item.kind
    && a.start === item.start && a.end === item.end)) {
    return { ok: false, reason: '这段文字已经标过了' };
  }
  // 划线 / 荧光笔互斥，避免同一段文字既描边又铺底，看不清也删不干净
  if (kind === 'under' || kind === 'high') {
    const clash = arr.find((a) => (a.kind === 'under' || a.kind === 'high') && isOverlap(a, item));
    if (clash) return { ok: false, reason: '这段文字已有划线或荧光笔，先删掉再标' };
  }

  return { ok: true, list: [...arr, item], item };
}

/** 删除一条标注（按 id；找不到时原样返回） */
export function removeAnnotation(list, id) {
  const arr = Array.isArray(list) ? list : [];
  const next = arr.filter((a) => a.id !== id);
  return next.length === arr.length ? arr.slice() : next;
}

/** 改批注文字（只有 kind=note 能改） */
export function updateNote(list, id, note) {
  const arr = Array.isArray(list) ? list : [];
  const text = String(note ?? '').trim();
  if (!text) return { ok: false, reason: '批注不能为空' };
  if (text.length > NOTE_MAX) return { ok: false, reason: `批注最多 ${NOTE_MAX} 字` };
  const hit = arr.find((a) => a.id === id);
  if (!hit) return { ok: false, reason: '找不到这条标注' };
  if (hit.kind !== 'note') return { ok: false, reason: '只有批注能改文字' };
  return { ok: true, list: arr.map((a) => (a.id === id ? { ...a, note: text, at: Date.now() } : a)) };
}

/** 按段落 + 起点排序（渲染与列表都用它） */
export function sortAnnotations(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => (
    String(a.para).localeCompare(String(b.para), 'en') || a.start - b.start
  ));
}

/** 统计：划线 / 荧光笔 / 批注 各自条数 */
export function stats(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = { under: 0, high: 0, note: 0, total: arr.length };
  for (const a of arr) {
    if (out[a.kind] !== undefined) out[a.kind] += 1;
  }
  return out;
}

/** 某一段的标注 */
export function annotationsOf(list, para) {
  return sortAnnotations(list).filter((a) => a.para === para);
}

const signature = (s) => `${s.under ? 'u' : ''}|${s.color || ''}|${s.noteId || ''}`;

/**
 * 把段落文本切成渲染片段（相邻同样式的片段会合并）。
 * 划线 / 荧光笔互斥，批注可以叠在上面，因此片段最多同时带「一种底色或下划线 + 一条批注」。
 * @returns {Array<{text:string,under:boolean,color:string|null,noteId:string|null,ids:string[]}>}
 */
export function buildSegments(text, list) {
  const src = String(text ?? '');
  const len = src.length;
  const anns = (Array.isArray(list) ? list : []).filter((a) => (
    a && Number.isFinite(a.start) && Number.isFinite(a.end)
    && a.start >= 0 && a.end > a.start && a.start < len
  ));
  if (!anns.length) {
    return len ? [{ text: src, under: false, color: null, noteId: null, ids: [] }] : [];
  }

  const marks = new Set([0, len]);
  for (const a of anns) {
    marks.add(Math.max(0, Math.min(a.start, len)));
    marks.add(Math.max(0, Math.min(a.end, len)));
  }
  const bounds = [...marks].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (to <= from) continue;
    const covering = anns.filter((a) => a.start <= from && a.end >= to);
    if (!covering.length) {
      out.push({ text: src.slice(from, to), under: false, color: null, noteId: null, ids: [] });
      continue;
    }
    const under = covering.some((a) => a.kind === 'under');
    const high = covering.find((a) => a.kind === 'high');
    const note = covering.find((a) => a.kind === 'note');
    out.push({
      text: src.slice(from, to),
      under,
      color: high ? (COLOR_OF.has(high.color) ? high.color : 'yellow') : null,
      noteId: note ? note.id : null,
      ids: covering.map((a) => a.id),
    });
  }
  // 合并相邻同样式片段，减少 DOM 节点
  const merged = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && signature(last) === signature(seg)) {
      last.text += seg.text;
      last.ids = [...new Set([...last.ids, ...seg.ids])];
    } else {
      merged.push({ ...seg, ids: [...seg.ids] });
    }
  }
  return merged;
}
