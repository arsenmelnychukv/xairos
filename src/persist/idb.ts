/**
 * Per-account local database in IndexedDB (database `xairos-<userId>`).
 * Entities live in one store per type; checkpoint, dirty map and users in `meta`.
 * The dirty map is the push queue: it survives reloads and is pushed on next sync.
 *
 * save() writes only what changed since the last save, found by each entity's
 * (mtime, seq, removed) signature: every local edit bumps mtime, every server
 * write bumps seq.
 */
import type { ClientDb, EntityType } from '../types';
import { TYPES } from '../types';
import { emptyDb } from '../sync/merge';
import { migrateIndexedDb } from '../lib/rename';

const VERSION = 1;
const dbName = (userId: string) => 'xairos-' + userId;

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => {
  tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('IndexedDB transaction aborted'));
});

type Sig = string;
type Row = { id: string; mtime?: number; seq?: number; removed?: boolean };
const sigOf = (e: { mtime?: number; seq?: number; removed?: boolean }): Sig => `${e.mtime || 0}|${e.seq || 0}|${e.removed ? 1 : 0}`;

export class LocalStore {
  private sigs: Record<EntityType, Map<string, Sig>> = { lists: new Map(), tasks: new Map(), habits: new Map(), focus: new Map() };
  private chain: Promise<void> = Promise.resolve();

  private constructor(private idb: IDBDatabase, readonly userId: string) {}

  static async open(userId: string): Promise<LocalStore> {
    // Data saved under the old app name moves to this database first.
    try { await migrateIndexedDb(userId); } catch (e) { console.warn('IndexedDB rename migration failed', e); }
    const r = indexedDB.open(dbName(userId), VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const t of TYPES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    return req(r).then(d => {
      // Another tab upgrading the schema: let it, this tab reloads.
      d.onversionchange = () => { d.close(); location.reload(); };
      return new LocalStore(d, userId);
    });
  }

  /** Delete an account's local data (on sign-out). */
  static destroy(userId: string): Promise<void> {
    return new Promise(res => {
      const r = indexedDB.deleteDatabase(dbName(userId));
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }

  async load(): Promise<ClientDb> {
    const tx = this.idb.transaction([...TYPES, 'meta'], 'readonly');
    const db = emptyDb();
    const reads: Promise<unknown>[] = TYPES.map(async t => {
      const all = await req(tx.objectStore(t).getAll());
      const table = db[t] as Record<string, { id: string }>;
      for (const e of all as { id: string; mtime?: number; seq?: number; removed?: boolean }[]) { table[e.id] = e; this.sigs[t].set(e.id, sigOf(e)); }
    });
    const meta = tx.objectStore('meta');
    reads.push(req(meta.get('checkpoint')).then(v => { db.checkpoint = (v as number) || 0; }));
    reads.push(req(meta.get('dirty')).then(v => { if (v) db.dirty = { ...db.dirty, ...(v as ClientDb['dirty']) }; }));
    reads.push(req(meta.get('users')).then(v => { if (v) db.users = v as ClientDb['users']; }));
    await Promise.all(reads);
    await done(tx);
    return db;
  }

  /** True if this account has never been saved here. */
  async isEmpty(): Promise<boolean> {
    return (await req(this.idb.transaction('meta').objectStore('meta').count())) === 0;
  }

  /** Write the changes since the last save. Saves run one after another. */
  save(db: ClientDb): Promise<void> {
    const snapshot = {
      checkpoint: db.checkpoint,
      dirty: structuredClone(db.dirty),
      users: { ...db.users },
      tables: TYPES.map(t => [t, { ...db[t] } as Record<string, Row>] as const),
    };
    this.chain = this.chain.then(() => this.write(snapshot)).catch(e => console.warn('local save failed', e));
    return this.chain;
  }

  private async write(s: { checkpoint: number; dirty: ClientDb['dirty']; users: ClientDb['users']; tables: (readonly [EntityType, Record<string, Row>])[] }) {
    const tx = this.idb.transaction([...TYPES, 'meta'], 'readwrite');
    const next: [EntityType, string, Sig | null][] = [];
    for (const [t, table] of s.tables) {
      const store = tx.objectStore(t), seen = this.sigs[t];
      for (const id in table) {
        const e = table[id]!, sig = sigOf(e);
        if (seen.get(id) !== sig) { store.put(e); next.push([t, id, sig]); }
      }
      for (const id of seen.keys()) if (!(id in table)) { store.delete(id); next.push([t, id, null]); }
    }
    const meta = tx.objectStore('meta');
    meta.put(s.checkpoint, 'checkpoint');
    meta.put(s.dirty, 'dirty');
    meta.put(s.users, 'users');
    await done(tx);
    // Only remember signatures once they are on disk.
    for (const [t, id, sig] of next) { if (sig === null) this.sigs[t].delete(id); else this.sigs[t].set(id, sig); }
  }

  close() { this.idb.close(); }
}
