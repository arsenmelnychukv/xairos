import type { RepeatRule, Ymd } from './types';
import { MON, addDays, fmtDue, nextMonday, pad, parseYmd, todayD, ymd } from './lib/dates';
import { firstOccurrence, repeatLabel } from './recurrence';

export interface QuickChip { cls: string; txt: string }
export interface QuickParse {
  title: string;
  due: Ymd | null;
  time: string | null;
  priority: number | null;
  tags: string[];
  listName: string | null;
  repeat: RepeatRule | null;
  chips: QuickChip[];
}

const WD: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const wdOf = (w: string): number => WD[w.toLowerCase().slice(0, 3)]!;
const WDRE = '(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const PRI: Record<string, number> = { high: 5, '3': 5, med: 3, medium: 3, '2': 3, low: 1, '1': 1, none: 0, '0': 0 };

/**
 * Parse a quick-add line like "Pay rent every month 9am !high #home ^Bills".
 * `today` (local midnight) anchors relative dates; the server passes the
 * user's date, since its own clock may be in another zone.
 */
export function parseQuick(raw: string, today: Date = todayD()): QuickParse {
  let s = ' ' + raw + ' ';
  const out: QuickParse = { title: '', due: null, time: null, priority: null, tags: [], listName: null, repeat: null, chips: [] };
  // Each matcher removes its text; returning false keeps the text (no match).
  const take = (re: RegExp, fn: (...m: string[]) => void | false) => {
    s = s.replace(re, (...m: string[]) => (fn(...m) === false ? m[0]! : ' '));
  };

  take(/\s!(high|med|medium|low|none|[0-3])(?=\s)/i, (_, p) => { out.priority = PRI[p!.toLowerCase()]!; });
  take(/\s#([\w-]+)(?=\s)/g, (_, t) => { out.tags.push(t!.toLowerCase()); });
  take(/\s\^([\w-]+)(?=\s)/, (_, l) => { out.listName = l!; });

  // Repeat, before dates, so "every monday" is not read as a date.
  take(/\severy\s+weekdays?(?=\s)/i, () => { out.repeat = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }; });
  if (!out.repeat) take(/\s(?:every\s+day|daily)(?=\s)/i, () => { out.repeat = { freq: 'daily', interval: 1 }; });
  if (!out.repeat) take(/\severy\s+(\d{1,3})\s+(day|days|week|weeks|month|months|year|years)(?=\s)/i, (_, n, u) => {
    const f = u!.startsWith('day') ? 'daily' : u!.startsWith('week') ? 'weekly' : u!.startsWith('month') ? 'monthly' : 'yearly';
    out.repeat = { freq: f, interval: +n! };
  });
  if (!out.repeat) take(/\s(?:every\s+month|monthly)(?=\s)/i, () => { out.repeat = { freq: 'monthly', interval: 1 }; });
  if (!out.repeat) take(/\s(?:every\s+year|yearly|annually)(?=\s)/i, () => { out.repeat = { freq: 'yearly', interval: 1 }; });
  if (!out.repeat) take(new RegExp('\\severy\\s+(' + WDRE + '(?:\\s*(?:,|and)\\s*' + WDRE + ')*)(?=\\s)', 'i'), (_, list) => {
    out.repeat = { freq: 'weekly', interval: 1, byDay: [...new Set(list!.split(/\s*(?:,|and)\s*/i).map(wdOf))].sort() };
  });
  if (!out.repeat) take(/\s(?:every\s+week|weekly)(?=\s)/i, () => { out.repeat = { freq: 'weekly', interval: 1 }; });

  // Time
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (_, hh, mm, ap) => {
    const h = (+hh! % 12) + (ap!.toLowerCase() === 'pm' ? 12 : 0);
    out.time = `${pad(h)}:${pad(+(mm || 0))}`;
  });
  if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (_, hh, mm) => { out.time = `${pad(+hh!)}:${mm}`; });
  if (!out.time) take(/\sat\s+(\d{1,2})(?=\s)/i, (_, hh) => { if (+hh! > 23) return false; out.time = `${pad(+hh!)}:00`; });

  // Date
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  take(/\s(today|tod)(?=\s)/i, () => { out.due = ymd(t0); });
  if (!out.due) take(/\s(tomorrow|tmr|tmrw)(?=\s)/i, () => { out.due = ymd(addDays(t0, 1)); });
  if (!out.due) take(/\snext\s+week(?=\s)/i, () => { out.due = nextMonday(t0); });
  if (!out.due) take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (_, n, u) => {
    out.due = ymd(addDays(t0, +n! * (u!.startsWith('week') ? 7 : 1)));
  });
  if (!out.due) take(new RegExp('\\s(?:on\\s+|next\\s+)?(' + WDRE + ')(?=\\s)', 'i'), (_, w) => {
    let n = (wdOf(w!) - t0.getDay() + 7) % 7;
    if (n === 0) n = 7;
    out.due = ymd(addDays(t0, n));
  });
  if (!out.due) take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?=\s)/, (_, ms, ds) => {
    const m = +ms!, d = +ds!;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const c = new Date(t0.getFullYear(), m - 1, d);
    if (c < t0) c.setFullYear(c.getFullYear() + 1);
    out.due = ymd(c);
  });
  if (!out.due) take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?=\s)/i, (_, m, d) => {
    const mi = MON.findIndex(x => x.toLowerCase() === m!.toLowerCase().slice(0, 3));
    const c = new Date(t0.getFullYear(), mi, +d!);
    if (c < t0) c.setFullYear(c.getFullYear() + 1);
    out.due = ymd(c);
  });

  const rep = out.repeat as RepeatRule | null;
  if (rep) {
    if (!out.due) out.due = firstOccurrence(rep, t0);
    if (rep.freq === 'weekly' && !rep.byDay) rep.byDay = [parseYmd(out.due).getDay()];
    rep.dom = parseYmd(out.due).getDate();
    rep.from = 'due';
  }
  if (out.time && !out.due) out.due = ymd(t0);
  out.title = s.replace(/\s+/g, ' ').trim();

  if (out.due) out.chips.push({ cls: '', txt: fmtDue(out.due, out.time) });
  if (rep) out.chips.push({ cls: '', txt: '↻ ' + repeatLabel(rep) });
  if (out.priority) out.chips.push({ cls: 'pri-' + out.priority, txt: ({ 5: 'High', 3: 'Medium', 1: 'Low' } as Record<number, string>)[out.priority]! });
  out.tags.forEach(t => out.chips.push({ cls: '', txt: '#' + t }));
  if (out.listName) out.chips.push({ cls: '', txt: '^' + out.listName });
  return out;
}
