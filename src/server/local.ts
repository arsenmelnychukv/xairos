/**
 * LocalServer: a mock backend that lives in this browser's localStorage.
 * It implements the same contract a real server would (ROADMAP.md §3).
 * Every tab of this origin talks to the same "server"; BroadcastChannel
 * plays the role of the WebSocket push ("needSync").
 */
import type { Changes, Entity, EntityType, FocusRecord, Habit, List, PullResult, PushResult, Session, SyncError, Task, User } from '../types';
import type { ServerAdapter } from './adapter';
import { apiErr, clone, lsGet, lsSet, randHex, sleep, uid } from '../lib/util';
import { mergeEntity, seedStamps } from '../sync/fields';
import { trashExpired } from '../lib/trash';

export const SRV_KEY = 'xairos.server.v1';
const CLIENT_ID = uid();

interface StoredUser extends User { salt: string; hash: string; created: number }
type Owned<T> = T & { ownerId: string; seq: number };
interface ServerDb {
  seq: number;
  users: Record<string, StoredUser>;
  sessions: Record<string, string>;
  lists: Record<string, List & { seq: number }>;
  tasks: Record<string, Task & { seq: number }>;
  habits: Record<string, Owned<Habit>>;
  focus: Record<string, Owned<FocusRecord>>;
  revoked: Record<string, { listId: string; seq: number }[]>;
}

async function pbkdf2(pw: string, saltHex: string): Promise<string> {
  if (!crypto.subtle) { let x = 0; for (const c of pw + saltHex) x = (x * 31 + c.charCodeAt(0)) | 0; return 'weak:' + x; }
  const salt = new Uint8Array(saltHex.match(/../g)!.map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Server-side change to some fields, stamped so merges see it as the newest. */
function stampServer(type: EntityType, e: Entity, fields: string[]) {
  const at = Math.max(Date.now(), (e.mtime || 0) + 1);
  e.fm = { ...(e.fm || seedStamps(type, e)) };
  e.mtime = at;
  for (const f of fields) e.fm[f] = at;
}
const pubUser = (u: StoredUser | undefined): User | null => (u ? { id: u.id, name: u.name, email: u.email } : null);

/**
 * The day's check-ins after a Shortcuts action. "done": up to the goal (no
 * change once met). "+1": one more, past the goal too. "undo": one fewer (a
 * goal of 1 clears the day). -1: unknown action. Keep in step with habitStep
 * in server/pb_hooks/xairos_lib.js.
 */
function habitStep(goal: number, n: number, action: string): number {
  if (action === 'done') return Math.max(n, goal);
  if (action === '+1') return goal === 1 ? Math.max(n, 1) : Math.min(999, n + 1);
  if (action === 'undo') return goal === 1 ? 0 : Math.max(0, n - 1);
  return -1;
}
const ymdOk = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
const localToday = () => { const d = new Date(), z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

export interface HabitCheckResult { id: string; name: string; day: string; count: number; goal: number; done: boolean; message: string }

export class LocalServer implements ServerAdapter {
  private chan: BroadcastChannel | null;
  /** Simulated network latency in ms (0 in tests). */
  constructor(private latency = 80) {
    this.chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('xairos-push') : null;
  }
  private db(): ServerDb {
    return lsGet<ServerDb>(SRV_KEY) || { seq: 0, users: {}, sessions: {}, lists: {}, tasks: {}, habits: {}, focus: {}, revoked: {} };
  }
  private save(d: ServerDb) { lsSet(SRV_KEY, d); }
  private async lat() { if (this.latency) await sleep(this.latency + Math.random() * this.latency); }
  private auth(d: ServerDb, token: string): string {
    const u = d.sessions[token];
    if (!u || !d.users[u]) throw apiErr(401, 'Session expired. Please sign in again.');
    return u;
  }
  private canRead(l: List | undefined, me: string) { return !!l && !l.removed && (l.ownerId === me || !!(l.members || {})[me]); }
  private canWrite(l: List | undefined, me: string) { return !!l && !l.removed && (l.ownerId === me || (l.members || {})[me] === 'edit'); }
  private people(l: List | undefined): string[] { return l ? [l.ownerId, ...Object.keys(l.members || {})] : []; }
  private notify(users: Iterable<string>) { this.chan?.postMessage({ type: 'needSync', users: [...users], origin: CLIENT_ID }); }

  async signup({ name, email, password }: { name: string; email: string; password: string }): Promise<Session> {
    await this.lat();
    email = String(email || '').trim().toLowerCase(); name = String(name || '').trim();
    if (!name) throw apiErr(400, 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw apiErr(400, 'Please enter a valid email.');
    if (String(password || '').length < 8) throw apiErr(400, 'Password must be at least 8 characters.');
    const salt = randHex(16), hash = await pbkdf2(password, salt);
    const d = this.db();
    if (Object.values(d.users).some(u => u.email === email)) throw apiErr(409, 'An account with this email already exists.');
    const id = uid(), now = Date.now();
    d.users[id] = { id, name, email, salt, hash, created: now };
    const inbox = 'inbox-' + id;
    d.lists[inbox] = { id: inbox, name: 'Inbox', color: '120,120,130', ownerId: id, members: {}, inbox: true, order: 0, mtime: now, seq: ++d.seq };
    const token = randHex(24); d.sessions[token] = id;
    this.save(d);
    return { token, user: pubUser(d.users[id])! };
  }

  async login({ email, password }: { email: string; password: string }): Promise<Session> {
    await this.lat();
    email = String(email || '').trim().toLowerCase();
    const u = Object.values(this.db().users).find(x => x.email === email);
    const hash = u ? await pbkdf2(password, u.salt) : await pbkdf2(password, randHex(16));
    if (!u || hash !== u.hash) throw apiErr(401, 'Wrong email or password.');
    const d = this.db(); const token = randHex(24); d.sessions[token] = u.id; this.save(d);
    return { token, user: pubUser(u)! };
  }

  async logout(token: string) { const d = this.db(); delete d.sessions[token]; this.save(d); }

  async findUser(token: string, email: string) {
    await this.lat(); const d = this.db(); this.auth(d, token);
    return pubUser(Object.values(d.users).find(u => u.email === String(email).trim().toLowerCase()));
  }

  async leaveList(token: string, listId: string) {
    await this.lat(); const d = this.db(); const me = this.auth(d, token);
    const l = d.lists[listId];
    if (!l || !(l.members || {})[me]) throw apiErr(404, 'Not a member of this list.');
    const people = this.people(l);
    delete l.members[me]; stampServer('lists', l, ['members']); l.seq = ++d.seq;
    (d.revoked[me] = d.revoked[me] || []).push({ listId, seq: l.seq });
    this.save(d); this.notify(people);
  }

  async deleteAccount(token: string, password: string) {
    await this.lat(); const d0 = this.db(); const me = this.auth(d0, token);
    const u = d0.users[me]!;
    if (await pbkdf2(password, u.salt) !== u.hash) throw apiErr(401, 'Wrong password.');
    const d = this.db(), affected = new Set<string>(), now = Date.now();
    for (const l of Object.values(d.lists)) {
      const ppl = this.people(l);
      if (!ppl.includes(me)) continue;
      ppl.forEach(x => affected.add(x));
      const tasks = Object.values(d.tasks).filter(t => t.listId === l.id);
      if (l.ownerId === me) {
        const seq = ++d.seq;
        if (!l.removed) for (const x of ppl) if (x !== me) (d.revoked[x] = d.revoked[x] || []).push({ listId: l.id, seq });
        // Tombstones keep only ids, so no content outlives the account.
        for (const t of tasks) d.tasks[t.id] = { id: t.id, listId: l.id, removed: true, mtime: now, seq: ++d.seq } as Task & { seq: number };
        d.lists[l.id] = { id: l.id, ownerId: me, members: {}, removed: true, mtime: now, seq } as unknown as List & { seq: number };
      } else if (!l.removed && l.members[me]) {
        delete l.members[me]; stampServer('lists', l, ['members']); l.seq = ++d.seq;
        for (const t of tasks) if (t.assignee === me) { t.assignee = null; stampServer('tasks', t, ['assignee']); t.seq = ++d.seq; }
      }
    }
    for (const type of ['habits', 'focus'] as const) for (const [id, x] of Object.entries(d[type])) if (x.ownerId === me) delete d[type][id];
    for (const [tok, uid2] of Object.entries(d.sessions)) if (uid2 === me) delete d.sessions[tok];
    delete d.revoked[me]; delete d.users[me];
    this.save(d); affected.delete(me); this.notify(affected);
  }

  /** Delete for good the tasks in Trash past the retention (src/lib/trash.ts). Returns how many. */
  purgeTrash(now = Date.now()): number {
    const d = this.db(), affected = new Set<string>();
    let n = 0;
    for (const t of Object.values(d.tasks)) if (trashExpired(t, now)) {
      t.removed = true; stampServer('tasks', t, ['removed']); t.seq = ++d.seq; n++;
      this.people(d.lists[t.listId]).forEach(u => affected.add(u));
    }
    if (n) { this.save(d); this.notify(affected); }
    return n;
  }

  async pull(token: string, cp: number): Promise<PullResult> {
    await this.lat(); this.purgeTrash(); const d = this.db(); const me = this.auth(d, token);
    const vis = new Set(Object.values(d.lists).filter(l => this.canRead(l, me)).map(l => l.id));
    const out: PullResult = { checkpoint: d.seq, lists: [], tasks: [], habits: [], focus: [], users: [], revoked: [] };
    for (const l of Object.values(d.lists)) {
      if (l.seq > cp && (vis.has(l.id) || (l.removed && (l.ownerId === me || (l.members || {})[me])))) out.lists.push(l);
    }
    for (const t of Object.values(d.tasks)) if (t.seq > cp) {
      if (vis.has(t.listId)) out.tasks.push(t);
      else if (t.prevListId && vis.has(t.prevListId)) out.tasks.push({ id: t.id, removed: true } as Task);
    }
    for (const x of Object.values(d.habits)) if (x.ownerId === me && x.seq > cp) out.habits.push(x);
    for (const x of Object.values(d.focus)) if (x.ownerId === me && x.seq > cp) out.focus.push(x);
    out.revoked = (d.revoked[me] || []).filter(r => r.seq > cp).map(r => r.listId);
    const people = new Set([me]);
    for (const id of vis) this.people(d.lists[id]).forEach(u => people.add(u));
    out.users = [...people].map(u => pubUser(d.users[u])).filter((u): u is User => !!u);
    return clone(out);
  }

  async push(token: string, ch: Partial<Changes>): Promise<PushResult> {
    await this.lat(); const d = this.db(); const me = this.auth(d, token);
    const id2error: Record<string, SyncError> = {}, affected = new Set([me]);
    for (const inc of ch.lists || []) {
      const ex = d.lists[inc.id];
      if (ex && !this.canWrite(ex, me)) { id2error[inc.id] = 'NO_PERMISSION'; continue; }
      // Per-field merge with the stored copy (no STALE rejection).
      const l = ex ? mergeEntity('lists', ex, inc) : inc;
      const isOwner = !ex || ex.ownerId === me;
      if (l.removed && !ex?.removed && !isOwner) { id2error[inc.id] = 'NO_PERMISSION'; continue; }
      let mem: Record<string, string> = isOwner ? { ...(l.members || {}) } : { ...(ex!.members || {}) };
      const owner = ex ? ex.ownerId : me;
      if (ex?.inbox) mem = {};
      for (const u of Object.keys(mem)) if (!d.users[u] || u === owner || !['edit', 'view'].includes(mem[u]!)) delete mem[u];
      const seq = ++d.seq;
      const next = { ...l, ownerId: owner, members: mem as List['members'], inbox: !!ex?.inbox, seq };
      const before = new Set(this.people(ex)), after = new Set(this.people(next));
      for (const u of before) if (!after.has(u)) (d.revoked[u] = d.revoked[u] || []).push({ listId: l.id, seq });
      const added = [...after].some(u => !before.has(u));
      for (const t of Object.values(d.tasks)) if (t.listId === l.id) {
        if (next.removed && !t.removed) { t.removed = true; stampServer('tasks', t, ['removed']); }
        if (next.removed || (added && ex)) t.seq = ++d.seq;
      }
      d.lists[l.id] = next;
      before.forEach(u => affected.add(u)); after.forEach(u => affected.add(u));
    }
    for (const inc of ch.tasks || []) {
      const ex = d.tasks[inc.id];
      const t = ex ? mergeEntity('tasks', ex, inc) : inc;
      const L = d.lists[t.listId];
      if (!this.canWrite(L, me) || (ex && !this.canWrite(d.lists[ex.listId], me))) { id2error[inc.id] = 'NO_PERMISSION'; continue; }
      const prevListId = ex && ex.listId !== t.listId ? ex.listId : (ex?.prevListId || null);
      d.tasks[t.id] = { ...t, prevListId, seq: ++d.seq };
      this.people(L).forEach(u => affected.add(u));
      if (ex) this.people(d.lists[ex.listId]).forEach(u => affected.add(u));
    }
    for (const type of ['habits', 'focus'] as const) {
      const table = d[type] as Record<string, Owned<Habit | FocusRecord>>;
      for (const inc of (ch[type] || []) as (Habit | FocusRecord)[]) {
        const ex = table[inc.id];
        if (ex && ex.ownerId !== me) { id2error[inc.id] = 'NO_PERMISSION'; continue; }
        const x = ex ? mergeEntity(type, ex as Habit | FocusRecord, inc) : inc;
        table[inc.id] = { ...x, ownerId: me, seq: ++d.seq };
      }
    }
    this.save(d); this.notify(affected);
    return { id2error, checkpoint: d.seq };
  }

  /**
   * Habit check-in for Shortcuts, as the PocketBase routes GET /api/xairos/habits
   * and POST /api/xairos/habits/:id/check do it (there with an API token; this
   * mock has none, so it takes the session token). Contract-tested on both.
   */
  async habitList(token: string): Promise<{ id: string; name: string }[]> {
    await this.lat(); const d = this.db(); const me = this.auth(d, token);
    return Object.values(d.habits).filter(h => h.ownerId === me && !h.removed)
      .sort((a, b) => (a.order || 0) - (b.order || 0)).map(h => ({ id: h.id, name: h.name }));
  }

  async habitCheck(token: string, id: string, body: unknown): Promise<HabitCheckResult> {
    await this.lat(); const d = this.db(); const me = this.auth(d, token);
    const b = (body || {}) as { action?: unknown; today?: unknown };
    const action = String(b.action ?? '');
    if (b.today !== undefined && b.today !== null && !ymdOk(b.today)) throw apiErr(400, 'Send today as YYYY-MM-DD.');
    const today = ymdOk(b.today) ? String(b.today) : localToday();
    const h = d.habits[id];
    if (!h || h.removed || h.ownerId !== me) throw apiErr(404, 'No such habit.');
    const g = Math.max(1, Math.floor(h.goal || 1)), v = (h.checks || {})[today];
    const n = v === true ? g : typeof v === 'number' ? v : 0;
    const next = habitStep(g, n, action);
    if (next < 0) throw apiErr(400, 'Unknown action. Use done, +1 or undo.');
    const res = { id: h.id, name: h.name, day: today, count: next, goal: g, done: next >= g };
    if (next === n) return { ...res, message: action === 'undo' ? 'Nothing to undo.' : 'Already done today.' };
    const x = clone(h);
    x.checks = { ...(x.checks || {}) };
    if (!next) delete x.checks[today]; else x.checks[today] = g === 1 && next === 1 ? true : next;
    stampServer('habits', x, ['checks.' + today]);
    // The same merge path as a device's push.
    await this.push(token, { habits: [x] });
    const message = action === 'undo' && !next ? 'Undone.' : g === 1 || (action === 'done' && next === g) ? 'Done.' : `${next}/${g} today.`;
    return { ...res, message };
  }

  subscribe(token: string, on: { needSync(): void; sessionGone(): void }) {
    const me = this.db().sessions[token];
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'needSync' && me && e.data.users.includes(me)) on.needSync(); };
    const onStorage = (e: StorageEvent) => { if (e.key === SRV_KEY && !this.db().sessions[token]) on.sessionGone(); };
    this.chan?.addEventListener('message', onMsg);
    addEventListener('storage', onStorage);
    return () => { this.chan?.removeEventListener('message', onMsg); removeEventListener('storage', onStorage); };
  }
}
