/**
 * Client state: the signed-in session, the local db (cached per account in
 * IndexedDB), UI state, prefs and read helpers. Views import from here.
 */
import type { ClientDb, EntityMap, EntityType, List, Session, Task, User } from './types';
import { TYPES } from './types';
import { esc, lsDel, lsGet, lsSet, ssGet, uid } from './lib/util';
import { emptyDb, markDirty, rememberAll } from './sync/merge';
import type { ServerAdapter } from './server/adapter';
import { LocalServer } from './server/local';
import { PocketBaseServer } from './server/pocketbase';
import { LocalStore } from './persist/idb';
import { dueClass, fmtDue } from './lib/dates';
import { pinnedTz, tzCity, when } from './lib/tz';
import { migrateLocalStorage } from './lib/rename';

// Before anything below reads localStorage: move keys saved under the old app name.
migrateLocalStorage();

/** `VITE_BACKEND=pocketbase` uses the real server on this origin; anything else uses the in-browser mock. */
export const backend: 'pocketbase' | 'local' = import.meta.env.VITE_BACKEND === 'pocketbase' ? 'pocketbase' : 'local';
export const server: ServerAdapter = backend === 'pocketbase' ? new PocketBaseServer(location.origin) : new LocalServer();

export const SESSION_KEY = 'xairos.session';
export const COLORS = ['71,114,250', '225,62,57', '250,168,12', '52,178,107', '155,89,219', '0,170,200', '240,110,170', '120,120,130'];

// Session is per tab (sessionStorage) so two accounts can run side by side; localStorage remembers the last login.
export let session: Session | null = ssGet<Session>(SESSION_KEY) || lsGet<Session>(SESSION_KEY);
export function setSession(s: Session | null) { session = s; }
export function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  lsSet(SESSION_KEY, session);
}
/** The signed-in session. Only call while signed in. */
export const sess = (): Session => session!;

/** The local db. Only valid while signed in. */
export let S: ClientDb = null as unknown as ClientDb;
export const hasDb = () => S !== null;
export function clearDb() { S = null as unknown as ClientDb; }

export interface Prefs {
  /** Light or dark: follow the system, or fixed. */
  theme: 'system' | 'light' | 'dark';
  /** Theme family: Classic or Quiet Sails. */
  family?: 'classic' | 'sails';
  kanban: boolean; closed: Record<string, boolean>; sideClosed: Record<string, boolean>;
  /** 1 = weeks start Monday, 0 = Sunday. */
  weekStart: number;
  calView: 'month' | 'week' | 'day';
  /** Board (true) or list view, per sidebar key. Unset: list. (`kanban` is the old global switch, no longer read.) */
  boards?: Record<string, boolean>;
  /** Pomo lengths; see src/focus.ts. Per device. */
  focus?: import('./focus').FocusSettings;
}
export const prefs: Prefs = Object.assign({ theme: 'system', kanban: false, closed: {}, sideClosed: {}, weekStart: 1, calView: 'month' }, lsGet('xairos.prefs') || {});
export const savePrefs = () => lsSet('xairos.prefs', prefs);

export type Route = 'tasks' | 'calendar' | 'matrix' | 'focus' | 'habits' | 'search';
export const ui = {
  route: 'tasks' as Route, listKey: 'today', sel: null as string | null, query: '',
  sideOpen: false, pending: false,
  /** The day the calendar shows (its month, week or day). null = today. */
  calDate: null as Date | null,
  /** The habit whose detail page is open (#/habits/<id>), and the year its heatmap shows (null = this year). */
  habit: null as string | null, habitYear: null as number | null,
};

let local: LocalStore | null = null;

/** Open this account's IndexedDB and load it into S. Moves an old localStorage cache over once. */
export async function loadLocal() {
  const userId = sess().user.id;
  local?.close();
  local = await LocalStore.open(userId);
  const legacyKey = 'xairos.data.' + userId, legacy = lsGet<ClientDb>(legacyKey);
  if (legacy && await local.isEmpty()) {
    const db = Object.assign(emptyDb(), legacy);
    TYPES.forEach(t => (db.dirty[t] = db.dirty[t] || {}));
    await local.save(db);
  }
  if (legacy) lsDel(legacyKey);
  S = await local.load();
  rememberAll(S);
  // Ask the browser not to evict this data under storage pressure (Safari is strict).
  navigator.storage?.persist?.().catch(() => {});
}

let saveT: ReturnType<typeof setTimeout> | undefined;
/** Persist S soon. Edits within 50 ms are batched into one transaction. */
export function saveLocal() {
  clearTimeout(saveT);
  const store = local;
  saveT = setTimeout(() => { if (store === local && S) store!.save(S); }, 50);
}
/** Persist S now (page hidden or closing). */
export function flushLocal() {
  clearTimeout(saveT);
  if (local && S) return local.save(S);
}
/** Close the local db; with `erase`, delete this account's data from the device. */
export async function closeLocal(erase: boolean) {
  await flushLocal();
  const store = local; local = null;
  store?.close();
  if (erase && store) await LocalStore.destroy(store.userId);
}

// The sync engine registers itself here, so the store does not import it.
let scheduleSyncFn: (ms?: number) => void = () => {};
export const onLocalChange = (fn: (ms?: number) => void) => { scheduleSyncFn = fn; };

/** Write an entity locally, mark it dirty and schedule a sync. */
export function upd<K extends EntityType>(type: K, obj: EntityMap[K]) {
  markDirty(S, type, obj);
  saveLocal(); scheduleSyncFn();
}
export const touch = (t: Task) => upd('tasks', t);

/* ---------- accessors ---------- */
export const me = () => sess().user.id;
export const inboxId = () => 'inbox-' + me();
export const allTasks = () => Object.values(S.tasks).filter(t => !t.removed);
export const live = () => allTasks().filter(t => !t.deleted && (S.lists[t.listId] || t.listId === inboxId()));
export const userLists = () => Object.values(S.lists).filter(l => !l.removed && !l.inbox)
  .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
export const listById = (id: string): List | undefined => S.lists[id];
export const listName = (id: string) => (id === inboxId() || S.lists[id]?.inbox) ? 'Inbox' : (S.lists[id]?.name || 'Inbox');
/**
 * Quiet Sails shows the eight preset colours as muted versions (rye, brick,
 * ochre, moss, plum, teal, rose, grit). Stored colours never change.
 */
const SAILS_COLORS = ['62,105,117', '178,58,44', '168,120,31', '78,107,74', '122,79,110', '140,90,43', '176,110,100', '140,133,122'];
export const tc = (rgb: string): string => {
  const i = prefs.family === 'sails' ? COLORS.indexOf(rgb) : -1;
  return i < 0 ? rgb : SAILS_COLORS[i]!;
};
export const listColor = (id: string) => tc(S.lists[id]?.color || COLORS[7]!);
export const isShared = (l: List | undefined) => !!l && (Object.keys(l.members || {}).length > 0 || l.ownerId !== me());
export const canWrite = (listId: string) => {
  const l = S.lists[listId];
  if (!l) return listId === inboxId();
  return l.ownerId === me() || (l.members || {})[me()] === 'edit';
};
export const isOwner = (listId: string) => S.lists[listId]?.ownerId === me();
export const allTags = () => [...new Set(live().flatMap(t => t.tags || []))].sort();
export const ord = (t: Task) => t.order ?? t.created;
export const peopleOf = (l: List | undefined) => (l ? [l.ownerId, ...Object.keys(l.members || {})] : [me()]);

export function avatarColor(id: string | undefined) { let x = 0; for (const c of String(id)) x = (x * 33 + c.charCodeAt(0)) >>> 0; return tc(COLORS[x % 7]!); }
export function initials(name: string | undefined) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
}
export const avatarHtml = (u: Partial<User> | undefined, size?: number) =>
  `<span class="avatar" style="background:rgb(${avatarColor(u?.id)})${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * .45)}px` : ''}" title="${esc(u?.name || '')}">${esc(initials(u?.name))}</span>`;
export const userName = (id: string | null | undefined) => id === me() ? 'You' : (S.users[id!]?.name || 'Someone');
/** A user record for display, falling back to the session user or a placeholder. */
export const userOf = (id: string, fallbackName = '?'): User =>
  S.users[id] || (id === me() ? sess().user : { id, name: fallbackName, email: '' });

export function sortTasks(a: Task[]) { return a.sort((x, y) => (dueOf(x) || '9999').localeCompare(dueOf(y) || '9999') || ord(x) - ord(y)); }

/** The task's date on this device (a pinned time can land on another day here). */
export const dueOf = (t: Task) => when(t).due;
/** "Today, 3:00 PM", in this device's zone. Pinned tasks add their own zone's time: "(15:00 Berlin)". */
export function dueText(t: Task, withPin = false): string {
  const w = when(t), s = fmtDue(w.due, w.time), tz = pinnedTz(t);
  return withPin && tz && (w.due !== t.due || w.time !== t.time) ? `${s} (${t.time} ${tzCity(tz)})` : s;
}
export const dueCls = (t: Task) => dueClass({ due: dueOf(t), done: t.done });

export function newTask(o: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: uid(), title: '', desc: '', listId: inboxId(), due: null, time: null, priority: 0, tags: [], items: [],
    done: false, doneAt: null, deleted: false, created: now, order: now, repeat: null, reminders: [], snooze: null,
    assignee: null, createdBy: me(), ...o,
  };
}
