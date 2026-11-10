/**
 * Pure calendar logic: which tasks land on which local day and time, and how
 * overlapping time blocks share a day column. src/views/calendar.ts draws it.
 */
import type { Task, Ymd } from './types';
import { addDays, parseYmd, ymd } from './lib/dates';
import { convertWall, pinnedTz, when } from './lib/tz';
import { occurrences } from './recurrence';

/** Shown length of a timed task without one. */
export const DEFAULT_DUR = 30;
/** Drag and resize snap to this many minutes. */
export const SNAP = 15;

export interface CalItem { t: Task; due: Ymd; time: string | null; ghost: boolean }

/** First day of the week containing `d`. `weekStart`: 1 = Monday, 0 = Sunday. */
export function weekStartOf(d: Date, weekStart: number): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return addDays(x, -((x.getDay() - weekStart + 7) % 7));
}

/** Weekday indexes in display order: [1..6, 0] for Monday weeks. */
export const weekOrder = (weekStart: number): number[] => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

/**
 * Tasks and upcoming repeats on local days `from`..`to` (inclusive), in this
 * device's zone (`viewTz` for tests). Pinned times convert, so a 23:00 Berlin
 * task can land on the next day in New York.
 */
export function itemsInRange(tasks: Task[], from: Ymd, to: Ymd, viewTz?: string): CalItem[] {
  const out: CalItem[] = [];
  // Pinned times can shift a day either way: look one day wider, then filter.
  const wideFrom = ymd(addDays(parseYmd(from), -1)), wideTo = ymd(addDays(parseYmd(to), 1));
  for (const t of tasks) {
    if (!t.due) continue;
    const w = when(t, viewTz);
    if (w.due! >= from && w.due! <= to) out.push({ t, due: w.due!, time: w.time, ghost: false });
    const tz = pinnedTz(t);
    for (const d of occurrences(t, wideFrom, wideTo)) {
      const g = tz ? convertWall(d, t.time!, tz, viewTz) : { due: d, time: t.time };
      if (g.due >= from && g.due <= to) out.push({ t, due: g.due, time: g.time, ghost: true });
    }
  }
  return out;
}

export const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m!; };
export const fromMin = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const snap = (min: number, step = SNAP): number => Math.round(min / step) * step;
export const clampMin = (min: number, dur = 0): number => Math.max(0, Math.min(24 * 60 - Math.max(dur, SNAP), min));

export interface Block { key: string; start: number; end: number }
export interface Placed { key: string; col: number; cols: number }

/**
 * Lay out one day's blocks side by side where they overlap. Each group of
 * blocks that overlap (directly or through others) splits the width into as
 * many columns as it needs; each block takes the first free column.
 */
export function layoutDay(blocks: Block[]): Placed[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let group: { key: string; col: number }[] = [], ends: number[] = [], groupEnd = -1;
  const flush = () => { for (const g of group) out.push({ key: g.key, col: g.col, cols: ends.length }); group = []; ends = []; };
  for (const b of sorted) {
    if (b.start >= groupEnd) { flush(); groupEnd = -1; }
    let col = ends.findIndex(e => e <= b.start);
    if (col < 0) { col = ends.length; ends.push(b.end); } else ends[col] = b.end;
    group.push({ key: b.key, col });
    groupEnd = Math.max(groupEnd, b.end);
  }
  flush();
  return out;
}

/** A Google event placed on one local day: all day, or minutes [start, end) of that day. */
export interface ExtPlaced { ev: import('./server/adapter').ExtEvent; day: Ymd; allDay: boolean; start: number; end: number }

/**
 * Google events on local days `from`..`to`. All-day events cover their dates
 * (end exclusive). Timed ones convert to this device's clock and are clipped
 * to each day they touch, so an overnight event shows on both days.
 */
export function extInRange(events: import('./server/adapter').ExtEvent[], from: Ymd, to: Ymd): ExtPlaced[] {
  const out: ExtPlaced[] = [];
  for (const ev of events) {
    if (ev.date) {
      for (let d = parseYmd(ev.date > from ? ev.date : from), i = 0; i < 400; i++, d = addDays(d, 1)) {
        const k = ymd(d);
        if (k > to || k >= (ev.endDate || ev.date) && k !== ev.date) break;
        out.push({ ev, day: k, allDay: true, start: 0, end: 1440 });
      }
    } else if (ev.start !== undefined) {
      const end = Math.max(ev.end ?? ev.start, ev.start + 60000);
      const first = new Date(ev.start); first.setHours(0, 0, 0, 0);
      for (let d = first, i = 0; i < 60 && d.getTime() < end; i++, d = addDays(d, 1)) {
        const k = ymd(d);
        if (k > to) break;
        if (k < from) continue;
        const day0 = d.getTime(), day1 = addDays(d, 1).getTime();
        out.push({ ev, day: k, allDay: false, start: Math.round((Math.max(ev.start, day0) - day0) / 60000), end: Math.round((Math.min(end, day1) - day0) / 60000) });
      }
    }
  }
  return out;
}
