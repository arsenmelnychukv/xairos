/**
 * Task time-zone model. Times are floating by default: 9:00 stays
 * 9:00 wherever you are. A task can pin a zone (`tz`): "15:00 Berlin time"
 * then shows at the matching local hour elsewhere. `due`/`time` are stored as
 * the wall clock in the pinned zone; `when()` gives them in another zone.
 */
import type { Task, Ymd } from '../types';
import { pad, tzOffset, ymd, zonedEpoch } from './dates';

export const deviceTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export interface Wall { due: Ymd | null; time: string | null }

/** Wall-clock date and time of instant `ms` in `tz` (this device's zone when omitted). */
export function wallAt(ms: number, tz?: string): { due: Ymd; time: string } {
  if (!tz) { const d = new Date(ms); return { due: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
  const d = new Date(ms + tzOffset(ms, tz));
  return { due: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** A pinned zone only matters when the task has a date and a time. */
export const pinnedTz = (t: Pick<Task, 'due' | 'time' | 'tz'>): string | null => (t.tz && t.due && t.time ? t.tz : null);

/** Convert a wall time from zone `from` to zone `to` (undefined = this device). */
export function convertWall(due: Ymd, time: string, from: string | undefined, to: string | undefined): { due: Ymd; time: string } {
  if (from === to) return { due, time };
  const [h, m] = time.split(':').map(Number);
  return wallAt(zonedEpoch(due, h!, m!, from), to);
}

/**
 * The task's date and time as seen in `viewTz` (this device when omitted).
 * Floating tasks are unchanged; pinned ones convert.
 */
export function when(t: Pick<Task, 'due' | 'time' | 'tz'>, viewTz?: string): Wall {
  const tz = pinnedTz(t);
  if (!tz) return { due: t.due, time: t.time };
  if (tz === (viewTz || deviceTz())) return { due: t.due, time: t.time };
  return convertWall(t.due!, t.time!, tz, viewTz);
}

/** Set a task's date and time from a wall time in this device's zone, keeping its pin. */
export function setLocalWhen(t: Task, due: Ymd | null, time: string | null) {
  const tz = t.tz && due && time ? t.tz : null;
  if (tz && tz !== deviceTz()) ({ due, time } = convertWall(due!, time!, undefined, tz));
  t.due = due; t.time = due ? time : null;
}

/** "Berlin", "New York": the city part of an IANA zone. */
export const tzCity = (tz: string): string => (tz.split('/').pop() || tz).replace(/_/g, ' ');

/** Every IANA zone this browser knows, for the picker. */
export function allZones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); }
  catch { return [deviceTz(), 'UTC']; }
}
