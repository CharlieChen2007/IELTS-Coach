import { h } from '../core/dom.js';

let active = null; // 当前打开对话框的结束函数（同时只允许一个）

const TONE_CLASS = {
  default: 'btn-primary',
  primary: 'btn-primary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

/**
 * 带任意按钮的站内对话框，返回被点按钮的 key。
 * Esc / 点遮罩 → cancelKey（默认 'cancel'，可为 null 表示只能选按钮）。
 * @param {{title?: string, message?: string, note?: string,
 *   actions?: Array<{key: string, text: string, tone?: 'default'|'primary'|'danger'|'ghost'}>,
 *   cancelKey?: string|null}} opts
 * @returns {Promise<string|null>}
 */
export function dialogChoice(opts = {}) {
  const {
    title = '请选择',
    message = '',
    note = '',
    actions = [],
    cancelKey = 'cancel',
    boxTone = '',
  } = opts;
  const list = Array.isArray(actions) ? actions.filter((a) => a && a.key) : [];
  if (!list.length) return Promise.resolve(null);

  if (active) active(null);

  return new Promise((resolve) => {
    let settled = false;
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      if (active === finish) active = null;
      if (prevFocus && typeof prevFocus.focus === 'function' && prevFocus.isConnected) prevFocus.focus({preventScroll:true});
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && cancelKey) {
        e.preventDefault();
        finish(cancelKey);
      }
    };

    const buttons = list.map((a) => {
      const btn = h(`button.btn.${TONE_CLASS[a.tone] || 'btn-primary'}`, { type: 'button' }, a.text);
      btn.dataset.key = a.key;
      btn.addEventListener('click', () => finish(a.key));
      return btn;
    });
    const box = h('div.dlg', {
      class: boxTone === 'danger' ? 'danger' : '',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    h('h2.dlg-title', title),
    message ? h('p.dlg-msg', message) : null,
    note ? h('p.dlg-note', note) : null,
    h('div.dlg-actions', buttons));
    const overlay = h('div.dlg-overlay', box);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && cancelKey) finish(cancelKey);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    active = finish;
    (buttons.find((b) => b.dataset.key !== cancelKey) || buttons[0]).focus();
  });
}

/**
 * 站内确认框，替代浏览器原生 window.confirm。
 * Esc / 点遮罩 / 点取消 → false；点确认 → true。
 * @param {{title?: string, message?: string, note?: string, okText?: string, cancelText?: string, tone?: 'default'|'danger'}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  const {
    title = '确认操作',
    message = '',
    note = '',
    okText = '确定',
    cancelText = '取消',
    tone = 'default',
  } = opts;

  return dialogChoice({
    title,
    message,
    note,
    actions: [
      { key: 'ok', text: okText, tone: 'primary' },
      { key: 'cancel', text: cancelText, tone: 'ghost' },
    ],
    cancelKey: 'cancel',
    boxTone: tone === 'danger' ? 'danger' : '',
  }).then((key) => key === 'ok');
}
