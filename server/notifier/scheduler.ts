/**
 * Which reminder pushes are due, given the server's tasks, lists and push
 * subscriptions. Pure logic: main.ts feeds it data and sends the results.
 *
 * Recipients follow the in-app rule (src/views/reminders.ts): an assigned task
 * reminds only its assignee; an unassigned one reminds everyone on the list.
 * Each subscription reports its device's time zone, and floating task times
 * are resolved in that zone.
 */
import type { Habit, List, Task } from '../../src/types';
import { countOn, goalOf, habitReminder } from '../../src/habits';
import { reminderTimes } from '../../src/reminders';
import { MON, fmtTime, pad } from '../../src/lib/dates';
import { when } from '../../src/lib/tz';

/** `weekStart`: the device's setting (1 Monday, 0 Sunday), for weekly habits. */
export interface PushSub { id: string; user: string; endpoint: string; p256dh: string; auth: string; tz: string; created: number; weekStart?: number }
export interface Changes { checkpoint: number; lists: List[]; tasks: Task[]; habits?: Habit[]; subs: PushSub[] }
/** `id`: the task or habit the push is about. */
export interface Due { sub: PushSub; id: string; key: string; at: number; payload: PushPayload }
/** `act`: signed token for the notification's buttons, added by the notifier when it sends. */
export interface PushPayload { title: string; body: string; tag: string; taskId: string; listId: string; habitId?: string; at: number; act?: string; goal?: number }
export interface SchedulerState { fired: Record<string, number>; floor: number }

/** Reminders later than this are dropped, like the in-app ones. */
export const LATE_MS = 6 * 36e5;
/** Fired keys are kept this long, then pruned. */
const KEEP_MS = 3 * 864e5;

export class Scheduler {
  lists = new Map<string, List>();
  tasks = new Map<string, Task>();
  habits = new Map<string, Habit>();
  subs: PushSub[] = [];
  checkpoint = 0;
  state: SchedulerState;

  /** `floor`: nothing due before it is sent, so a first start does not replay old reminders. */
  constructor(state?: Partial<SchedulerState>, now = Date.now()) {
    this.state = { fired: state?.fired || {}, floor: state?.floor || now };
  }

  apply(ch: Changes) {
    for (const l of ch.lists) l.removed ? this.lists.delete(l.id) : this.lists.set(l.id, l);
    for (const t of ch.tasks) t.removed || t.deleted || t.done ? this.tasks.delete(t.id) : this.tasks.set(t.id, t);
    for (const h of ch.habits || []) h.removed || !h.remind ? this.habits.delete(h.id) : this.habits.set(h.id, h);
    this.subs = ch.subs;
    this.checkpoint = Math.max(this.checkpoint, ch.checkpoint);
  }

  recipients(t: Task): string[] {
    const L = this.lists.get(t.listId);
    if (!L) return [];
    const people = [L.ownerId, ...Object.keys(L.members || {})];
    if (t.assignee) return people.includes(t.assignee) ? [t.assignee] : [];
    return people;
  }

  /** Reminders due at `now` that were not sent yet. Call `mark` for each one you send. */
  due(now = Date.now()): Due[] {
    const byUser = new Map<string, PushSub[]>();
    for (const s of this.subs) byUser.set(s.user, [...(byUser.get(s.user) || []), s]);
    const out: Due[] = [];
    for (const t of this.tasks.values()) {
      for (const u of this.recipients(t)) {
        for (const sub of byUser.get(u) || []) {
          for (const r of reminderTimes(t, sub.tz || undefined)) {
            if (r.at > now || now - r.at > LATE_MS) continue;
            // A device that subscribed after the reminder time already had its chance in the app.
            if (r.at < this.state.floor || r.at < sub.created) continue;
            const key = sub.id + '|' + r.key;
            if (this.state.fired[key]) continue;
            out.push({ sub, id: t.id, key, at: r.at, payload: payloadFor(t, this.lists.get(t.listId), sub.tz, r.key.includes('|snooze|'), now) });
          }
        }
      }
    }
    // Habit reminders go to the owner, for today and yesterday in each device's zone.
    for (const h of this.habits.values()) {
      for (const sub of byUser.get(h.ownerId || '') || []) {
        const today = ymdIn(now, sub.tz), yesterday = ymdIn(now - 864e5, sub.tz);
        for (const day of [yesterday, today]) {
          const r = habitReminder(h, day, sub.tz || undefined, sub.weekStart === 0 ? 0 : 1);
          if (!r || r.at > now || now - r.at > LATE_MS || r.at < this.state.floor || r.at < sub.created) continue;
          const key = sub.id + '|' + r.key;
          if (this.state.fired[key]) continue;
          const g = goalOf(h), n = countOn(h, day);
          out.push({ sub, id: h.id, key, at: r.at, payload: { title: h.name, body: g > 1 ? `${n}/${g}${h.unit ? ' ' + h.unit : ''} today` : 'Not done yet today', tag: 'habit-' + h.id, taskId: '', listId: '', habitId: h.id, at: now, goal: g } });
        }
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  mark(key: string, now = Date.now()) { this.state.fired[key] = now; }
  unmark(key: string) { delete this.state.fired[key]; }

  prune(now = Date.now()) {
    for (const k of Object.keys(this.state.fired)) if (now - this.state.fired[k]! > KEEP_MS) delete this.state.fired[k];
  }
}

/** The local date in `tz` as YYYY-MM-DD. */
export function ymdIn(ms: number, tz?: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms)) p[x.type] = x.value;
  return `${p.year}-${pad(+p.month!)}-${pad(+p.day!)}`;
}

/** Notification text. Kept short: lock screens show about two lines. */
export function payloadFor(t: Task, L: List | undefined, tz: string | undefined, snoozed: boolean, now: number): PushPayload {
  const parts: string[] = [];
  // A pinned task shows in the device's own zone.
  const w = when(t, tz || 'UTC');
  if (w.due) {
    const today = ymdIn(now, tz), tomorrow = ymdIn(now + 864e5, tz);
    const [, m, d] = w.due.split('-').map(Number);
    const day = w.due === today ? 'Today' : w.due === tomorrow ? 'Tomorrow' : `${MON[m! - 1]} ${d}`;
    parts.push(w.time ? `${day}, ${fmtTime(w.time)}` : day);
  } else if (snoozed) parts.push('Snoozed');
  if (L) parts.push(L.inbox ? 'Inbox' : L.name);
  return { title: t.title || 'Reminder', body: parts.join(' · ') || 'Reminder', tag: t.id, taskId: t.id, listId: t.listId, at: now };
}
