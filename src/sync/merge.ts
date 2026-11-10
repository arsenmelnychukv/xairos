/**
 * Pure sync bookkeeping on a ClientDb. No DOM, no network: unit-tested.
 * Conflicts merge per field (see fields.ts): local edits are stamped when
 * marked dirty, and pulled copies merge with unsent local ones.
 */
import type { Changes, ClientDb, EntityMap, EntityType, PullResult } from '../types';
import { TYPES } from '../types';
import { clone } from '../lib/util';
import { changedPaths, copyPaths, mergeEntity, stampChanges } from './fields';

export const emptyDb = (): ClientDb => ({
  lists: {}, tasks: {}, habits: {}, focus: {}, users: {}, checkpoint: 0,
  dirty: { lists: {}, tasks: {}, habits: {}, focus: {} },
});

/**
 * Last known version of each entity object, to find which fields an edit
 * changed. Views often edit objects in place before marking them dirty, so
 * the object itself cannot serve as the base.
 */
const bases = new WeakMap<object, object>();
/** Remember `obj` as the base for its next diff. */
export function remember(obj: object) { bases.set(obj, clone(obj)); }
/** Remember every entity in the db (after loading it). */
export function rememberAll(db: ClientDb) { for (const t of TYPES) for (const e of Object.values(db[t])) remember(e); }

type AnyEntity = EntityMap[EntityType];

/** Stamp changed fields, bump mtime and mark the entity dirty. Returns the new mtime. */
export function markDirty<K extends EntityType>(db: ClientDb, type: K, edited: EntityMap[K], now = Date.now()): number {
  const table = db[type] as Record<string, EntityMap[K]>;
  const prev = table[edited.id];
  let obj = edited;
  const staleBase = prev && prev !== edited ? bases.get(edited) as EntityMap[K] | undefined : undefined;
  if (staleBase) {
    // The UI edited an older copy (a pull replaced it meanwhile, e.g. while typing in
    // the detail pane). Apply only what changed in that copy onto the current one,
    // so the old copy's other fields do not overwrite newer values.
    obj = clone(prev);
    copyPaths(type, edited, obj, changedPaths(type, staleBase, edited));
    remember(edited);
  }
  // Base: the snapshot of the copy we had; a spread copy can use the old object itself.
  const base = prev ? (bases.get(prev) ?? (prev !== obj ? prev : undefined)) : undefined;
  const mtime = Math.max(now, (obj.mtime || 0) + 1, (prev?.mtime || 0) + 1);
  if (prev && !base) {
    // Unknown base (should not happen): stamp every field, the old whole-entity rule.
    stampChanges(type, undefined, obj, mtime);
  } else stampChanges(type, base as AnyEntity | undefined, obj, mtime);
  obj.mtime = mtime;
  table[obj.id] = obj;
  remember(obj);
  (db.dirty[type] as Record<string, number>)[obj.id] = mtime;
  return mtime;
}

export type Sent = { [K in EntityType]: Record<string, number> };

/** Snapshot dirty entities for a push. `sent` remembers which versions went out. */
export function collectChanges(db: ClientDb): { changes: Changes; sent: Sent; any: boolean } {
  const changes = {} as Changes, sent = {} as Sent;
  let any = false;
  for (const type of TYPES) {
    sent[type] = { ...db.dirty[type] };
    const table = db[type] as Record<string, unknown>;
    (changes as Record<EntityType, unknown[]>)[type] = Object.keys(sent[type]).map(id => table[id]).filter(Boolean).map(clone);
    if (changes[type].length) any = true;
  }
  return { changes, sent, any };
}

/** After a push: clear dirty flags, unless the entity changed again meanwhile. */
export function clearSent(db: ClientDb, sent: Sent): void {
  for (const type of TYPES) for (const id in sent[type]) if (db.dirty[type][id] === sent[type][id]) delete db.dirty[type][id];
}

/** Merge a pull into the local db. Unsent local edits are merged field by field and stay dirty. */
export function applyPull(db: ClientDb, p: PullResult): void {
  for (const lid of p.revoked) {
    if (p.lists.some(l => l.id === lid && !l.removed)) continue;
    delete db.lists[lid];
    for (const t of Object.values(db.tasks)) if (t.listId === lid) delete db.tasks[t.id];
  }
  for (const type of TYPES) {
    const table = db[type] as Record<string, AnyEntity>;
    for (const e of p[type] as AnyEntity[]) {
      const local = table[e.id];
      const dirty = !!db.dirty[type][e.id];
      // A bare tombstone ({id, removed}) means "no longer visible to you", not an edit.
      const bare = e.removed && !e.fm;
      if (dirty && local && bare) continue;
      const next = dirty && local ? mergeEntity<AnyEntity>(type, local, e) : e;
      if (next.removed) {
        delete table[e.id];
        if (type === 'lists') for (const t of Object.values(db.tasks)) if (t.listId === e.id && !db.dirty.tasks[t.id]) delete db.tasks[t.id];
      } else { table[e.id] = next; remember(next); }
    }
  }
  for (const u of p.users) db.users[u.id] = u;
  db.checkpoint = p.checkpoint;
}
