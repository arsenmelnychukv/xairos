import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '../src/persist/idb';
import { applyPull, clearSent, collectChanges, emptyDb, markDirty } from '../src/sync/merge';
import type { Task } from '../src/types';

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, title: id, desc: '', listId: 'L1', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u1', ...o,
});

let n = 0;
let user: string;
beforeEach(() => { user = 'u' + ++n; });

describe('LocalStore', () => {
  it('starts empty and round-trips entities, checkpoint, dirty queue and users', async () => {
    const s = await LocalStore.open(user);
    expect(await s.isEmpty()).toBe(true);
    const db = emptyDb();
    markDirty(db, 'tasks', task('a', { title: 'offline edit' }), 100);
    db.lists.L1 = { id: 'L1', name: 'Work', color: '0,0,0', ownerId: user, members: {}, order: 1, seq: 3 };
    db.users.u2 = { id: 'u2', name: 'Bob', email: 'b@xairos.test' };
    db.checkpoint = 7;
    await s.save(db);
    s.close();

    const again = await LocalStore.open(user);
    const back = await again.load();
    expect(back.tasks.a!.title).toBe('offline edit');
    expect(back.lists.L1!.name).toBe('Work');
    expect(back.checkpoint).toBe(7);
    expect(back.dirty.tasks).toEqual({ a: 100 });
    expect(back.users.u2!.name).toBe('Bob');
    // The queued edit is still pushable after a reload.
    expect(collectChanges(back).changes.tasks.map(t => t.id)).toEqual(['a']);
    again.close();
  });

  it('writes edits and deletes incrementally', async () => {
    const s = await LocalStore.open(user);
    const db = emptyDb();
    markDirty(db, 'tasks', task('a'), 100);
    markDirty(db, 'tasks', task('b'), 100);
    await s.save(db);

    markDirty(db, 'tasks', Object.assign(db.tasks.a!, { title: 'renamed' }), 200);
    delete db.tasks.b;
    const { sent } = collectChanges(db);
    clearSent(db, sent);
    await s.save(db);
    s.close();

    const back = await (await LocalStore.open(user)).load();
    expect(back.tasks.a!.title).toBe('renamed');
    expect(back.tasks.b).toBeUndefined();
    expect(back.dirty.tasks).toEqual({});
  });

  it('persists pulled changes, including tombstones', async () => {
    const s = await LocalStore.open(user);
    const db = emptyDb();
    db.tasks.a = task('a', { seq: 1 });
    db.tasks.b = task('b', { seq: 2 });
    await s.save(db);
    applyPull(db, { checkpoint: 9, lists: [], tasks: [task('a', { title: 'from server', seq: 8 }), { id: 'b', removed: true } as Task], habits: [], focus: [], users: [], revoked: [] });
    await s.save(db);
    s.close();
    const back = await (await LocalStore.open(user)).load();
    expect(back.tasks.a!.title).toBe('from server');
    expect(back.tasks.b).toBeUndefined();
    expect(back.checkpoint).toBe(9);
  });

  it('keeps accounts apart and destroy erases one', async () => {
    const other = user + 'x';
    const s1 = await LocalStore.open(user), s2 = await LocalStore.open(other);
    const d1 = emptyDb(); markDirty(d1, 'tasks', task('mine'), 1); await s1.save(d1);
    const d2 = emptyDb(); markDirty(d2, 'tasks', task('theirs'), 1); await s2.save(d2);
    s1.close(); s2.close();
    await LocalStore.destroy(user);
    expect(await (await LocalStore.open(user)).isEmpty()).toBe(true);
    expect(Object.keys((await (await LocalStore.open(other)).load()).tasks)).toEqual(['theirs']);
  });
});
