/**
 * Habit rules, pure: daily goals ("8 glasses"), weekly frequency
 * ("3 times a week"), streaks and when a reminder is due.
 */
import type { Habit, Ymd } from './types';
import { addDays, parseYmd, ymd, zonedEpoch } from './lib/dates';
import { weekStartOf } from './calendar';

export const goalOf = (h: Pick<Habit, 'goal'>): number => Math.max(1, Math.floor(h.goal || 1));

/** Check-ins on a day. `true` is old data for "done". */
export function countOn(h: Pick<Habit, 'checks' | 'goal'>, day: Ymd): number {
  const v = h.checks[day];
  return v === true ? goalOf(h) : typeof v === 'number' ? v : 0;
}

export const doneOn = (h: Pick<Habit, 'checks' | 'goal'>, day: Ymd): boolean => countOn(h, day) >= goalOf(h);

/** The value to store for `n` check-ins on a day (undefined = remove the day). */
export function checkValue(h: Pick<Habit, 'goal'>, n: number): true | number | undefined {
  n = Math.max(0, Math.min(999, Math.floor(n)));
  if (!n) return undefined;
  return goalOf(h) === 1 && n === 1 ? true : n;
}

/**
 * The check-ins after one tap on a day. A goal of 1 toggles. A bigger goal
 * adds one, and keeps counting past the goal (a 9th glass is still a glass):
 * a tap never wipes the day. Use `checkValue(h, n - 1)` to take one back.
 */
export function tapValue(h: Pick<Habit, 'checks' | 'goal'>, day: Ymd): true | number | undefined {
  const g = goalOf(h), n = countOn(h, day);
  if (g === 1) return n ? undefined : true;
  return checkValue(h, n + 1);
}

/** Days done in the week that contains `day`. */
export function doneInWeek(h: Pick<Habit, 'checks' | 'goal'>, day: Ymd, weekStart: number): number {
  const s = weekStartOf(parseYmd(day), weekStart);
  let n = 0;
  for (let i = 0; i < 7; i++) if (doneOn(h, ymd(addDays(s, i)))) n++;
  return n;
}

/** Days per week needed, or null for an every-day habit. */
export const perWeekOf = (h: Pick<Habit, 'perWeek'>): number | null => (h.perWeek && h.perWeek > 0 && h.perWeek < 7 ? Math.floor(h.perWeek) : null);

/**
 * Current streak. Every-day habits count days, ending today (or yesterday, if
 * today is not done yet). Weekly habits count weeks that met the target,
 * ending this week (or last week, if this one is not met yet).
 *
 * Weekly habits with `streakIn: 'days'` count done days instead: each met week
 * adds all its done days. This week adds its done days so far while the target
 * can still be met in the days left; once it cannot, the streak is 0.
 */
export function streak(h: Pick<Habit, 'checks' | 'goal' | 'perWeek' | 'streakIn'>, today: Ymd, weekStart = 1): { n: number; unit: 'day' | 'week' } {
  const pw = perWeekOf(h);
  if (!pw) {
    let d = parseYmd(today), n = 0;
    if (!doneOn(h, today)) d = addDays(d, -1);
    while (doneOn(h, ymd(d))) { n++; d = addDays(d, -1); }
    return { n, unit: 'day' };
  }
  if (h.streakIn === 'days') {
    let w = weekStartOf(parseYmd(today), weekStart), n = 0;
    const done = doneInWeek(h, today, weekStart);
    if (done < pw) {
      // Days left to do it: the rest of the week, plus today if not done yet.
      const idx = Math.round((parseYmd(today).getTime() - w.getTime()) / 864e5);
      const open = 6 - idx + (doneOn(h, today) ? 0 : 1);
      if (pw - done > open) return { n: 0, unit: 'day' };
    }
    n += done; w = addDays(w, -7);
    for (let i = 0; i < 520; i++, w = addDays(w, -7)) {
      const d = doneInWeek(h, ymd(w), weekStart);
      if (d < pw) break;
      n += d;
    }
    return { n, unit: 'day' };
  }
  let w = weekStartOf(parseYmd(today), weekStart), n = 0;
  if (doneInWeek(h, ymd(w), weekStart) < pw) w = addDays(w, -7);
  for (let i = 0; i < 520 && doneInWeek(h, ymd(w), weekStart) >= pw; i++) { n++; w = addDays(w, -7); }
  return { n, unit: 'week' };
}

/**
 * Does the habit need doing on `day`? Every-day habits: until done. Weekly
 * ones only once they cannot wait: the days still needed fill every day left
 * in the week, today included. "3 a week" with none done reminds from Friday
 * (Monday weeks), not every day.
 */
export function stillDue(h: Pick<Habit, 'checks' | 'goal' | 'perWeek'>, day: Ymd, weekStart = 1): boolean {
  if (doneOn(h, day)) return false;
  const pw = perWeekOf(h);
  if (!pw) return true;
  const need = pw - doneInWeek(h, day, weekStart);
  if (need <= 0) return false;
  const start = weekStartOf(parseYmd(day), weekStart);
  const daysLeft = 7 - Math.round((parseYmd(day).getTime() - start.getTime()) / 864e5);
  return need >= daysLeft;
}

/** The days a habit row shows: the current week for weekly habits, the last 7 days otherwise. */
export function stripDays(h: Pick<Habit, 'perWeek'>, today: Ymd, weekStart = 1): Ymd[] {
  const first = perWeekOf(h) ? weekStartOf(parseYmd(today), weekStart) : addDays(parseYmd(today), -6);
  return Array.from({ length: 7 }, (_, i) => ymd(addDays(first, i)));
}

/**
 * Reminder for `day`, if the habit has one and still needs doing then.
 * The time floats: it happens in `tz` (this device's zone when omitted).
 */
export function habitReminder(h: Habit, day: Ymd, tz?: string, weekStart = 1): { key: string; at: number } | null {
  if (!h.remind || h.removed || !stillDue(h, day, weekStart)) return null;
  const [hh, mm] = h.remind.split(':').map(Number);
  return { key: `habit|${h.id}|${day}|${h.remind}`, at: zonedEpoch(day, hh!, mm!, tz) };
}

/** A streak run: first and last day (week runs end on the week's last day), and its length in the streak unit. */
export interface Run { start: Ymd; end: Ymd; n: number }

type StatHabit = Pick<Habit, 'checks' | 'goal' | 'perWeek' | 'streakIn'>;

/** First day with any check-in, up to `today`. */
function firstDay(h: Pick<Habit, 'checks' | 'goal'>, today: Ymd): Ymd | null {
  let first: Ymd | null = null;
  for (const d of Object.keys(h.checks)) if (d <= today && countOn(h, d) > 0 && (!first || d < first)) first = d;
  return first;
}

/** Days of the week starting `w` still open on `today` (today included unless done). */
function openDays(h: Pick<Habit, 'checks' | 'goal'>, w: Date, today: Ymd): number {
  const idx = Math.round((parseYmd(today).getTime() - w.getTime()) / 864e5);
  return 6 - idx + (doneOn(h, today) ? 0 : 1);
}

/**
 * Every streak run, oldest first, in the same unit and with the same rules as
 * `streak()`: an open today never ends a run, and in days mode this week joins
 * the run while its target can still be met. Days after `today` are ignored.
 */
export function runs(h: StatHabit, today: Ymd, weekStart = 1): Run[] {
  const first = firstDay(h, today);
  if (!first) return [];
  const out: Run[] = [];
  let cur: Run | null = null;
  const close = () => { if (cur) out.push(cur); cur = null; };
  const pw = perWeekOf(h);
  if (!pw) {
    for (let d = parseYmd(first); ymd(d) <= today; d = addDays(d, 1)) {
      const k = ymd(d);
      if (doneOn(h, k)) { if (cur) { cur.end = k; cur.n++; } else cur = { start: k, end: k, n: 1 }; }
      else if (k !== today) close();
    }
    close();
    return out;
  }
  const days = h.streakIn === 'days';
  const thisWeek = ymd(weekStartOf(parseYmd(today), weekStart));
  for (let w = weekStartOf(parseYmd(first), weekStart); ymd(w) <= today; w = addDays(w, 7)) {
    const k = ymd(w), done = doneInWeek(h, k, weekStart);
    const counts = done >= pw || (days && k === thisWeek && pw - done <= openDays(h, w, today));
    if (!counts) { close(); continue; }
    const end = ymd(addDays(w, 6)), add = days ? done : 1;
    if (!cur && !add) continue; // an open week with nothing done yet starts no run
    if (cur) { cur.end = end; cur.n += add; } else cur = { start: k, end, n: add };
  }
  close();
  return out;
}

/**
 * Stats for a habit's detail page, derived on every call (never stored).
 * - `total`: done days up to `today`.
 * - `rate`: done ÷ due since the first check-in, null with none. Every-day
 *   habits: each day is due, but an open today is not (it joins once done).
 *   Weekly habits: each week owes `perWeek` and earns its done days up to that;
 *   this week owes only what is done so far, until the target is out of reach.
 * - `current`, `best`, `top` (10 best runs, longest first, then newest): in
 *   `unit`, which follows `streakIn` like `streak()`.
 */
export function habitStats(h: StatHabit, today: Ymd, weekStart = 1): { total: number; rate: number | null; current: number; best: number; unit: 'day' | 'week'; top: Run[] } {
  const all = runs(h, today, weekStart);
  const cur = streak(h, today, weekStart);
  const top = [...all].sort((a, b) => b.n - a.n || (a.start < b.start ? 1 : -1)).slice(0, 10);
  let total = 0;
  for (const d of Object.keys(h.checks)) if (d <= today && doneOn(h, d)) total++;
  const first = firstDay(h, today);
  let rate: number | null = null;
  if (first) {
    let done = 0, due = 0;
    const pw = perWeekOf(h);
    if (!pw) {
      for (let d = parseYmd(first); ymd(d) <= today; d = addDays(d, 1)) {
        const k = ymd(d), ok = doneOn(h, k);
        if (ok) done++;
        if (ok || k !== today) due++;
      }
    } else {
      const thisWeek = ymd(weekStartOf(parseYmd(today), weekStart));
      for (let w = weekStartOf(parseYmd(first), weekStart); ymd(w) <= today; w = addDays(w, 7)) {
        const k = ymd(w), got = Math.min(pw, doneInWeek(h, k, weekStart));
        done += got;
        due += k === thisWeek && pw - got <= openDays(h, w, today) ? got : pw;
      }
    }
    rate = due ? done / due : null;
  }
  return { total, rate, current: cur.n, best: top[0]?.n ?? 0, unit: cur.unit, top };
}

/** Done days per calendar month for the last `months` months, oldest first, ending with `today`'s month. */
export function perMonth(h: Pick<Habit, 'checks' | 'goal'>, today: Ymd, months = 12): { month: string; n: number }[] {
  const t = parseYmd(today);
  const out = Array.from({ length: months }, (_, i) => {
    const d = new Date(t.getFullYear(), t.getMonth() - (months - 1 - i), 1);
    return { month: ymd(d).slice(0, 7), n: 0 };
  });
  const at = new Map(out.map(m => [m.month, m]));
  for (const d of Object.keys(h.checks)) if (d <= today && doneOn(h, d)) { const m = at.get(d.slice(0, 7)); if (m) m.n++; }
  return out;
}

/**
 * How a day looks on the heatmap. The Next tier adds 'skip' and 'auto'
 * (auto-filled); N3 marks the rest of a met week separately.
 */
export type DayLevel = 'none' | 'part' | 'done' | 'over';

export function dayLevel(h: Pick<Habit, 'checks' | 'goal'>, day: Ymd): DayLevel {
  const n = countOn(h, day), g = goalOf(h);
  return !n ? 'none' : n < g ? 'part' : n > g && h.checks[day] !== true ? 'over' : 'done';
}

/**
 * A year as whole weeks (columns of 7 days, oldest first), from the week that
 * holds 1 Jan to the week that holds 31 Dec. Days of the next or previous year
 * fill the edges; the view hides them.
 */
export function yearWeeks(year: number, weekStart = 1): Ymd[][] {
  const last = ymd(new Date(year, 11, 31)), out: Ymd[][] = [];
  for (let w = weekStartOf(new Date(year, 0, 1), weekStart); ymd(w) <= last; w = addDays(w, 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => ymd(addDays(w, i))));
  }
  return out;
}

/**
 * Does `day` show the "week met" mark? Weekly habits only: once the week holding
 * `day` reaches `perWeek`, each of its days with no check-in gets it, future
 * days included. Display only: it never changes `checks`, streaks or stats.
 */
export function metWeekFill(h: Pick<Habit, 'checks' | 'goal' | 'perWeek'>, day: Ymd, weekStart = 1): boolean {
  const pw = perWeekOf(h);
  return !!pw && countOn(h, day) === 0 && doneInWeek(h, day, weekStart) >= pw;
}

/**
 * "Did you do these yesterday?": habits that existed yesterday, were still due
 * then (`stillDue`) and are not done, in habit order. Client data only.
 */
export function missedYesterday(habits: Habit[], today: Ymd, weekStart = 1): Habit[] {
  const start = parseYmd(today).getTime(), y = ymd(addDays(parseYmd(today), -1));
  return habits
    .filter(h => !h.removed && (h.created || 0) < start && stillDue(h, y, weekStart))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
