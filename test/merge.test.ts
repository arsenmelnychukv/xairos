import { describe, expect, it } from 'vitest';
import { applyPull, clearSent, collectChanges, emptyDb, markDirty } from '../src/sync/merge';
import type { List, PullResult, Task } from '../src/types';

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, title: id, desc: '', listId: 'L1', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u1', ...o,
});
const list = (id: string, o: Partial<List> = {}): List => ({ id, name: id, color: '0,0,0', ownerId: 'u1', members: {}, order: 1, ...o });
const pull = (o: Partial<PullResult>): PullResult => ({ checkpoint: 10, lists: [], tasks: [], habits: [], focus: [], users: [], revoked: [], ...o });

describe('markDirty', () => {
  it('stamps a rising mtime and marks dirty', () => {
    const db = emptyDb();
    const t = task('a', { mtime: 5000 });
    expect(markDirty(db, 'tasks', t, 1000)).toBe(5001); // never goes back in time
    expect(db.tasks.a).toBe(t);
    expect(db.dirty.tasks.a).toBe(5001);
    expect(markDirty(db, 'tasks', t, 9000)).toBe(9000);
  });
});

describe('collectChanges / clearSent', () => {
  it('collects copies of dirty entities', () => {
    const db = emptyDb();
    markDirty(db, 'tasks', task('a'), 100);
    markDirty(db, 'lists', list('L1'), 100);
    const { changes, any } = collectChanges(db);
    expect(any).toBe(true);
    expect(changes.tasks.map(t => t.id)).toEqual(['a']);
    expect(changes.lists.map(l => l.id)).toEqual(['L1']);
    expect(changes.tasks[0]).not.toBe(db.tasks.a); // a clone
  });

  it('nothing dirty means nothing to push', () => {
    expect(collectChanges(emptyDb()).any).toBe(false);
  });

  it('keeps entities dirty if edited again during the push', () => {
    const db = emptyDb();
    const a = task('a'), b = task('b');
    markDirty(db, 'tasks', a, 100); markDirty(db, 'tasks', b, 100);
    const { sent } = collectChanges(db);
    markDirty(db, 'tasks', a, 200); // edited while the push was in flight
    clearSent(db, sent);
    expect(db.dirty.tasks).toEqual({ a: 200 });
  });
});

describe('applyPull', () => {
  it('adds and replaces clean entities and sets the checkpoint', () => {
    const db = emptyDb();
    db.tasks.a = task('a', { title: 'old' });
    applyPull(db, pull({ tasks: [task('a', { title: 'new' }), task('b')], users: [{ id: 'u2', name: 'B', email: 'b@x' }] }));
    expect(db.tasks.a!.title).toBe('new');
    expect(db.tasks.b).toBeDefined();
    expect(db.users.u2!.name).toBe('B');
    expect(db.checkpoint).toBe(10);
  });

  it('keeps dirty local entities', () => {
    const db = emptyDb();
    markDirty(db, 'tasks', task('a', { title: 'mine' }), 100);
    applyPull(db, pull({ tasks: [task('a', { title: 'theirs' })] }));
    expect(db.tasks.a!.title).toBe('mine');
  });

  it('removes tombstones', () => {
    const db = emptyDb();
    db.tasks.a = task('a');
    applyPull(db, pull({ tasks: [{ id: 'a', removed: true } as Task] }));
    expect(db.tasks.a).toBeUndefined();
  });

  it('a removed list takes its clean tasks with it, keeps dirty ones', () => {
    const db = emptyDb();
    db.lists.L1 = list('L1');
    db.tasks.a = task('a');
    markDirty(db, 'tasks', task('b'), 100);
    applyPull(db, pull({ lists: [list('L1', { removed: true })] }));
    expect(db.lists.L1).toBeUndefined();
    expect(db.tasks.a).toBeUndefined();
    expect(db.tasks.b).toBeDefined();
  });

  it('revoked access drops the list and all its tasks', () => {
    const db = emptyDb();
    db.lists.L1 = list('L1');
    db.tasks.a = task('a');
    applyPull(db, pull({ revoked: ['L1'] }));
    expect(db.lists.L1).toBeUndefined();
    expect(db.tasks.a).toBeUndefined();
  });

  it('ignores a revoke when the same pull grants the list again', () => {
    const db = emptyDb();
    db.lists.L1 = list('L1');
    applyPull(db, pull({ revoked: ['L1'], lists: [list('L1', { name: 'back' })] }));
    expect(db.lists.L1!.name).toBe('back');
  });
});
