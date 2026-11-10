import { $ } from '../lib/util';

let undoFn: (() => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Show a short message. With `action`, a button runs it (label "Undo" by default).
 * `sticky` keeps the toast until the button is used.
 */
export function toast(msg: string, action?: () => void, opts: { label?: string; sticky?: boolean } = {}) {
  $('#toast-msg').textContent = msg; undoFn = action || null;
  const btn = $('#toast-undo');
  btn.style.display = action ? '' : 'none';
  btn.textContent = opts.label || 'Undo';
  $('#toast').classList.add('on'); clearTimeout(toastTimer);
  if (!opts.sticky) toastTimer = setTimeout(() => $('#toast').classList.remove('on'), 4000);
}

export function initToast() {
  $('#toast-undo').onclick = () => { if (undoFn) undoFn(); undoFn = null; $('#toast').classList.remove('on'); };
}
