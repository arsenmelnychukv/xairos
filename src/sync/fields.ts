/**
 * Per-field merge. Every entity carries `fm`: field path -> time of
 * its last change. Two copies merge by taking each field from the copy that
 * changed it last. Most fields are top-level (a description is one field, so
 * the newest whole text wins). Map fields merge per key: a habit's `checks`
 * are stamped per day, so check-ins on two devices both survive.
 *
 * Copies without `fm` (older data) use their `mtime` for every field, which
 * is the old whole-entity rule.
 *
 * server/pb_hooks/xairos_lib.js has a plain-JS copy of this; the contract
 * tests run against both.
 */
import type { Entity, EntityType } from '../types';

type Obj = Record<string, unknown> & { id: string; mtime?: number; fm?: Record<string, number> };

/** Never merged: identity, bookkeeping, and fields the server owns. */
export const META = new Set(['id', 'seq', 'mtime', 'fm', 'ownerId', 'prevListId', 'inbox']);
/** Fields merged per key. */
export const MAP_FIELDS: Partial<Record<EntityType, string[]>> = { habits: ['checks'] };

const isMap = (type: EntityType, k: string) => !!MAP_FIELDS[type]?.includes(k);

/** All field paths of an object: `title`, `checks.2026-11-05`, … */
export function paths(type: EntityType, e: Entity | undefined): string[] {
  if (!e) return [];
  const o = e as unknown as Obj;
  const out: string[] = [];
  for (const k of Object.keys(o)) {
    if (META.has(k) || o[k] === undefined) continue;
    if (isMap(type, k) && o[k] && typeof o[k] === 'object') for (const sub of Object.keys(o[k] as object)) out.push(k + '.' + sub);
    else out.push(k);
  }
  return out;
}

function getPath(type: EntityType, o: Obj, p: string): unknown {
  const dot = p.indexOf('.');
  if (dot > 0 && isMap(type, p.slice(0, dot))) return (o[p.slice(0, dot)] as Record<string, unknown> | undefined)?.[p.slice(dot + 1)];
  return o[p];
}

function setPath(type: EntityType, o: Obj, p: string, v: unknown) {
  const dot = p.indexOf('.');
  if (dot > 0 && isMap(type, p.slice(0, dot))) {
    const k = p.slice(0, dot), sub = p.slice(dot + 1);
    const m = { ...((o[k] as Record<string, unknown>) || {}) };
    if (v === undefined) delete m[sub]; else m[sub] = v;
    o[k] = m;
  } else if (v === undefined) delete o[p];
  else o[p] = v;
}

/**
 * When a field last changed in this copy. Old data without `fm` uses its
 * mtime for every field; with `fm`, a missing stamp means never changed (0).
 * Map keys fall back to the whole map's stamp.
 */
export function stampOf(o: Entity | undefined, p: string): number {
  if (!o) return -1;
  if (!o.fm) return o.mtime || 0;
  const fm = o.fm;
  if (p in fm) return fm[p]!;
  const dot = p.indexOf('.');
  if (dot > 0 && p.slice(0, dot) in fm) return fm[p.slice(0, dot)]!;
  return 0;
}

/** Give old data (no `fm`) a stamp per field: its mtime. Then missing stamps mean "never changed". */
export function seedStamps(type: EntityType, e: Entity): Record<string, number> {
  const fm: Record<string, number> = {};
  for (const p of paths(type, e)) fm[p] = e.mtime || 0;
  return fm;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Stamp `now` on every field of `obj` that differs from `base` (the last known
 * version). With no base, every field is new. Returns the field paths changed.
 */
export function stampChanges(type: EntityType, baseE: Entity | undefined, objE: Entity, now: number): string[] {
  const base = baseE as unknown as Obj | undefined, obj = objE as unknown as Obj;
  const fm: Record<string, number> = { ...(obj.fm || base?.fm || (base ? seedStamps(type, baseE!) : {})) };
  const changed: string[] = [];
  const all = new Set([...paths(type, base), ...paths(type, obj)]);
  for (const p of all) {
    if (base && same(getPath(type, base, p), getPath(type, obj, p))) continue;
    fm[p] = now; changed.push(p);
  }
  obj.fm = fm;
  return changed;
}

/** Field paths whose values differ between two copies. */
export function changedPaths(type: EntityType, baseE: Entity, objE: Entity): string[] {
  const base = baseE as unknown as Obj, obj = objE as unknown as Obj;
  return [...new Set([...paths(type, baseE), ...paths(type, objE)])].filter(p => !same(getPath(type, base, p), getPath(type, obj, p)));
}

/** Copy the given field paths from one copy onto another. */
export function copyPaths(type: EntityType, fromE: Entity, toE: Entity, ps: string[]) {
  const from = fromE as unknown as Obj, to = toE as unknown as Obj;
  for (const p of ps) setPath(type, to, p, structuredClone(getPath(type, from, p)));
}

/**
 * Merge two copies of one entity. Each field comes from the copy that changed
 * it last; on a tie, `b` wins. Meta fields come from `b`; callers set the
 * server-owned ones.
 */
export function mergeEntity<T extends Entity>(type: EntityType, aE: T, bE: T): T {
  const a = aE as unknown as Obj, b = bE as unknown as Obj;
  const out = { ...b } as Obj;
  const fm: Record<string, number> = {};
  for (const p of new Set([...paths(type, a), ...paths(type, b), ...Object.keys(a.fm || {}), ...Object.keys(b.fm || {})])) {
    const sa = stampOf(a, p), sb = stampOf(b, p);
    const win = sa > sb ? a : b;
    setPath(type, out, p, getPath(type, win, p));
    fm[p] = Math.max(sa, sb);
  }
  out.fm = fm;
  out.mtime = Math.max(a.mtime || 0, b.mtime || 0);
  return out as unknown as T;
}
