import type { Ymd } from '../types';

export const pad = (n: number): string => String(n).padStart(2, '0');
export const ymd = (d: Date): Ymd => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: Ymd): Date => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const tzFmt = new Map<string, Intl.DateTimeFormat>();
/** Offset of `tz` from UTC at instant `ms`, in ms (UTC+2 gives 7_200_000). */
export function tzOffset(ms: number, tz: string): number {
  let f = tzFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    tzFmt.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = +x.value;
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(ms / 1000) * 1000;
}
/**
 * The instant a wall-clock time happens in `tz`. Floating task times use the
 * device's zone; the server passes the zone each push subscription reported.
 * A time skipped by a DST jump lands one hour later; a repeated one takes the first.
 */
export function zonedEpoch(day: Ymd, hh: number, mm: number, tz?: string): number {
  if (!tz) { const d = parseYmd(day); d.setHours(hh, mm); return d.getTime(); }
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, hh, mm);
  // Offsets a day either side cover any DST change near this time.
  const before = wall - tzOffset(wall - 864e5, tz), after = wall - tzOffset(wall + 864e5, tz);
  const ok = [before, after].filter(t => t + tzOffset(t, tz) === wall);
  return ok.length ? Math.min(...ok) : before;
}
export const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const todayD = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const TODAY = (): Ymd => ymd(todayD());
export const tomorrow = (): Ymd => ymd(addDays(todayD(), 1));
export const dayDiff = (s: Ymd): number => Math.round((parseYmd(s).getTime() - todayD().getTime()) / 864e5);

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number) as [number, number];
  return `${hh % 12 || 12}:${pad(mm)}${hh < 12 ? ' AM' : ' PM'}`;
}

export function fmtDue(due: Ymd | null | undefined, time?: string | null): string {
  if (!due) return '';
  const n = dayDiff(due), d = parseYmd(due);
  let s: string;
  if (n === 0) s = 'Today';
  else if (n === 1) s = 'Tomorrow';
  else if (n === -1) s = 'Yesterday';
  else if (n > 1 && n < 7) s = DOW[d.getDay()]!;
  else s = `${MON[d.getMonth()]} ${d.getDate()}` + (d.getFullYear() !== todayD().getFullYear() ? `, ${d.getFullYear()}` : '');
  return time ? `${s}, ${fmtTime(time)}` : s;
}

export const dueClass = (t: { due: Ymd | null; done: boolean }): string => {
  if (!t.due || t.done) return '';
  const n = dayDiff(t.due);
  return n < 0 ? 'late' : n === 0 ? 'soon' : '';
};

export const nextMonday = (today: Date = todayD()): Ymd => ymd(addDays(today, ((8 - today.getDay()) % 7) || 7));
