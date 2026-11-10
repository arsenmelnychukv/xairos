/** Shared domain types. Dates are local `YYYY-MM-DD` strings, times `HH:MM` (floating). */

export type Ymd = string;
export type Priority = 0 | 1 | 3 | 5;
export type Role = 'edit' | 'view';

export interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  /** Weekdays 0 (Sun) to 6 (Sat), for weekly rules. */
  byDay?: number[];
  /** Day of month to keep when months are shorter. */
  dom?: number;
  from?: 'due' | 'completion';
  until?: Ymd | null;
  count?: number | null;
  /** Occurrences completed so far. */
  done?: number;
}

export interface ChecklistItem { id: string; title: string; done: boolean }

/** Every synced entity carries these. */
export interface Entity {
  id: string;
  /** Last change of the entity (max of fm). */
  mtime?: number;
  /** Per-field change times: field path -> ms. See src/sync/fields.ts. */
  fm?: Record<string, number>;
  seq?: number;
  removed?: boolean;
}

export interface Task extends Entity {
  title: string;
  desc: string;
  listId: string;
  prevListId?: string | null;
  due: Ymd | null;
  time: string | null;
  priority: number;
  tags: string[];
  items: ChecklistItem[];
  done: boolean;
  doneAt: number | null;
  deleted: boolean;
  created: number;
  order: number;
  repeat: RepeatRule | null;
  repeatOf?: string;
  /** Minutes before the due time. */
  reminders: number[];
  /** Length in minutes when shown on the calendar's hour grid (time block). Unset: 30. */
  dur?: number | null;
  /**
   * Pinned IANA zone ("Europe/Berlin"): `due`/`time` are wall time there and
   * convert for other zones. Unset (floating): the same wall time everywhere.
   * See src/lib/tz.ts.
   */
  tz?: string | null;
  snooze: number | null;
  assignee: string | null;
  createdBy: string;
  /** Kanban column id in its list's `columns`. Unset or unknown: the first column. */
  col?: string | null;
}

export interface List extends Entity {
  name: string;
  color: string;
  ownerId: string;
  members: Record<string, Role>;
  inbox?: boolean;
  order: number;
  created?: number;
  /** The list's own kanban columns, in order. Unset: the default columns. */
  columns?: KanbanColumn[] | null;
}

export interface KanbanColumn { id: string; name: string }

export interface Habit extends Entity {
  name: string;
  color: string;
  /**
   * Check-ins per day. `true` (old data, or goal 1) means done; a number is
   * how many times that day (e.g. glasses of water). Merged per day.
   */
  checks: Record<Ymd, true | number>;
  /** Times per day that count as done. Unset: 1. */
  goal?: number | null;
  /** What `goal` counts, e.g. "glasses". */
  unit?: string | null;
  /** "3 times a week": days needed per week. Unset: every day. */
  perWeek?: number | null;
  /**
   * How a weekly habit's streak counts. 'weeks' (unset): one per week that met
   * the target. 'days': every done day, as long as its week met (or can still
   * meet) the target. Ignored for every-day habits.
   */
  streakIn?: 'weeks' | 'days' | null;
  /** Daily reminder "HH:MM" (floating), sent while the habit is not done yet. */
  remind?: string | null;
  order: number;
  created: number;
  ownerId?: string;
}

export interface FocusRecord extends Entity {
  start: number;
  mins: number;
  /** What the session was for (the task title when linked). */
  task: string;
  /** The linked task, when the session was started on one. */
  taskId?: string | null;
  ownerId?: string;
}

export interface User { id: string; name: string; email: string }
export interface Session { token: string; user: User }

export const TYPES = ['lists', 'tasks', 'habits', 'focus'] as const;
export type EntityType = (typeof TYPES)[number];
export interface EntityMap { lists: List; tasks: Task; habits: Habit; focus: FocusRecord }

/** Dirty entities pushed to the server. */
export type Changes = { [K in EntityType]: EntityMap[K][] };

export interface PullResult extends Changes {
  checkpoint: number;
  users: User[];
  /** List ids this user lost access to. */
  revoked: string[];
}

export type SyncError = 'NO_PERMISSION' | 'STALE';
export interface PushResult { checkpoint: number; id2error: Record<string, SyncError> }

/** The client's local database for one account. */
export interface ClientDb {
  lists: Record<string, List>;
  tasks: Record<string, Task>;
  habits: Record<string, Habit>;
  focus: Record<string, FocusRecord>;
  users: Record<string, User>;
  checkpoint: number;
  /** id -> mtime at the moment it was marked dirty. */
  dirty: { [K in EntityType]: Record<string, number> };
}
