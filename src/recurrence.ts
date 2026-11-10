import type { RepeatRule, Task, Ymd } from './types';
import { DOW, addDays, fmtDue, parseYmd, todayD, ymd } from './lib/dates';

/** Add n months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsClamp(d: Date, n: number, dom?: number): Date {
  const y = d.getFullYear(), m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dom || d.getDate(), last));
}

/** The occurrence after `fromYmd` for this rule. */
export function nextDue(rule: RepeatRule, fromYmd: Ymd): Ymd {
  const d = parseYmd(fromYmd), iv = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'daily': return ymd(addDays(d, iv));
    case 'weekly': {
      const days = rule.byDay?.length ? rule.byDay : [d.getDay()];
      const weekStart = (x: Date) => addDays(x, -x.getDay()).getTime();
      for (let i = 1; i <= 7; i++) {
        const c = addDays(d, i);
        if (days.includes(c.getDay())) return ymd(weekStart(c) !== weekStart(d) ? addDays(c, (iv - 1) * 7) : c);
      }
      return ymd(addDays(d, 7 * iv));
    }
    case 'monthly': return ymd(addMonthsClamp(d, iv, rule.dom));
    case 'yearly': return ymd(addMonthsClamp(d, 12 * iv, rule.dom));
  }
  return ymd(addDays(d, 1));
}

export function repeatLabel(r: RepeatRule | null | undefined): string {
  if (!r) return '';
  const iv = r.interval || 1, days = (r.byDay || []).slice().sort();
  let s: string;
  if (r.freq === 'daily') s = iv === 1 ? 'Daily' : `Every ${iv} days`;
  else if (r.freq === 'weekly') {
    if (iv === 1 && days.join() === '1,2,3,4,5') s = 'Weekdays';
    else s = (iv === 1 ? 'Weekly' : `Every ${iv} weeks`) + (days.length ? ' on ' + days.map(x => DOW[x]).join(', ') : '');
  } else if (r.freq === 'monthly') s = (iv === 1 ? 'Monthly' : `Every ${iv} months`) + (r.dom ? ` on day ${r.dom}` : '');
  else s = iv === 1 ? 'Yearly' : `Every ${iv} years`;
  if (r.from === 'completion') s += ' (after completion)';
  if (r.until) s += `, until ${fmtDue(r.until)}`;
  return s;
}

/** First date (today or later) the rule lands on. */
export function firstOccurrence(rule: RepeatRule, today: Date = todayD()): Ymd {
  const t0 = today;
  if (rule.freq === 'weekly' && rule.byDay?.length) {
    for (let i = 0; i < 7; i++) { const c = addDays(t0, i); if (rule.byDay.includes(c.getDay())) return ymd(c); }
  }
  return ymd(t0);
}

/** Future occurrences of a repeating task between two dates (for calendar ghosts). */
export function occurrences(t: Pick<Task, 'repeat' | 'due' | 'done'>, fromY: Ymd, toY: Ymd): Ymd[] {
  const out: Ymd[] = [];
  if (!t.repeat || !t.due || t.done || t.repeat.from === 'completion') return out;
  let d = t.due, n = t.repeat.done || 0;
  for (let i = 0; i < 120; i++) {
    d = nextDue(t.repeat, d); n++;
    if (d > toY) break;
    if (t.repeat.until && d > t.repeat.until) break;
    if (t.repeat.count && n >= t.repeat.count) break;
    if (d >= fromY) out.push(d);
  }
  return out;
}

/** Where a repeating task moves when completed on `today`. `finished` means the series ends. */
export function advanceRepeat(rule: RepeatRule, due: Ymd, today: Ymd): { next: Ymd; finished: boolean } {
  let next = nextDue(rule, rule.from === 'completion' ? today : due);
  if (rule.from !== 'completion') while (next < today && next < (rule.until || '9999')) next = nextDue(rule, next); // skip missed
  const finished = !!(rule.until && next > rule.until) || !!(rule.count && (rule.done || 0) + 1 >= rule.count);
  return { next, finished };
}
