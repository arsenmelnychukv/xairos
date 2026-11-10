import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NEW, OLD, isOwnBackup, migrateIndexedDb, migrateLocalStorage } from '../src/lib/rename';
import { LocalStore } from '../src/persist/idb';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Make an IndexedDB database the way the app did under its old name. */
function makeOld(userId: string) {
  return new Promise<void>((res, rej) => {
    const r = indexedDB.open(OLD + '-' + userId, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const t of ['lists', 'tasks', 'habits', 'focus']) d.createObjectStore(t, { keyPath: 'id' });
      const meta = d.createObjectStore('meta');
      r.transaction!.objectStore('tasks').put({ id: 't1', title: 'unsynced edit', mtime: 5, seq: 0 });
      meta.put({ tasks: { t1: 5 } }, 'dirty');
      meta.put(42, 'checkpoint');
    };
    r.onsuccess = () => { r.result.close(); res(); };
    r.onerror = () => rej(r.error);
  });
}

const names = async () => (await indexedDB.databases()).map(d => d.name);

let n = 0, user = '';
beforeEach(() => { user = 'r' + ++n; });

describe('rename migration: localStorage', () => {
  it('copies every old key to the new name and drops the old one', () => {
    const ls = new MemStorage();
    ls.setItem(OLD + '.prefs', '{"theme":"dark"}');
    ls.setItem(OLD + '.session', '{"token":"t"}');
    ls.setItem(OLD + '.timer.u1', '{"mode":"pomo"}');
    ls.setItem('other.key', 'x');
    expect(migrateLocalStorage(ls)).toBe(3);
    expect(ls.getItem(NEW + '.prefs')).toBe('{"theme":"dark"}');
    expect(ls.getItem(NEW + '.session')).toBe('{"token":"t"}');
    expect(ls.getItem(NEW + '.timer.u1')).toBe('{"mode":"pomo"}');
    expect(ls.getItem(OLD + '.prefs')).toBeNull();
    expect(ls.getItem('other.key')).toBe('x');
  });

  it('keeps a value that already exists under the new name, and runs once', () => {
    const ls = new MemStorage();
    ls.setItem(OLD + '.prefs', 'old');
    ls.setItem(NEW + '.prefs', 'new');
    migrateLocalStorage(ls);
    expect(ls.getItem(NEW + '.prefs')).toBe('new');
    expect(ls.getItem(OLD + '.prefs')).toBeNull();
    expect(migrateLocalStorage(ls)).toBe(0);
  });
});

describe('rename migration: IndexedDB', () => {
  it('moves the old database, unsynced queue included, then deletes it', async () => {
    await makeOld(user);
    expect(await migrateIndexedDb(user)).toBe(true);
    expect(await names()).not.toContain(OLD + '-' + user);
    expect(await names()).toContain(NEW + '-' + user);

    const s = await LocalStore.open(user);
    const db = await s.load();
    expect(db.tasks.t1!.title).toBe('unsynced edit');
    expect(db.checkpoint).toBe(42);
    s.close();
  });

  it('LocalStore.open runs it on its own', async () => {
    await makeOld(user);
    const s = await LocalStore.open(user);
    expect((await s.load()).tasks.t1!.title).toBe('unsynced edit');
    s.close();
    expect(await names()).not.toContain(OLD + '-' + user);
  });

  it('does nothing without an old database, and never overwrites a new one', async () => {
    expect(await migrateIndexedDb(user)).toBe(false);
    expect(await names()).not.toContain(OLD + '-' + user);

    const s = await LocalStore.open(user); s.close();
    await makeOld(user);
    expect(await migrateIndexedDb(user)).toBe(false);
    expect(await names()).toContain(OLD + '-' + user);
  });

  it('copies out-of-line keys as they were', async () => {
    await makeOld(user);
    await migrateIndexedDb(user);
    const d = await req(indexedDB.open(NEW + '-' + user));
    expect(await req(d.transaction('meta').objectStore('meta').get('dirty'))).toEqual({ tasks: { t1: 5 } });
    d.close();
  });
});

describe('rename migration: backups', () => {
  it('accepts backups made under either name', () => {
    expect(isOwnBackup(NEW)).toBe(true);
    expect(isOwnBackup(OLD)).toBe(true);
    expect(isOwnBackup('other')).toBe(false);
  });
});
