/**
 * Task export for other apps: CSV (spreadsheets) and iCalendar VTODO (.ics,
 * for Thunderbird, Apple Reminders via import, other to-do apps). The full
 * backup (every entity, re-importable) stays JSON: src/views/rail.ts.
 */
import type { List, RepeatRule, Task } from '../types';
import { zonedEpoch } from './dates';
import { repeatLabel } from '../recurrence';

/** Tasks worth exporting: not in Trash, not tombstones. */
export const exportable = (tasks: Task[]): Task[] =>
  tasks.filter(t => !t.deleted && !t.removed).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.order - b.order);

const PRI_NAME: Record<number, string> = { 0: '', 1: 'Low', 3: 'Medium', 5: 'High' };
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : '');

// ---- CSV (RFC 4180) ----

/**
 * One cell. Cells that start like a formula get a leading apostrophe, so a
 * spreadsheet shows "=SUM(…)" as text instead of running it (CSV injection).
 */
export function csvCell(v: string): string {
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function tasksCsv(tasks: Task[], lists: Record<string, List>): string {
  const head = ['Title', 'List', 'Due date', 'Due time', 'Time zone', 'Priority', 'Tags', 'Status', 'Completed', 'Repeat', 'Checklist', 'Description', 'Created'];
  const rows = exportable(tasks).map(t => [
    t.title, lists[t.listId]?.name || '', t.due || '', t.time || '', t.tz || '', PRI_NAME[t.priority] || '',
    (t.tags || []).join(' '), t.done ? 'Done' : 'Open', iso(t.doneAt), t.repeat ? repeatLabel(t.repeat) : '',
    (t.items || []).map(i => (i.done ? '[x] ' : '[ ] ') + i.title).join('\n'), t.desc || '', iso(t.created),
  ]);
  // BOM: Excel otherwise reads UTF-8 as a legacy code page.
  return '\uFEFF' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---- iCalendar (RFC 5545) ----

export const icsText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line to 75 octets, never splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // Continuation lines start with a space, which counts toward their 75.
    if (bytes + n > 75) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymdCompact = (d: string) => d.replace(/-/g, '');
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * RRULE for a rule. `until` must have the same value type as DTSTART
 * (RFC 5545 §3.3.10): pass how to write the last day, else a DATE.
 */
export function rrule(r: RepeatRule, until: (day: string) => string = ymdCompact): string {
  const p = ['FREQ=' + r.freq.toUpperCase()];
  if ((r.interval || 1) > 1) p.push('INTERVAL=' + r.interval);
  if (r.freq === 'weekly' && r.byDay?.length) p.push('BYDAY=' + r.byDay.map(d => DAYS[d]).join(','));
  if (r.until) p.push('UNTIL=' + until(r.until));
  else if (r.count) p.push('COUNT=' + Math.max(1, r.count - (r.done || 0)));
  return p.join(';');
}

/**
 * A task's due as an iCalendar value: a DATE, a floating local time, or UTC
 * when pinned to a zone. `until` writes a repeat's last day in the same type.
 */
function dueValue(t: Task): { prop: string; until: (day: string) => string } | null {
  if (!t.due) return null;
  if (!t.time) return { prop: ';VALUE=DATE:' + ymdCompact(t.due), until: ymdCompact };
  const [h, m] = t.time.split(':').map(Number);
  if (t.tz) return { prop: ':' + utcStamp(zonedEpoch(t.due, h!, m!, t.tz)), until: d => utcStamp(zonedEpoch(d, 23, 59, t.tz!)) };
  return { prop: `:${ymdCompact(t.due)}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`, until: d => ymdCompact(d) + 'T235959' };
}

/** xairos priority (5 high, 3 medium, 1 low) as iCalendar's 1 (high) to 9 (low). */
const ICS_PRI: Record<number, number> = { 5: 1, 3: 5, 1: 9 };

export function tasksIcs(tasks: Task[], lists: Record<string, List>, now = Date.now()): string {
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//xairos//Tasks//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:xairos'];
  for (const t of exportable(tasks)) {
    L.push('BEGIN:VTODO', `UID:${t.id}@xairos`, 'DTSTAMP:' + utcStamp(now), 'SUMMARY:' + icsText(t.title || 'Untitled'));
    if (t.created) L.push('CREATED:' + utcStamp(t.created));
    if (t.mtime) L.push('LAST-MODIFIED:' + utcStamp(t.mtime));
    const desc = [t.desc || '', ...(t.items || []).map(i => (i.done ? '[x] ' : '[ ] ') + i.title)].filter(Boolean).join('\n');
    if (desc) L.push('DESCRIPTION:' + icsText(desc));
    const due = dueValue(t);
    if (due) L.push('DUE' + due.prop);
    // A repeat needs DTSTART (RFC 5545 §3.8.5.3): the first occurrence, same as the due.
    if (due && t.repeat) L.push('DTSTART' + due.prop);
    if (ICS_PRI[t.priority]) L.push('PRIORITY:' + ICS_PRI[t.priority]);
    const cats = [lists[t.listId]?.name, ...(t.tags || [])].filter((x): x is string => !!x);
    if (cats.length) L.push('CATEGORIES:' + cats.map(icsText).join(','));
    if (due && t.repeat) L.push('RRULE:' + rrule(t.repeat, due.until));
    if (t.done) L.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100', ...(t.doneAt ? ['COMPLETED:' + utcStamp(t.doneAt)] : []));
    else L.push('STATUS:NEEDS-ACTION');
    // Reminders are minutes before a timed due: RELATED=END ties them to DUE, not DTSTART.
    if (t.time && !t.done) for (const m of t.reminders || []) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(t.title || 'Reminder'), `TRIGGER;RELATED=END:${m ? '-PT' + m + 'M' : 'PT0S'}`, 'END:VALARM');
    }
    L.push('END:VTODO');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
