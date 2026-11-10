import { $, esc, h } from '../lib/util';
import { I } from './icons';
import { flushPending } from '../app';

let popEl: HTMLElement | null = null;
export const isPopOpen = () => !!popEl;
export function closePop() {
  if (!popEl) return;
  popEl.remove(); popEl = null;
  // Removing a focused input fires no focusout, so flush a render deferred while typing.
  setTimeout(flushPending);
}

/** Open a popover next to `anchor`. Only one is open at a time. */
export function popover(anchor: Element, html: string, width?: number): HTMLElement {
  closePop();
  const p = h(`<div class="pop" style="width:${width || 220}px;max-width:calc(100vw - 16px)">${html}</div>`);
  popEl = p;
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let x = Math.min(r.left, innerWidth - pw - 8), y = r.bottom + 6;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  if (anchor.closest('.rail') && innerWidth > 760) { x = r.right + 8; y = Math.max(8, Math.min(r.top, innerHeight - ph - 8)); }
  p.style.left = Math.max(8, x) + 'px'; p.style.top = y + 'px';
  p.addEventListener('mousedown', e => e.stopPropagation());
  return p;
}

/** [label, action, checked?] */
export type MenuItem = [string, () => unknown, boolean?];

/** A simple menu. Labels are escaped unless `rawHtml`. */
export function menu(anchor: Element, items: MenuItem[], rawHtml = false) {
  const tick = `<span class="kbd" style="color:rgb(var(--primary))">${I.check.replace('<svg', '<svg style="width:14px;height:14px"')}</span>`;
  const p = popover(anchor, items.map(([label, , on], i) => `<div class="mi" data-i="${i}">${rawHtml ? label : esc(label)}${on ? tick : ''}</div>`).join(''), 210);
  p.querySelectorAll<HTMLElement>('.mi').forEach(el => el.onclick = () => { const f = items[+el.dataset.i!]![1]; closePop(); f(); });
}

/** Popover with one text input and Save; calls `onOk` with the trimmed value. */
export function promptPop(anchor: Element, title: string, opts: { placeholder: string; value?: string; width?: number }, onOk: (v: string) => void) {
  const p = popover(anchor, `<h4>${esc(title)}</h4><input class="dlg-input" placeholder="${esc(opts.placeholder)}" value="${esc(opts.value || '')}"><div class="btns"><button class="btn pri" data-ok>Save</button></div>`, opts.width || 240);
  const inp = $<HTMLInputElement>('input', p); inp.focus();
  const ok = () => onOk(inp.value.trim());
  $('[data-ok]', p).onclick = ok;
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
}

export function initPopover() { document.addEventListener('mousedown', closePop); }
