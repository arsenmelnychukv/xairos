/**
 * One-time move of browser data from the app's old name to xairos.
 *
 * Before the rename, keys were `<old>.prefs`, `<old>.session`, `<old>.timer.<uid>` and
 * so on, and each account had an IndexedDB database `<old>-<userId>`. Each old
 * localStorage key is copied to its `xairos.` name, then dropped. A key that already
 * exists under the new name wins. The old database is copied store by store into
 * `xairos-<userId>` before LocalStore opens it, then deleted. Nothing is dropped
 * until its copy is written.
 */
export const OLD = 'kai' + 'ros';
export const NEW = 'xairos';

/** Copy every `<OLD>.*` localStorage key to `xairos.*`, then remove the old ones. Synchronous. */
export function migrateLocalStorage(ls: Storage | undefined = globalThis.localStorage): number {
  if (!ls) return 0;
  let moved = 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(OLD + '.')) old.push(k); }
    for (const k of old) {
      const nk = NEW + k.slice(OLD.length), v = ls.getItem(k);
      if (v === null) continue;
      if (ls.getItem(nk) === null) ls.setItem(nk, v);
      if (ls.getItem(nk) !== null) { ls.removeItem(k); moved++; }
    }
  } catch { /* storage blocked or full: keep the old keys, try again next start */ }
  return moved;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Open a database only if it exists. Resolves null (and leaves nothing behind) if it does not. */
function openIfExists(f: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((res, rej) => {
    let created = false;
    const r = f.open(name);
    r.onupgradeneeded = () => { created = true; r.transaction?.abort(); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => {
      if (!created) return rej(r.error);
      const d = f.deleteDatabase(name);
      d.onsuccess = d.onerror = d.onblocked = () => res(null);
    };
  });
}

async function exists(f: IDBFactory, name: string): Promise<boolean> {
  if (typeof f.databases === 'function') {
    try { return (await f.databases()).some(d => d.name === name); } catch { /* fall through */ }
  }
  const d = await openIfExists(f, name);
  d?.close();
  return !!d;
}

/**
 * Copy IndexedDB `<OLD>-<userId>` into `xairos-<userId>` if the new one does not
 * exist yet, keeping its version, stores and keys, then delete the old one.
 */
export async function migrateIndexedDb(userId: string, f: IDBFactory | undefined = globalThis.indexedDB): Promise<boolean> {
  if (!f) return false;
  const from = OLD + '-' + userId, to = NEW + '-' + userId;
  if (!(await exists(f, from)) || (await exists(f, to))) return false;
  const src = await openIfExists(f, from);
  if (!src) return false;
  try {
    const stores = [...src.objectStoreNames];
    const data: Record<string, { keyPath: string | string[] | null; autoIncrement: boolean; keys: IDBValidKey[]; values: unknown[] }> = {};
    if (stores.length) {
      const tx = src.transaction(stores, 'readonly');
      for (const s of stores) {
        const os = tx.objectStore(s);
        const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
        data[s] = { keyPath: os.keyPath, autoIncrement: os.autoIncrement, keys, values };
      }
    }
    const version = src.version;
    src.close();

    await new Promise<void>((res, rej) => {
      const r = f.open(to, version);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of stores) {
          const { keyPath, autoIncrement, keys, values } = data[s]!;
          const os = d.createObjectStore(s, { keyPath, autoIncrement });
          values.forEach((v, i) => keyPath === null ? os.put(v, keys[i]) : os.put(v));
        }
      };
      r.onsuccess = () => { r.result.close(); res(); };
      r.onerror = () => rej(r.error);
    });
  } catch (e) {
    src.close();
    // Half-written copy: remove it so the next start tries again from the old one.
    await new Promise<void>(res => { const d = f.deleteDatabase(to); d.onsuccess = d.onerror = d.onblocked = () => res(); });
    throw e;
  }
  await new Promise<void>(res => { const d = f.deleteDatabase(from); d.onsuccess = d.onerror = d.onblocked = () => res(); });
  return true;
}

/** A backup file from before the rename names the app by its old name. */
export const isOwnBackup = (app: unknown) => app === NEW || app === OLD;
