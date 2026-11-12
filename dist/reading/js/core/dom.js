// 极简 DOM 工具：不引入框架，保持零依赖
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function h(tag, attrs = {}, ...children) {
  // 容错：第二参数若不是一个「属性字典」（字符串/数字/数组/DOM 节点），视为子节点
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node) {
    children = [attrs, ...children];
    attrs = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name);
  for (const part of rest) {
    if (part.startsWith('.')) el.classList.add(part.slice(1));
    else if (part.startsWith('#')) el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') {
      el.className = [el.className, v].filter(Boolean).join(' ');
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k === 'value') {
      el.value = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), ms);
}

/** 枚举答案展示：NOT_GIVEN -> NOT GIVEN，空值显示「未作答」 */
export function fmtAnswer(value) {
  const s = String(value ?? '').trim();
  if (!s) return '未作答';
  return s.replace(/_/g, ' ');
}

/** 在段落文本中高亮引文（支持用 … 连接的多段引用） */
export function highlightQuote(text, quote) {
  const frags = String(quote || '').split('…').map((s) => s.trim()).filter(Boolean);
  const escText = esc(text);
  let out = escText;
  for (const f of frags) {
    const seg = esc(f);
    const idx = out.toLowerCase().indexOf(seg.toLowerCase());
    if (idx >= 0) {
      out = `${out.slice(0, idx)}<mark class="quote">${out.slice(idx, idx + seg.length)}</mark>${out.slice(idx + seg.length)}`;
    }
  }
  return out;
}
