import { describe, expect, it } from 'vitest';
import { mergeEntity, paths, stampChanges, stampOf } from '../src/sync/fields';
import { applyPull, emptyDb, markDirty, remember } from '../src/sync/merge';
import type { Habit, PullResult, Task } from '../src/types';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't', title: 'T', desc: '', listId: 'L', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u', ...o,
});
const habit = (o: Partial<Habit> = {}): Habit => ({ id: 'h', name: 'Run', color: '0,0,0', checks: {}, order: 0, created: 1, ...o });
const pull = (o: Partial<PullResult>): PullResult => ({ checkpoint: 5, lists: [], tasks: [], habits: [], focus: [], users: [], revoked: [], ...o });

describe('stampChanges', () => {
  it('stamps only fields that differ from the base', () => {
    const base = task({ fm: { title: 1, desc: 1 }, mtime: 1 });
    const edited = { ...base, title: 'New' };
    expect(stampChanges('tasks', base, edited, 50)).toEqual(['title']);
    expect(edited.fm).toMatchObject({ title: 50, desc: 1 });
  });

  it('stamps every field of a new entity, never meta fields', () => {
    const t = task({ seq: 3 });
    stampChanges('tasks', undefined, t, 9);
    expect(t.fm!.title).toBe(9);
    expect(t.fm!.seq).toBeUndefined();
    expect(t.fm!.id).toBeUndefined();
  });

  it('expands habit checks into one path per day, and stamps an uncheck', () => {
    const base = habit({ checks: { '2026-11-04': true, '2026-11-05': true } });
    expect(paths('habits', base)).toContain('checks.2026-11-05');
    const edited = habit({ checks: { '2026-11-04': true } });
    expect(stampChanges('habits', base, edited, 7)).toEqual(['checks.2026-11-05']);
  });
});

describe('mergeEntity', () => {
  it('keeps edits to different fields from both copies', () => {
    const laptop = task({ title: 'Renamed', fm: { title: 200, items: 100 }, mtime: 200 });
    const phone = task({ items: [{ id: 'i', title: 'Milk', done: true }], fm: { title: 100, items: 210 }, mtime: 210 });
    const m = mergeEntity('tasks', laptop, phone);
    expect(m.title).toBe('Renamed');
    expect(m.items).toHaveLength(1);
    expect(m.fm).toMatchObject({ title: 200, items: 210 });
    expect(m.mtime).toBe(210);
    expect(mergeEntity('tasks', phone, laptop)).toMatchObject({ title: 'Renamed', items: m.items }); // order does not matter
  });

  it('a description is one field: the newest whole text wins', () => {
    const a = task({ desc: 'line one\nmine', fm: { desc: 300 } });
    const b = task({ desc: 'line one\ntheirs', fm: { desc: 299 } });
    expect(mergeEntity('tasks', a, b).desc).toBe('line one\nmine');
  });

  it('merges habit check-ins per day, including unchecks', () => {
    const laptop = habit({ checks: { '2026-11-04': true }, fm: { 'checks.2026-11-04': 10, 'checks.2026-11-03': 12 } }); // unchecked the 3rd
    const phone = habit({ checks: { '2026-11-03': true, '2026-11-05': true }, fm: { 'checks.2026-11-03': 5, 'checks.2026-11-05': 11 } });
    expect(mergeEntity('habits', laptop, phone).checks).toEqual({ '2026-11-04': true, '2026-11-05': true });
  });

  it('data without fm falls back to whole-entity newest-wins', () => {
    const older = task({ title: 'old', desc: 'old', mtime: 1 });
    const newer = task({ title: 'new', desc: 'new', mtime: 2 });
    expect(mergeEntity('tasks', newer, older)).toMatchObject({ title: 'new', desc: 'new' });
    expect(stampOf(older, 'title')).toBe(1);
  });

  it('a removal stamped later beats an older edit', () => {
    const removed = task({ removed: true, fm: { removed: 50, title: 1 }, mtime: 50 });
    const edit = task({ title: 'late?', fm: { title: 40 }, mtime: 40 });
    expect(mergeEntity('tasks', edit, removed)).toMatchObject({ removed: true, title: 'late?' });
  });
});

describe('client db with per-field stamps', () => {
  it('markDirty finds in-place edits through the remembered base', () => {
    const db = emptyDb();
    const t = task({ fm: { title: 1, desc: 1 }, mtime: 1 });
    db.tasks.t = t; remember(t);
    Object.assign(t, { desc: 'typed' }); // how the detail pane edits
    markDirty(db, 'tasks', t, 100);
    expect(t.fm).toMatchObject({ title: 1, desc: 100 });
  });

  it('markDirty diffs a spread copy against the old object', () => {
    const db = emptyDb();
    const t = task({ fm: { title: 1, deleted: 1 }, mtime: 1 });
    db.tasks.t = t; remember(t);
    const copy = { ...t, deleted: true };
    markDirty(db, 'tasks', copy, 100);
    expect(copy.fm).toMatchObject({ title: 1, deleted: 100 });
  });

  it('a pull merges into an unsent local edit and keeps it queued', () => {
    const db = emptyDb();
    const t = task({ fm: { title: 1, priority: 1 }, mtime: 1 });
    db.tasks.t = t; remember(t);
    Object.assign(t, { priority: 5 });
    markDirty(db, 'tasks', t, 100);
    applyPull(db, pull({ tasks: [task({ title: 'From phone', fm: { title: 90, priority: 1 }, mtime: 90, seq: 4 })] }));
    expect(db.tasks.t).toMatchObject({ title: 'From phone', priority: 5 });
    expect(db.dirty.tasks.t).toBe(100);
  });

  it('a bare tombstone does not drop an unsent local edit', () => {
    const db = emptyDb();
    markDirty(db, 'tasks', task(), 100);
    applyPull(db, pull({ tasks: [{ id: 't', removed: true } as Task] }));
    expect(db.tasks.t).toBeDefined();
  });

  it('a stamped server delete wins over an older unsent edit', () => {
    const db = emptyDb();
    const t = task({ fm: { title: 1 }, mtime: 1 });
    db.tasks.t = t; remember(t);
    Object.assign(t, { title: 'edit' });
    markDirty(db, 'tasks', t, 100);
    applyPull(db, pull({ tasks: [task({ removed: true, fm: { title: 1, removed: 200 }, mtime: 200 })] }));
    expect(db.tasks.t).toBeUndefined();
  });
});

describe('editing a copy that a pull replaced', () => {
  it('applies only the edited field onto the newer copy', () => {
    const db = emptyDb();
    const held = task({ fm: { title: 1, priority: 1 }, mtime: 1 });
    db.tasks.t = held; remember(held);              // the detail pane holds this object
    applyPull(db, pull({ tasks: [task({ priority: 5, fm: { title: 1, priority: 50 }, mtime: 50, seq: 2 })] })); // phone set priority
    Object.assign(held, { title: 'Typed' });         // keystroke on the old object
    markDirty(db, 'tasks', held, 100);
    expect(db.tasks.t).toMatchObject({ title: 'Typed', priority: 5 });
    expect(db.tasks.t!.fm).toMatchObject({ title: 100, priority: 50 });
    Object.assign(held, { title: 'Typed more' });    // and the next keystroke
    markDirty(db, 'tasks', held, 110);
    expect(db.tasks.t).toMatchObject({ title: 'Typed more', priority: 5 });
  });
});
