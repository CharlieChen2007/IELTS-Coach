// 文本选择与偏移换算：练习页点词、精读标注共用
// 只依赖 DOM 的 Range/Walker，不含业务逻辑，方便两处复用。

/** 点击位置 → 文本光标 Range（Chrome/Firefox 两套 API） */
export function caretRangeAt(x, y) {
  if (typeof document.caretRangeFromPoint === 'function') return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

/** 节点内偏移 → 容器纯文本的绝对偏移（容器里插过 <span>/<mark> 也照样对得上） */
export function offsetInRoot(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return acc + offset;
    acc += walker.currentNode.textContent.length;
  }
  return offset;
}

/** 容器纯文本的 [start, end) → DOM Range（用于取单词/选区的位置） */
export function rangeByOffset(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let acc = 0;
  let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent.length;
    if (!started && start <= acc + len) {
      range.setStart(node, Math.max(0, Math.min(len, start - acc)));
      started = true;
    }
    if (started && end <= acc + len) {
      range.setEnd(node, Math.max(0, Math.min(len, end - acc)));
      break;
    }
    acc += len;
  }
  return range;
}

/** 文本节点取其父元素，元素原样返回 */
export function nodeElement(node) {
  if (!node) return null;
  return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
}

/**
 * 当前选区在某个容器里的偏移。
 * @param {Element} root 容器（如某个段落的文本元素）
 * @returns {{start:number,end:number,range:Range}|null} 选区不完整或不在容器内时返回 null
 */
export function selectionInRoot(root) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = offsetInRoot(root, range.startContainer, range.startOffset);
  const end = offsetInRoot(root, range.endContainer, range.endOffset);
  if (end <= start) return null;
  return { start, end, range };
}

/** 收起选区（不触发滚动） */
export function clearSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) sel.removeAllRanges();
}
