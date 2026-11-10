/**
 * Drag and drop. Mouse and trackpad use HTML5 drag and drop. Touch uses
 * pointer events: press and hold to pick a task up, drag it onto any drop
 * target, let go to drop. Holding without moving opens `onHold` instead (the
 * task menu). Blocks on the calendar's hour grid have their own pointer
 * handling (views/calendar.ts).
 */
import type { Task } from '../types';
import { TODAY, tomorrow } from '../lib/dates';
import { setLocalWhen, when } from '../lib/tz';
import { DEFAULT_DUR, clampMin, fromMin, snap } from '../calendar';
import { S, ord, touch } from '../store';
import { closePop } from './popover';
import { toast } from './toast';
import { del, guard, moveTo } from '../actions';
import { render } from '../app';

let drag: { id: string } | null = null;
let marked: HTMLElement | null = null;
let lastY = 0;

export function makeDraggable(el: HTMLElement, id: string, onHold?: () => void) {
  el.draggable = true;
  el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && e.isPrimary) touchStart(el, id, e, onHold); });
  el.ondragstart = e => {
    // Android can start a native drag on long-press: the touch drag handles it.
    if (td) { e.preventDefault(); return; }
    drag = { id };
    e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', id);
    requestAnimationFrame(() => el.classList.add('dragging')); closePop();
  };
  el.ondragend = () => { el.classList.remove('dragging'); clearMark(); drag = null; };
}

function clearMark() { if (marked) { marked.classList.remove('drop-over', 'drop-before', 'drop-after'); marked = null; } }

/** Apply a zone's date (`data-due`), priority (`data-pri`) or kanban column (`data-col`) to a task. */
function zoneProps(t: Task, zone: HTMLElement | null) {
  if (!zone) return;
  if (zone.dataset.due) t.due = zone.dataset.due === 'none' ? null : zone.dataset.due;
  if (zone.dataset.pri !== undefined) t.priority = +zone.dataset.pri;
  if (zone.dataset.col) t.col = zone.dataset.col;
  if (!t.due) t.time = null;
}

function handleDrop(z: HTMLElement, after: boolean, id: string) {
  const t = S.tasks[id]; if (!t || !guard(t)) return;
  const kind = z.dataset.drop, v = z.dataset.v!;
  if (kind === 'row') {
    const target = S.tasks[z.dataset.id!]; if (!target) return;
    const zone = z.closest<HTMLElement>('[data-zone]');
    zoneProps(t, zone);
    const ids = [...(zone || z.parentElement!).querySelectorAll<HTMLElement>('.row[data-id]')].map(r => r.dataset.id!).filter(id => id !== t.id);
    const idx = ids.indexOf(target.id) + (after ? 1 : 0);
    const prev = S.tasks[ids[idx - 1]!], next = S.tasks[ids[idx]!];
    const po = prev ? ord(prev) : null, no = next ? ord(next) : null;
    t.order = po == null && no == null ? Date.now() : po == null ? no! - 1000 : no == null ? po + 1000 : (po + no) / 2;
    touch(t); render(); return;
  }
  if (kind === 'zone') { zoneProps(t, z); touch(t); render(); return; }
  if (kind === 'list') return moveTo(t, v);
  if (kind === 'smart') { touch(Object.assign(t, { due: v === 'today' ? TODAY() : tomorrow() })); render(); return toast(`Moved to ${v === 'today' ? 'Today' : 'Tomorrow'}`); }
  if (kind === 'tag') { t.tags = [...new Set([...(t.tags || []), v])]; touch(t); render(); return toast(`Tagged #${v}`); }
  if (kind === 'trash') return del(t.id);
  if (kind === 'day') {
    // The all-day row of the hour grid also drops the time; a month cell keeps it.
    if (z.hasAttribute('data-allday')) Object.assign(t, { due: v, time: null, tz: null });
    else setLocalWhen(t, v, when(t).time);
    touch(t); render();
  }
  if (kind === 'slot') {
    // A day column of the hour grid: the drop height sets the time.
    const dur = t.dur || DEFAULT_DUR;
    const min = clampMin(snap((lastY - z.getBoundingClientRect().top) * 60 / parseFloat(getComputedStyle(z).getPropertyValue('--hour') || '48')), dur);
    setLocalWhen(t, v, fromMin(min));
    touch(t); render();
  }
}

/** Mark the drop target under the pointer. Returns it, or null. */
function markAt(target: Element | null, y: number): HTMLElement | null {
  lastY = y;
  const z = target?.closest<HTMLElement>('[data-drop]') || null;
  if (z !== marked) clearMark();
  if (!z || !drag || (z.dataset.drop === 'row' && z.dataset.id === drag.id)) return null;
  marked = z;
  if (z.dataset.drop === 'row') {
    const r = z.getBoundingClientRect(), after = y > r.top + r.height / 2;
    z.classList.toggle('drop-after', after); z.classList.toggle('drop-before', !after);
  } else z.classList.add('drop-over');
  return z;
}

// ---------- touch ----------

interface TouchDrag { el: HTMLElement; id: string; x0: number; y0: number; pointerId: number; timer: ReturnType<typeof setTimeout>; active: boolean; moved: boolean; ghost?: HTMLElement; onHold?: () => void }
let td: TouchDrag | null = null;

function touchStart(el: HTMLElement, id: string, e: PointerEvent, onHold?: () => void) {
  touchEnd();
  const d: TouchDrag = { el, id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, active: false, moved: false, onHold, timer: setTimeout(() => activate(d), 400) };
  td = d;
  addEventListener('pointermove', touchMove, { passive: false });
  addEventListener('pointerup', touchUp);
  addEventListener('pointercancel', touchCancel);
}

function activate(d: TouchDrag) {
  if (td !== d) return;
  d.active = true; drag = { id: d.id };
  navigator.vibrate?.(10); closePop();
  const r = d.el.getBoundingClientRect();
  const g = d.el.cloneNode(true) as HTMLElement;
  g.className += ' touch-ghost';
  g.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;pointer-events:none;z-index:1000`;
  document.body.appendChild(g);
  d.ghost = g;
  d.el.classList.add('dragging');
}

function touchMove(e: PointerEvent) {
  const d = td; if (!d || e.pointerId !== d.pointerId) return;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (!d.active) { if (Math.hypot(dx, dy) > 8) touchEnd(); return; } // a scroll, not a hold
  e.preventDefault();
  d.moved = d.moved || Math.hypot(dx, dy) > 6;
  d.ghost!.style.transform = `translate(${dx}px,${dy}px)`;
  markAt(document.elementFromPoint(e.clientX, e.clientY), e.clientY);
  // Scroll the list under the finger near the screen edges.
  const sc = (document.elementFromPoint(e.clientX, e.clientY)?.closest('.content, .tg-scroll, .kanban') as HTMLElement | null);
  if (sc) { if (e.clientY < 90) sc.scrollTop -= 10; else if (e.clientY > innerHeight - 90) sc.scrollTop += 10; }
}

function touchUp(e: PointerEvent) {
  const d = td; if (!d || e.pointerId !== d.pointerId) return;
  const z = d.active && d.moved ? marked : null, after = !!z?.classList.contains('drop-after');
  const hold = d.active && !d.moved;
  clearMark(); touchEnd();
  if (z) { suppressClick(); handleDrop(z, after, d.id); }
  else if (hold) { suppressClick(); d.onHold?.(); }
}

function touchCancel() { clearMark(); touchEnd(); }

function touchEnd() {
  const d = td; td = null;
  if (!d) return;
  clearTimeout(d.timer);
  d.ghost?.remove();
  d.el.classList.remove('dragging');
  if (d.active) drag = null;
  removeEventListener('pointermove', touchMove);
  removeEventListener('pointerup', touchUp);
  removeEventListener('pointercancel', touchCancel);
}

/** The click that follows a touch drop must not open the task. */
function suppressClick() {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), 400);
}

export function initDnd() {
  // While a touch drag is active the page must not scroll, and a hold must not open the system menu.
  document.addEventListener('touchmove', e => { if (td?.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (td) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('dragover', e => {
    if (!drag) return;
    if (markAt(e.target as Element, e.clientY)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; }
  });
  document.addEventListener('drop', e => {
    if (!drag) return;
    const z = (e.target as Element).closest<HTMLElement>('[data-drop]'); if (!z) return;
    e.preventDefault();
    const after = z.classList.contains('drop-after');
    clearMark(); handleDrop(z, after, drag.id);
  });
}
