/**
 * Calendar: month grid, plus week and day views with hours.
 *
 * On the hour grid a timed task is a block as long as its `dur`. Drag a block
 * to move it (snaps to 15 min, can change day or drop on the all-day row),
 * drag its bottom edge to resize, drag on empty space to create a time block,
 * or double-click a slot for a one-hour task. Untimed tasks sit in the
 * all-day row; drag them onto an hour to give them a time. On touch, press
 * and hold a block (or an empty slot) to start.
 */
import type { Task } from '../types';
import { $, esc } from '../lib/util';
import { DOW, MON, TODAY, addDays, fmtTime, todayD, ymd } from '../lib/dates';
import { setLocalWhen } from '../lib/tz';
import { DEFAULT_DUR, SNAP, clampMin, extInRange, fromMin, itemsInRange, layoutDay, snap, toMin, weekOrder, weekStartOf, type CalItem, type ExtPlaced } from '../calendar';
import type { ExtEvent } from '../server/adapter';
import { googleEvents } from '../google';
import { COLORS, S, canWrite, listColor, live, newTask, prefs, savePrefs, touch, ui } from '../store';
import { I } from '../ui/icons';
import { makeDraggable } from '../ui/dnd';
import { select } from '../actions';
import { popover } from '../ui/popover';

/** Pixels per hour on the hour grid. */
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;

const color = (t: Task) => t.priority === 5 ? 'var(--p-high)' : (S.lists[t.listId]?.color || COLORS[7]) === COLORS[7] ? 'var(--primary)' : listColor(t.listId);
const anchor = () => ui.calDate || todayD();
const yearSuffix = (d: Date) => (d.getFullYear() === todayD().getFullYear() ? '' : `, ${d.getFullYear()}`);

export function renderCalendar() {
  const view = prefs.calView;
  const a = anchor();
  let title: string, prevLab: string, nextLab: string;
  if (view === 'month') { title = `${MON[a.getMonth()]} ${a.getFullYear()}`; prevLab = 'Previous month'; nextLab = 'Next month'; }
  else if (view === 'week') {
    const s = weekStartOf(a, prefs.weekStart), e = addDays(s, 6);
    title = (s.getMonth() === e.getMonth() ? `${MON[s.getMonth()]} ${s.getDate()}–${e.getDate()}` : `${MON[s.getMonth()]} ${s.getDate()} – ${MON[e.getMonth()]} ${e.getDate()}`) + yearSuffix(e);
    prevLab = 'Previous week'; nextLab = 'Next week';
  } else { title = `${DOW[a.getDay()]}, ${MON[a.getMonth()]} ${a.getDate()}${yearSuffix(a)}`; prevLab = 'Previous day'; nextLab = 'Next day'; }

  extIdx.clear();
  const main = $('#main');
  const keepScroll = main.querySelector<HTMLElement>('.tg-scroll')?.scrollTop;
  main.innerHTML = `
    <div class="topbar">
      <h1>${title}</h1>
      <button class="btn sec" style="flex:none;height:30px" id="c-today">Today</button>
      <button class="icon-btn" id="c-prev" aria-label="${prevLab}">${I.left}</button>
      <button class="icon-btn" id="c-next" aria-label="${nextLab}">${I.right}</button>
      <div class="seg cal-seg" role="tablist" aria-label="Calendar view">${(['month', 'week', 'day'] as const).map(v =>
        `<button role="tab" data-view="${v}" class="${view === v ? 'on' : ''}" aria-selected="${view === v}" title="${v[0]!.toUpperCase() + v.slice(1)} (${v[0]})">${v[0]!.toUpperCase()}<span>${v.slice(1)}</span></button>`).join('')}</div>
    </div>
    <div class="content cal">${view === 'month' ? monthHtml(a) : gridHtml(view === 'week' ? weekDays(a) : [new Date(a)])}</div>`;

  $('#c-prev').onclick = () => step(-1);
  $('#c-next').onclick = () => step(1);
  $('#c-today').onclick = () => { ui.calDate = null; renderCalendar(); scrollToNow(); };
  main.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view as typeof view));
  if (view === 'month') bindMonth(main); else bindGrid(main, keepScroll);
}

export function setView(v: 'month' | 'week' | 'day') {
  if (prefs.calView === v) return;
  prefs.calView = v; savePrefs(); renderCalendar();
}

function step(dir: number) {
  const a = anchor();
  ui.calDate = prefs.calView === 'month' ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (prefs.calView === 'week' ? 7 : 1));
  renderCalendar();
}

const weekDays = (a: Date) => { const s = weekStartOf(a, prefs.weekStart); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };

function byDay(items: CalItem[]) {
  const m: Record<string, CalItem[]> = {};
  for (const it of items) (m[it.due] = m[it.due] || []).push(it);
  return m;
}

const evHtml = ({ t, time, ghost }: CalItem) =>
  `<div class="ev ${t.done ? 'done' : ''} ${ghost ? 'ghost' : ''}" data-id="${t.id}" ${ghost ? 'title="Upcoming repeat"' : ''} style="--c:${color(t)}">${time ? fmtTime(time).replace(' ', '') + ' ' : ''}${esc(t.title || 'Untitled')}</div>`;

// ---------- Google events (read-only) ----------

function extByDay(list: ExtPlaced[]) {
  const m: Record<string, ExtPlaced[]> = {};
  for (const x of list) (m[x.day] = m[x.day] || []).push(x);
  return m;
}
const extIdx = new Map<string, ExtEvent>();
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#7986cb');
const extRef = (ev: ExtEvent) => { const k = ev.cal + '|' + ev.id; extIdx.set(k, ev); return esc(k); };
const extChip = (x: ExtPlaced) =>
  `<div class="ev gx" data-gx="${extRef(x.ev)}" style="--gx:${safeColor(x.ev.color)}" title="${esc(x.ev.calName)}">${!x.allDay ? fmtTime(fromMin(x.start)).replace(' ', '') + ' ' : ''}${esc(x.ev.title)}</div>`;
function extBlock(ev: ExtEvent, p: { col: number; cols: number }, start: number, end: number) {
  return `<div class="blk gx ${end - start < 45 ? 'short' : ''}" data-gx="${extRef(ev)}" style="--gx:${safeColor(ev.color)};top:${start * PX_PER_MIN}px;height:${(end - start) * PX_PER_MIN - 2}px;left:calc(${p.col} * 100% / ${p.cols});width:calc(100% / ${p.cols} - 3px)">
    <div class="bt">${esc(ev.title)}</div><div class="bs">${fmtTime(fromMin(start))} – ${fmtTime(fromMin(end % 1440))}</div></div>`;
}

/** A Google event's details. Changes happen in Google. */
function extDetails(anchor: Element, ev: ExtEvent) {
  const fmt = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const when = ev.date ? (ev.endDate && ev.endDate > ev.date && ymd(addDays(new Date(ev.endDate + 'T00:00'), -1)) !== ev.date ? `${ev.date} – ${ymd(addDays(new Date(ev.endDate + 'T00:00'), -1))}` : ev.date) + ', all day'
    : `${fmt(ev.start!)} – ${new Date(ev.end!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  popover(anchor, `<h4>${esc(ev.title)}</h4>
    <div class="gx-info"><span class="dot" style="background:${safeColor(ev.color)}"></span>${esc(ev.calName)}</div>
    <div class="gx-info">${esc(when)}</div>
    ${ev.location ? `<div class="gx-info">${esc(ev.location)}</div>` : ''}
    ${ev.link?.startsWith('https://') ? `<div class="btns"><a class="btn sec" href="${esc(ev.link)}" target="_blank" rel="noopener">Open in Google Calendar</a></div>` : ''}`, 280);
}

function bindExt(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-gx]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); const ev = extIdx.get(el.dataset.gx!); if (ev) extDetails(el, ev); };
  });
}

// ---------- month ----------

function monthHtml(a: Date) {
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = weekStartOf(first, prefs.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const map = byDay(itemsInRange(live(), ymd(days[0]!), ymd(days[41]!)));
  const ext = extByDay(extInRange(googleEvents(), ymd(days[0]!), ymd(days[41]!)));
  const cell = (d: Date) => {
    const k = ymd(d), items = (map[k] || []).sort((x, y) => +x.ghost - +y.ghost || (x.time || '99').localeCompare(y.time || '99'));
    // Tasks and Google events share the slots, in time order (all-day first).
    const chips = [
      ...items.map(it => ({ at: it.time ? toMin(it.time) : -1, html: evHtml(it) })),
      ...(ext[k] || []).map(x => ({ at: x.allDay ? -1 : x.start, html: extChip(x) })),
    ].sort((a, b) => a.at - b.at);
    const max = 3;
    return `<div class="cell ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${k === TODAY() ? 'today' : ''}" data-day="${k}" data-drop="day" data-v="${k}"><button class="d" data-goday="${k}" aria-label="Open ${k} in day view">${d.getDate()}</button>${chips.slice(0, max).map(c => c.html).join('')}${chips.length > max ? `<div class="more" data-goday="${k}">+${chips.length - max} more</div>` : ''}</div>`;
  };
  return `<div class="cal-dow">${weekOrder(prefs.weekStart).map(i => `<div>${DOW[i]}</div>`).join('')}</div>
    <div class="cal-grid">${days.map(cell).join('')}</div>`;
}

function bindMonth(main: HTMLElement) {
  bindEvs(main); bindExt(main);
  main.querySelectorAll<HTMLElement>('[data-goday]').forEach(b => b.onclick = e => {
    e.stopPropagation(); ui.calDate = new Date(b.dataset.goday + 'T00:00'); prefs.calView = 'day'; savePrefs(); renderCalendar(); scrollToNow();
  });
  main.querySelectorAll<HTMLElement>('.cell').forEach(c => c.ondblclick = () => { const t = newTask({ due: c.dataset.day! }); touch(t); select(t.id); });
}

/** Month events and all-day chips: click opens, HTML5 drag moves between days. */
function bindEvs(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.ev[data-id]').forEach(e => {
    e.onclick = ev => { ev.stopPropagation(); select(e.dataset.id!); };
    const t = S.tasks[e.dataset.id!];
    if (!e.classList.contains('ghost') && t && canWrite(t.listId)) makeDraggable(e, t.id);
  });
}

// ---------- week and day: the hour grid ----------

function gridHtml(days: Date[]) {
  const keys = days.map(ymd), today = TODAY();
  const map = byDay(itemsInRange(live(), keys[0]!, keys[keys.length - 1]!));
  const ext = extByDay(extInRange(googleEvents(), keys[0]!, keys[keys.length - 1]!));
  const allDay = (k: string) => (map[k] || []).filter(i => !i.time).sort((x, y) => +x.ghost - +y.ghost).map(evHtml).join('') + (ext[k] || []).filter(x => x.allDay).map(extChip).join('');
  const col = (k: string) => {
    const timed = (map[k] || []).filter(i => i.time);
    const blocks = timed.map((it, i) => ({ key: String(i), it, start: toMin(it.time!), end: Math.min(1440, toMin(it.time!) + Math.max(SNAP, it.t.dur || DEFAULT_DUR)) }));
    const gx = (ext[k] || []).filter(x => !x.allDay).map((x, i) => ({ key: 'g' + i, x, start: x.start, end: Math.max(x.end, x.start + SNAP) }));
    const placed = new Map(layoutDay([...blocks, ...gx]).map(p => [p.key, p]));
    const nowLine = k === today ? `<div class="now" style="top:${minsNow() * PX_PER_MIN}px"></div>` : '';
    return `<div class="tg-col ${k === today ? 'today' : ''}" data-drop="slot" data-v="${k}">${blocks.map(b => {
      const p = placed.get(b.key)!, t = b.it.t, short = b.end - b.start < 45;
      const rw = !b.it.ghost && canWrite(t.listId);
      return `<div class="blk ${t.done ? 'done' : ''} ${b.it.ghost ? 'ghost' : ''} ${short ? 'short' : ''}" data-id="${t.id}" ${rw ? 'data-rw' : ''} style="--c:${color(t)};top:${b.start * PX_PER_MIN}px;height:${(b.end - b.start) * PX_PER_MIN - 2}px;left:calc(${p.col} * 100% / ${p.cols});width:calc(100% / ${p.cols} - 3px)">
        <div class="bt">${esc(t.title || 'Untitled')}</div><div class="bs">${fmtTime(b.it.time!)} – ${fmtTime(fromMin(b.end % 1440))}</div>${rw ? '<i class="rz" aria-hidden="true"></i>' : ''}</div>`;
    }).join('')}${gx.map(b => extBlock(b.x.ev, placed.get(b.key)!, b.start, b.end)).join('')}${nowLine}</div>`;
  };
  return `<div class="tg" style="--days:${days.length};--hour:${HOUR_PX}px">
    <div class="tg-head"><div class="tg-gut"></div>${days.map((d, i) => `<button class="tg-dh ${keys[i] === today ? 'today' : ''}" data-goday="${keys[i]}"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></button>`).join('')}</div>
    <div class="tg-all"><div class="tg-gut">all-day</div>${keys.map(k => `<div class="tg-ad" data-drop="day" data-allday data-v="${k}">${allDay(k)}</div>`).join('')}</div>
    <div class="tg-scroll"><div class="tg-body">
      <div class="tg-hours">${Array.from({ length: 24 }, (_, h) => `<div>${h ? fmtTime(fromMin(h * 60)).replace(':00', '') : ''}</div>`).join('')}</div>
      ${keys.map(col).join('')}
    </div></div>
  </div>`;
}

const minsNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Scroll the hour grid so the current time (or 7:00) is near the top. */
function scrollToNow() {
  const sc = document.querySelector<HTMLElement>('#main .tg-scroll');
  if (!sc) return;
  const today = sc.querySelector('.tg-col.today');
  sc.scrollTop = Math.max(0, ((today ? minsNow() : 7 * 60) - 90) * PX_PER_MIN);
}

function bindGrid(main: HTMLElement, keepScroll: number | undefined) {
  bindEvs(main); bindExt(main);
  main.querySelectorAll<HTMLElement>('[data-goday]').forEach(b => b.onclick = () => {
    if (prefs.calView === 'day') return;
    ui.calDate = new Date(b.dataset.goday + 'T00:00'); prefs.calView = 'day'; savePrefs(); renderCalendar();
  });
  if (keepScroll !== undefined) main.querySelector<HTMLElement>('.tg-scroll')!.scrollTop = keepScroll;
  else scrollToNow();
  main.querySelectorAll<HTMLElement>('.tg-col').forEach(c => c.ondblclick = e => {
    if ((e.target as Element).closest('.blk')) return;
    createBlock(c.dataset.v!, clampMin(snap(minuteAt(c, e.clientY) - 30), 60), 60);
  });
  const body = main.querySelector<HTMLElement>('.tg-body')!;
  body.addEventListener('pointerdown', onPointerDown);
  body.querySelectorAll<HTMLElement>('.blk[data-id]').forEach(b => b.addEventListener('click', e => {
    if (justDragged) return;
    e.stopPropagation(); select(b.dataset.id!);
  }));
}

/** Minute of the day under a pointer, in a day column. */
function minuteAt(col: HTMLElement, clientY: number) {
  return (clientY - col.getBoundingClientRect().top) / PX_PER_MIN;
}

function createBlock(day: string, start: number, dur: number) {
  const t = newTask({ due: day, time: fromMin(start), dur });
  touch(t); select(t.id);
}

// ---------- pointer drag on the hour grid ----------

interface Drag {
  mode: 'move' | 'resize' | 'create';
  id: string | null;
  el: HTMLElement | null;      // the block being moved or resized, or the preview for create
  col: HTMLElement;            // column where it started
  y0: number; x0: number;
  start: number; dur: number;  // original minutes
  grab: number;                // minutes between block top and pointer, for move
  active: boolean;             // past the click threshold (mouse) or the long-press (touch)
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
  pointerId: number;
}
let drag: Drag | null = null;
let justDragged = false;

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || drag) return;
  const target = e.target as HTMLElement;
  const col = target.closest<HTMLElement>('.tg-col');
  if (!col) return;
  const blk = target.closest<HTMLElement>('.blk');
  const touchy = e.pointerType !== 'mouse';
  let d: Drag;
  if (blk) {
    if (!blk.hasAttribute('data-rw')) return;
    const t = S.tasks[blk.dataset.id!]; if (!t) return;
    const start = Math.round(parseFloat(blk.style.top) / PX_PER_MIN), dur = Math.max(SNAP, t.dur || DEFAULT_DUR);
    d = { mode: target.classList.contains('rz') ? 'resize' : 'move', id: t.id, el: blk, col, y0: e.clientY, x0: e.clientX, start, dur, grab: minuteAt(col, e.clientY) - start, active: false, touch: touchy, pointerId: e.pointerId };
  } else {
    const start = clampMin(Math.floor(minuteAt(col, e.clientY) / SNAP) * SNAP);
    d = { mode: 'create', id: null, el: null, col, y0: e.clientY, x0: e.clientX, start, dur: SNAP, grab: 0, active: false, touch: touchy, pointerId: e.pointerId };
  }
  drag = d;
  // Touch: a press and hold starts the drag; moving first means the user is scrolling.
  if (touchy) d.timer = setTimeout(() => { if (drag === d) activate(d); }, 400);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  addEventListener('pointercancel', cancelDrag);
}

function activate(d: Drag) {
  d.active = true;
  navigator.vibrate?.(10);
  if (d.mode === 'create') {
    d.el = document.createElement('div');
    d.el.className = 'blk preview';
    d.el.style.cssText = `--c:var(--primary);left:0;width:calc(100% - 3px)`;
    d.col.appendChild(d.el);
    if (d.touch) d.dur = 60; // a long-press makes a one-hour block; drag to change
    paint(d, d.col, d.start, d.dur);
  } else d.el!.classList.add('dragging');
  document.body.classList.add('tg-dragging');
}

function paint(d: Drag, col: HTMLElement, start: number, dur: number) {
  const el = d.el!;
  if (el.parentElement !== col) col.appendChild(el);
  el.style.top = start * PX_PER_MIN + 'px';
  el.style.height = dur * PX_PER_MIN - 2 + 'px';
  if (d.mode === 'move') { el.style.left = '0'; el.style.width = 'calc(100% - 3px)'; }
  const bs = el.querySelector('.bs');
  const label = `${fmtTime(fromMin(start))} – ${fmtTime(fromMin((start + dur) % 1440))}`;
  if (bs) bs.textContent = label; else el.textContent = label;
}

/** Where the pointer is: the day column under it, or the all-day cell. */
function hitAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  return { col: el?.closest<HTMLElement>('.tg-col') || null, allDay: el?.closest<HTMLElement>('.tg-ad') || null };
}

/** Where the drag would put the block now. */
function target(d: Drag, x: number, y: number) {
  const { col: hit, allDay } = hitAt(x, y);
  const col = d.mode === 'move' ? hit || d.col : d.col;
  const m = minuteAt(col, y);
  if (d.mode === 'move') return { col, allDay: hit ? null : allDay, start: clampMin(snap(m - d.grab), d.dur), dur: d.dur };
  if (d.mode === 'resize') return { col, allDay: null, start: d.start, dur: Math.max(SNAP, Math.min(1440 - d.start, snap(m - d.start))) };
  const a = d.start, b = clampMin(snap(m), 0);
  const s = Math.min(a, b), e = Math.max(a + SNAP, b, d.touch ? a + d.dur : 0);
  return { col, allDay: null, start: s, dur: Math.min(1440 - s, e - s) };
}

function onPointerMove(e: PointerEvent) {
  const d = drag; if (!d || e.pointerId !== d.pointerId) return;
  const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
  if (!d.active) {
    if (d.touch) { if (moved > 8) cancelDrag(); return; } // scrolling
    if (moved < 4) return;
    activate(d);
  }
  e.preventDefault();
  const tg = target(d, e.clientX, e.clientY);
  document.querySelectorAll('.tg-ad.drop-over').forEach(x => x.classList.remove('drop-over'));
  if (tg.allDay) { tg.allDay.classList.add('drop-over'); d.el!.style.opacity = '.4'; return; }
  d.el!.style.opacity = '';
  paint(d, tg.col, tg.start, tg.dur);
  autoScroll(e.clientY);
}

/** Scroll the grid while dragging near its top or bottom edge. */
function autoScroll(y: number) {
  const sc = document.querySelector<HTMLElement>('#main .tg-scroll'); if (!sc) return;
  const r = sc.getBoundingClientRect();
  if (y < r.top + 30) sc.scrollTop -= 12; else if (y > r.bottom - 30) sc.scrollTop += 12;
}

function onPointerUp(e: PointerEvent) {
  const d = drag; if (!d || e.pointerId !== d.pointerId) return;
  const was = d.active;
  const tg = was ? target(d, e.clientX, e.clientY) : null;
  cleanup();
  if (!was || !tg) return;
  justDragged = true; setTimeout(() => { justDragged = false; }, 0);
  const day = tg.col.dataset.v!;
  if (d.mode === 'create') return createBlock(day, tg.start, tg.dur);
  const t = S.tasks[d.id!]; if (!t) return renderCalendar();
  if (tg.allDay) { t.due = tg.allDay.dataset.v!; t.time = null; t.tz = null; }
  else if (d.mode === 'move') setLocalWhen(t, day, fromMin(tg.start));
  else t.dur = tg.dur;
  touch(t); renderCalendar();
}

function cancelDrag() {
  const d = drag; cleanup();
  if (d?.active) renderCalendar();
}

function cleanup() {
  const d = drag; drag = null;
  if (d?.timer) clearTimeout(d.timer);
  if (d?.mode === 'create') d.el?.remove();
  d?.el?.classList.remove('dragging');
  document.body.classList.remove('tg-dragging');
  document.querySelectorAll('.tg-ad.drop-over').forEach(x => x.classList.remove('drop-over'));
  removeEventListener('pointermove', onPointerMove);
  removeEventListener('pointerup', onPointerUp);
  removeEventListener('pointercancel', cancelDrag);
}

// While a touch drag is active, stop the page from scrolling under it.
document.addEventListener('touchmove', e => { if (drag?.active) e.preventDefault(); }, { passive: false });

/** Keep the "now" line current while the grid is open. */
export function initCalendar() {
  setInterval(() => {
    const now = document.querySelector<HTMLElement>('#main .tg-col.today .now');
    if (now) now.style.top = minsNow() * PX_PER_MIN + 'px';
  }, 60000);
}
