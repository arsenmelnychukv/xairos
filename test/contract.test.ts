/**
 * The backend contract (ROADMAP.md §3), run against every ServerAdapter:
 * the in-browser LocalServer and the real PocketBase hooks.
 */
import { beforeEach, describe, expect, inject, it } from 'vitest';
import { LocalServer } from '../src/server/local';
import { PocketBaseServer } from '../src/server/pocketbase';
import type { ServerAdapter } from '../src/server/adapter';
import type { List, Session, Task } from '../src/types';
import { randHex } from '../src/lib/util';
import { applyPull, clearSent, collectChanges, emptyDb, markDirty } from '../src/sync/merge';

// Minimal in-memory localStorage for LocalServer in Node.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, String(v)), removeItem: k => void mem.delete(k),
  clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
} as Storage;

const pbUrl = inject('pbUrl');
const pushEnv = inject('pushEnv');
/** Each backend, and how to run its Trash cleanup as if it were `now`. */
type Purge = (srv: ServerAdapter, now: number) => Promise<number>;
/**
 * Habit check-in for Shortcuts (N5), as `{status, body}`. PocketBase: the HTTP
 * routes with an API token made for the session. LocalServer has no API
 * tokens, so it runs the same logic with the session token.
 */
type HabitCall = (srv: ServerAdapter, s: Session, id?: string, body?: unknown) => Promise<{ status: number; body: any }>;
const localHabits: HabitCall = async (srv, s, id, body) => {
  const l = srv as LocalServer;
  try { return { status: 200, body: id === undefined ? await l.habitList(s.token) : await l.habitCheck(s.token, id, body) }; }
  catch (e) { return { status: (e as { status: number }).status, body: null }; }
};
const apiTokens = new Map<string, string>();
const pbHabits: HabitCall = async (srv, s, id, body) => {
  let t = apiTokens.get(s.token);
  if (!t) { t = (await srv.tokens!.create(s.token, 'test')).token; apiTokens.set(s.token, t); }
  const r = await fetch(pbUrl + '/api/xairos/habits' + (id === undefined ? '' : `/${encodeURIComponent(id)}/check`), {
    method: id === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
    body: id === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
};
const backends: [string, () => ServerAdapter, Purge, HabitCall][] = [['LocalServer', () => new LocalServer(0), async (srv, now) => (srv as LocalServer).purgeTrash(now), localHabits]];
if (pbUrl) backends.push(['PocketBase', () => new PocketBaseServer(pbUrl), async (_srv, now) => {
  const r = await fetch(pbUrl + '/api/xairos/internal/purge-trash', { method: 'POST', headers: { 'X-xairos-Secret': pushEnv.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ now }) });
  return (await r.json()).purged;
}, pbHabits]);

const pw = randHex(12);
const task = (id: string, listId: string, mtime: number, o: Partial<Task> = {}): Task => ({
  id, title: id, desc: '', listId, due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: '', mtime, ...o,
});

describe.each(backends)('%s contract', (_name, make, purge, habitApi) => {
  const srv = make();
  // Entity ids are global on a real server, so every test gets its own.
  let a: Session, b: Session, ids: (s: string) => string, emailA: string;
  beforeEach(async () => {
    mem.clear();
    const run = randHex(4);
    ids = s => `${s}-${run}`;
    emailA = `ann-${run}@xairos.test`;
    a = await srv.signup({ name: 'Ann', email: emailA, password: pw });
    b = await srv.signup({ name: 'Bob', email: `bob-${run}@xairos.test`, password: pw });
  });

  it('signup creates an inbox; login checks the password', async () => {
    const p = await srv.pull(a.token, 0);
    expect(p.lists.map(l => l.id)).toEqual(['inbox-' + a.user.id]);
    expect(p.users.map(u => u.id)).toEqual([a.user.id]);
    await expect(srv.login({ email: emailA, password: 'wrong-password' })).rejects.toMatchObject({ status: 401 });
    await expect(srv.signup({ name: 'X', email: emailA, password: pw })).rejects.toMatchObject({ status: 409 });
    await expect(srv.signup({ name: 'X', email: 'bad', password: pw })).rejects.toMatchObject({ status: 400 });
    expect((await srv.login({ email: emailA.toUpperCase(), password: pw })).user.id).toBe(a.user.id);
  });

  it('rejects requests without a valid token', async () => {
    await expect(srv.pull('not-a-token', 0)).rejects.toMatchObject({ status: 401 });
  });

  it('pull is incremental from the checkpoint', async () => {
    const cp = (await srv.pull(a.token, 0)).checkpoint;
    const t1 = ids('t1');
    const r = await srv.push(a.token, { tasks: [task(t1, 'inbox-' + a.user.id, 10)] });
    expect(r.id2error).toEqual({});
    expect(r.checkpoint).toBeGreaterThan(cp);
    const p = await srv.pull(a.token, cp);
    expect(p.tasks.map(t => t.id)).toEqual([t1]);
    expect(p.tasks[0]!.seq).toBeGreaterThan(cp);
    expect(p.lists).toEqual([]);
    expect((await srv.pull(a.token, p.checkpoint)).tasks).toEqual([]);
  });

  it('merges an older push per field instead of rejecting it', async () => {
    const inbox = 'inbox-' + a.user.id, t1 = ids('t1');
    await srv.push(a.token, { tasks: [task(t1, inbox, 20, { fm: { title: 20, desc: 5 } })] });
    const r = await srv.push(a.token, { tasks: [task(t1, inbox, 15, { title: 'older', desc: 'newer desc', fm: { title: 10, desc: 15 } })] });
    expect(r.id2error).toEqual({});
    const t = (await srv.pull(a.token, 0)).tasks.find(x => x.id === t1)!;
    expect(t.title).toBe(t1);
    expect(t.desc).toBe('newer desc');
    expect(t.fm).toMatchObject({ title: 20, desc: 15 });
  });

  it('rejects writes to lists you cannot see', async () => {
    const inbox = 'inbox-' + a.user.id;
    expect((await srv.push(b.token, { tasks: [task(ids('t2'), inbox, 10)] })).id2error).toEqual({ [ids('t2')]: 'NO_PERMISSION' });
    expect((await srv.pull(b.token, 0)).tasks).toEqual([]);
  });

  it('two offline devices editing different fields both win', async () => {
    const inbox = 'inbox-' + a.user.id, t1 = ids('t1');
    // Both devices synced this task, then went offline.
    const laptop = emptyDb(), phone = emptyDb();
    markDirty(laptop, 'tasks', task(t1, inbox, 0), 1000);
    await srv.push(a.token, collectChanges(laptop).changes);
    const p0 = await srv.pull(a.token, 0);
    for (const db of [laptop, phone]) { db.dirty.tasks = {}; applyPull(db, structuredClone(p0)); }

    const onLaptop = laptop.tasks[t1]!; onLaptop.title = 'Renamed on laptop'; markDirty(laptop, 'tasks', onLaptop, 2000);
    const onPhone = phone.tasks[t1]!; onPhone.items = [{ id: 'i1', title: 'Milk', done: true }]; markDirty(phone, 'tasks', onPhone, 2100);

    for (const db of [phone, laptop]) {
      const { changes, sent } = collectChanges(db);
      expect((await srv.push(a.token, changes)).id2error).toEqual({});
      clearSent(db, sent);
    }
    for (const db of [laptop, phone]) {
      applyPull(db, await srv.pull(a.token, db.checkpoint));
      expect(db.tasks[t1]).toMatchObject({ title: 'Renamed on laptop', items: [{ id: 'i1', title: 'Milk', done: true }] });
    }
  });

  it('habit check-ins from two devices both survive', async () => {
    const h1 = ids('h1');
    const h = { id: h1, name: 'Run', color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 1, fm: { name: 1 } };
    await srv.push(a.token, { habits: [{ ...h, checks: { '2026-11-04': true }, fm: { ...h.fm, 'checks.2026-11-04': 10 }, mtime: 10 }] });
    await srv.push(a.token, { habits: [{ ...h, checks: { '2026-11-05': true }, fm: { ...h.fm, 'checks.2026-11-05': 11 }, mtime: 11 }] });
    const got = (await srv.pull(a.token, 0)).habits.find(x => x.id === h1)!;
    expect(got.checks).toEqual({ '2026-11-04': true, '2026-11-05': true });
  });

  it('fields an older client does not know survive its edits', async () => {
    // A newer client adds fields this build has no code for (a plain one and a
    // per-day map). An older client then renames the habit, once from a copy
    // that holds the new fields and once from a copy pulled before they existed.
    const h1 = ids('h1');
    const h = { id: h1, name: 'Run', color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 1, fm: { name: 1, color: 1, checks: 1, order: 1, created: 1 } };
    const stale = emptyDb();
    markDirty(stale, 'habits', structuredClone(h), 1000);
    await srv.push(a.token, collectChanges(stale).changes);
    stale.dirty.habits = {};
    applyPull(stale, await srv.pull(a.token, 0));

    const newer = emptyDb();
    applyPull(newer, await srv.pull(a.token, 0));
    const n = newer.habits[h1]! as typeof newer.habits[string] & Record<string, unknown>;
    n.archived = true; n.notes = { '2026-11-05': 'Rainy' };
    markDirty(newer, 'habits', n, 2000);
    await srv.push(a.token, collectChanges(newer).changes);

    const synced = emptyDb();
    applyPull(synced, await srv.pull(a.token, 0));
    const s = synced.habits[h1]!; s.name = 'Run 5k'; markDirty(synced, 'habits', s, 3000);
    await srv.push(a.token, collectChanges(synced).changes);

    const o = stale.habits[h1]!; o.color = '9,9,9'; markDirty(stale, 'habits', o, 4000);
    await srv.push(a.token, collectChanges(stale).changes);

    const got = (await srv.pull(a.token, 0)).habits.find(x => x.id === h1)! as unknown as Record<string, unknown>;
    expect(got).toMatchObject({ name: 'Run 5k', color: '9,9,9', archived: true, notes: { '2026-11-05': 'Rainy' } });
  });

  it('enforces roles on shared lists, and revokes on removal', async () => {
    const L1 = ids('L1'), t1 = ids('t1');
    const L: List = { id: L1, name: 'Shared', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'view' }, order: 1, mtime: 1 };
    await srv.push(a.token, { lists: [L], tasks: [task(t1, L1, 1)] });
    const pb = await srv.pull(b.token, 0);
    expect(pb.tasks.map(t => t.id)).toEqual([t1]);
    expect(pb.users.map(u => u.id).sort()).toEqual([a.user.id, b.user.id].sort());
    expect((await srv.push(b.token, { tasks: [task(t1, L1, 5)] })).id2error).toEqual({ [t1]: 'NO_PERMISSION' });
    expect((await srv.push(b.token, { lists: [{ ...L, removed: true, mtime: 5 }] })).id2error).toEqual({ [L1]: 'NO_PERMISSION' });

    await srv.push(a.token, { lists: [{ ...L, members: { [b.user.id]: 'edit' }, mtime: 2 }] });
    expect((await srv.push(b.token, { tasks: [task(t1, L1, 6)] })).id2error).toEqual({});

    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await srv.push(a.token, { lists: [{ ...L, members: {}, mtime: 3 }] });
    expect((await srv.pull(b.token, cp)).revoked).toEqual([L1]);
  });

  it('a new member receives existing tasks', async () => {
    const L1 = ids('L1'), t1 = ids('t1');
    const L: List = { id: L1, name: 'Later', color: '0,0,0', ownerId: a.user.id, members: {}, order: 1, mtime: 1 };
    await srv.push(a.token, { lists: [L], tasks: [task(t1, L1, 1)] });
    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await srv.push(a.token, { lists: [{ ...L, members: { [b.user.id]: 'view' }, mtime: 2 }] });
    const p = await srv.pull(b.token, cp);
    expect(p.lists.map(l => l.id)).toEqual([L1]);
    expect(p.tasks.map(t => t.id)).toEqual([t1]);
  });

  it('deleting a list tombstones it for members', async () => {
    const L1 = ids('L1'), t1 = ids('t1');
    const L: List = { id: L1, name: 'Gone', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'edit' }, order: 1, mtime: 1 };
    await srv.push(a.token, { lists: [L], tasks: [task(t1, L1, 1)] });
    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await srv.push(a.token, { lists: [{ ...L, removed: true, mtime: 2 }] });
    const p = await srv.pull(b.token, cp);
    expect(p.lists.map(l => [l.id, l.removed])).toEqual([[L1, true]]);
    // Its tasks are tombstoned with a stamp, so an older offline edit cannot bring them back.
    expect((await srv.push(b.token, { tasks: [task(t1, L1, 1, { title: 'late edit', fm: { title: 1 } })] })).id2error).toEqual({ [t1]: 'NO_PERMISSION' });
  });

  it('moving a task out of a shared list tombstones it there', async () => {
    const L1 = ids('L1'), t1 = ids('t1');
    const L: List = { id: L1, name: 'S', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'edit' }, order: 1, mtime: 1 };
    await srv.push(a.token, { lists: [L], tasks: [task(t1, L1, 1)] });
    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await srv.push(a.token, { tasks: [task(t1, 'inbox-' + a.user.id, 2)] });
    const p = await srv.pull(b.token, cp);
    expect(p.tasks).toEqual([{ id: t1, removed: true }]);
  });

  it('members can leave a list', async () => {
    const L1 = ids('L1');
    await srv.push(a.token, { lists: [{ id: L1, name: 'S', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'view' }, order: 1, mtime: 1 }] });
    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await srv.leaveList(b.token, L1);
    expect((await srv.pull(b.token, cp)).revoked).toEqual([L1]);
    await expect(srv.leaveList(b.token, L1)).rejects.toMatchObject({ status: 404 });
    // The owner renames from a copy that still lists Bob: Bob must stay out.
    await srv.push(a.token, { lists: [{ id: L1, name: 'Renamed', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'view' }, order: 1, mtime: 2, fm: { name: 2, members: 1 } }] });
    const l = (await srv.pull(a.token, 0)).lists.find(x => x.id === L1)!;
    expect(l.name).toBe('Renamed');
    expect(l.members).toEqual({});
  });

  it('finds users by email', async () => {
    expect(await srv.findUser(b.token, emailA)).toEqual({ id: a.user.id, name: 'Ann', email: emailA });
    expect(await srv.findUser(b.token, 'nobody@xairos.test')).toBeNull();
  });

  it('habits and focus are private to their owner', async () => {
    const h1 = ids('h1');
    await srv.push(a.token, { habits: [{ id: h1, name: 'Run', color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 1 }], focus: [{ id: ids('f1'), start: 1, mins: 25, task: '', mtime: 1 }] });
    const pa = await srv.pull(a.token, 0);
    expect(pa.habits.map(h => h.id)).toEqual([h1]);
    expect(pa.focus).toHaveLength(1);
    const pbb = await srv.pull(b.token, 0);
    expect(pbb.habits).toEqual([]);
    expect(pbb.focus).toEqual([]);
    expect((await srv.push(b.token, { habits: [{ id: h1, name: 'Mine', color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 9 }] })).id2error).toEqual({ [h1]: 'NO_PERMISSION' });
  });

  it('Trash keeps a task 30 days, then deletes it for good', async () => {
    const inbox = 'inbox-' + a.user.id, old = ids('old'), fresh = ids('fresh'), noStamp = ids('nostamp');
    const t0 = Date.now();
    await srv.push(a.token, { tasks: [
      task(old, inbox, t0, { deleted: true, fm: { deleted: t0 - 31 * 864e5, title: t0 } }),
      task(fresh, inbox, t0, { deleted: true, fm: { deleted: t0 - 2 * 864e5 } }),
      task(noStamp, inbox, 0, { deleted: true }),
    ] });
    await purge(srv, t0);
    const p = await srv.pull(a.token, 0);
    expect(p.tasks.filter(t => [old, fresh, noStamp].includes(t.id)).map(t => [t.id, !!t.removed]).sort()).toEqual([[fresh, false], [noStamp, false], [old, true]]);
    // 29 days later the fresh one goes too.
    await purge(srv, t0 + 29 * 864e5);
    expect((await srv.pull(a.token, 0)).tasks.find(t => t.id === fresh)!.removed).toBe(true);
  });

  it('habit check-in for Shortcuts: list, done, +1 and undo merge per day', async () => {
    const h1 = ids('h1'), h2 = ids('h2'), gone = ids('gone');
    const hab = (id: string, o: Record<string, unknown> = {}) => ({ id, name: id, color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 1, ...o });
    await srv.push(a.token, { habits: [
      hab(h2, { name: 'Water', goal: 3, order: 2 }), hab(h1, { name: 'Run', order: 1, checks: { '2026-11-04': true } }), hab(gone, { removed: true }),
    ] });
    expect((await habitApi(srv, a, undefined)).body).toEqual([{ id: h1, name: 'Run' }, { id: h2, name: 'Water' }]);
    expect((await habitApi(srv, b, undefined)).body).toEqual([]);

    const check = (id: string, action: string, today = '2026-11-05') => habitApi(srv, a, id, { action, today });
    // Goal 1: done, again is a no-op, undo clears.
    expect((await check(h1, 'done')).body).toMatchObject({ id: h1, name: 'Run', day: '2026-11-05', count: 1, goal: 1, done: true, message: 'Done.' });
    expect((await check(h1, 'done')).body).toMatchObject({ count: 1, message: 'Already done today.' });
    expect((await check(h1, 'undo')).body).toMatchObject({ count: 0, done: false, message: 'Undone.' });
    expect((await check(h1, 'undo')).body).toMatchObject({ count: 0, message: 'Nothing to undo.' });
    // Goal 3: +1 counts, done fills the goal, undo takes one back.
    expect((await check(h2, '+1')).body).toMatchObject({ count: 1, goal: 3, done: false, message: '1/3 today.' });
    expect((await check(h2, 'done')).body).toMatchObject({ count: 3, done: true, message: 'Done.' });
    expect((await check(h2, '+1')).body).toMatchObject({ count: 4, message: '4/3 today.' });
    expect((await check(h2, 'undo')).body).toMatchObject({ count: 3, message: '3/3 today.' });

    // The change is a normal per-day merge: other days and a device's own edit survive.
    await srv.push(a.token, { habits: [hab(h1, { name: 'Run', order: 1, checks: { '2026-11-03': true }, fm: { 'checks.2026-11-03': 5 }, mtime: 5 })] });
    await check(h1, 'done', '2026-11-06');
    const got = (await srv.pull(a.token, 0)).habits.find(x => x.id === h1)!;
    expect(got.checks).toEqual({ '2026-11-03': true, '2026-11-04': true, '2026-11-06': true });
    expect((await srv.pull(a.token, 0)).habits.find(x => x.id === h2)!.checks).toEqual({ '2026-11-05': 3 });

    // Not yours, removed or unknown: 404. Bad action or day: 400.
    expect((await habitApi(srv, b, h1, { action: 'done' })).status).toBe(404);
    expect((await check(gone, 'done')).status).toBe(404);
    expect((await check(ids('nope'), 'done')).status).toBe(404);
    expect((await check(h1, 'explode')).status).toBe(400);
    expect((await habitApi(srv, a, h1, { action: 'done', today: '5 Nov' })).status).toBe(400);
  });

  it('deleting an account erases its data and needs the password', async () => {
    const mine = ids('mine'), theirs = ids('theirs'), t1 = ids('t1'), t2 = ids('t2'), h1 = ids('h1');
    await srv.push(a.token, {
      lists: [{ id: mine, name: 'Ann private', color: '0,0,0', ownerId: a.user.id, members: { [b.user.id]: 'edit' }, order: 1, mtime: 1 }],
      tasks: [task(t1, mine, 1, { title: 'secret' })],
      habits: [{ id: h1, name: 'Run', color: '0,0,0', checks: {}, order: 0, created: 1, mtime: 1 }],
    });
    await srv.push(b.token, {
      lists: [{ id: theirs, name: 'Bob', color: '0,0,0', ownerId: b.user.id, members: { [a.user.id]: 'edit' }, order: 1, mtime: 1 }],
      tasks: [task(t2, theirs, 1, { assignee: a.user.id })],
    });
    const cp = (await srv.pull(b.token, 0)).checkpoint;
    await expect(srv.deleteAccount(a.token, 'wrong-password')).rejects.toMatchObject({ status: 401 });
    await srv.deleteAccount(a.token, pw);

    await expect(srv.login({ email: emailA, password: pw })).rejects.toMatchObject({ status: 401 });
    await expect(srv.pull(a.token, 0)).rejects.toMatchObject({ status: 401 });
    expect(await srv.findUser(b.token, emailA)).toBeNull();
    const p = await srv.pull(b.token, cp);
    expect(p.revoked).toEqual([mine]);
    expect(p.lists.find(l => l.id === theirs)!.members).toEqual({});
    expect(p.tasks.find(t => t.id === t2)!.assignee).toBeNull();
    expect(JSON.stringify(await srv.pull(b.token, 0))).not.toContain('secret');
    // The email can sign up again, as a new account.
    const again = await srv.signup({ name: 'Ann', email: emailA, password: pw });
    expect(again.user.id).not.toBe(a.user.id);
    expect((await srv.pull(again.token, 0)).habits).toEqual([]);
  });
});
