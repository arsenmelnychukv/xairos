/**
 * Trash retention: a task in Trash is deleted for good after 30 days.
 * The servers run this (LocalServer on pull, PocketBase from a daily cron in
 * server/pb_hooks, which keeps a plain-JS copy of the rule).
 */
import type { Task } from '../types';
import { stampOf } from '../sync/fields';

export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 864e5;

/** When the task went to Trash: the stamp on its `deleted` field (0 if unknown). */
export const trashedAt = (t: Task): number => stampOf(t, 'deleted');

/** In Trash for longer than the retention. A task with no stamp is kept: we cannot tell its age. */
export function trashExpired(t: Task, now = Date.now()): boolean {
  const at = trashedAt(t);
  return !!t.deleted && !t.removed && at > 0 && now - at > TRASH_MS;
}

/** Whole days until a task in Trash is deleted for good. */
export const trashDaysLeft = (t: Task, now = Date.now()): number =>
  Math.max(0, Math.ceil((trashedAt(t) + TRASH_MS - now) / 864e5));
