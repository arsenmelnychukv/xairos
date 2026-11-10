/** Pure reminder scheduling: when each reminder of a task is due. */
import type { Task } from './types';
import { zonedEpoch } from './lib/dates';

export interface ReminderTime { key: string; at: number }

/**
 * Untimed tasks remind at 9:00. Keys change when the date or time changes, so
 * a moved task reminds again. Floating times happen in `tz` (an IANA zone such
 * as "Europe/Berlin"), or in this device's zone when omitted. A task with a
 * pinned zone (`t.tz`) happens in that zone.
 */
export function reminderTimes(t: Task, tz?: string): ReminderTime[] {
  const out: ReminderTime[] = [];
  if (t.done || t.deleted || t.removed) return out;
  if (t.due && t.reminders?.length) {
    const [hh, mm] = t.time ? t.time.split(':').map(Number) : [9, 0];
    // A pinned task happens at its own zone's wall time, whatever the device's zone.
    const base = zonedEpoch(t.due, hh!, mm!, (t.time && t.tz) || tz);
    const pin = t.time && t.tz ? '@' + t.tz : ''; // re-pinning moves the time, so it reminds again
    for (const m of t.reminders) out.push({ key: `${t.id}|${t.due}|${t.time || ''}${pin}|${m}`, at: base - m * 6e4 });
  }
  if (t.snooze) out.push({ key: `${t.id}|snooze|${t.snooze}`, at: t.snooze });
  return out;
}
