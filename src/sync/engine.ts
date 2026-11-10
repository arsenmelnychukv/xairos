/** Sync loop: push dirty entities, then pull from the checkpoint. */
import { S, hasDb, onLocalChange, saveLocal, server, session, ui } from '../store';
import { applyPull, clearSent, collectChanges } from './merge';
import { TYPES } from '../types';
import { ApiError } from '../lib/util';
import { toast } from '../ui/toast';
import { softRender } from '../app';
import { checkReminders } from '../views/reminders';
import { signOut } from '../views/auth';
import { refreshGoogle } from '../google';
import { refreshSyncBtn } from '../views/rail';

export type SyncState = 'idle' | 'syncing' | 'ok' | 'offline' | 'error';
export const Sync = {
  state: 'idle' as SyncState, last: null as number | null,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  running: false, again: false, full: false,
  /** Consecutive failed attempts, for retry backoff. */
  failures: 0,
};

/** Local changes not yet accepted by the server. */
export const pendingCount = () => (hasDb() ? TYPES.reduce((n, t) => n + Object.keys(S.dirty[t]).length, 0) : 0);

export function scheduleSync(ms = 600) { clearTimeout(Sync.timer); Sync.timer = setTimeout(doSync, ms); }
function setSyncState(s: SyncState) { Sync.state = s; refreshSyncBtn(); }

export async function doSync(): Promise<void> {
  if (!session || !hasDb()) return;
  if (Sync.running) { Sync.again = true; return; }
  Sync.running = true; setSyncState('syncing');
  const token = session.token;
  try {
    const { changes, sent, any } = collectChanges(S);
    if (any) {
      const res = await server.push(token, changes);
      if (!hasDb()) return;
      clearSent(S, sent);
      const errs = Object.values(res.id2error);
      if (errs.length) {
        Sync.full = true;
        if (errs.includes('NO_PERMISSION')) toast('Some changes were rejected: no permission');
      }
    }
    const cp = Sync.full ? 0 : S.checkpoint; Sync.full = false;
    const p = await server.pull(token, cp);
    if (!hasDb()) return;
    applyPull(S, p);
    if (ui.sel && !S.tasks[ui.sel]) ui.sel = null;
    saveLocal();
    Sync.last = Date.now(); Sync.failures = 0; setSyncState('ok');
    softRender(); checkReminders();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { toast(e.message); return signOut(true); }
    // No network (0), or the proxy cannot reach PocketBase (502-504). Edits stay queued on this device.
    const offline = (e instanceof ApiError && [0, 502, 503, 504].includes(e.status)) || (typeof navigator !== 'undefined' && !navigator.onLine);
    if (!offline) console.warn('sync failed', e);
    Sync.failures++;
    setSyncState(offline ? 'offline' : 'error');
    // Retry after 5 s, 10 s, 20 s … up to 2 min; 'online' and the 60 s timer also retry.
    scheduleSync(Math.min(120000, 5000 * 2 ** (Sync.failures - 1)));
  } finally {
    Sync.running = false;
    if (Sync.again) { Sync.again = false; scheduleSync(50); }
  }
}

let unsubscribe: (() => void) | null = null;
/** Listen for realtime pushes for the current session. */
export function subscribeSync() {
  unsubscribe?.();
  unsubscribe = session ? server.subscribe(session.token, {
    needSync: () => { scheduleSync(150); setTimeout(() => refreshGoogle(), 2000); },
    sessionGone: () => location.reload(),
  }) : null;
}

export function initSync() {
  onLocalChange(scheduleSync);
  setInterval(() => { if (session) scheduleSync(0); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) scheduleSync(0); });
  addEventListener('online', () => { if (session) scheduleSync(0); });
}
