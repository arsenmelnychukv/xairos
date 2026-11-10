/// <reference lib="webworker" />
/**
 * Service worker: precache the app shell so xairos opens offline, and serve
 * index.html for in-app navigations. /api is never cached: sync goes to the
 * network, and offline edits wait in IndexedDB. Reminder pushes from the
 * notifier (server/notifier) become notifications here.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/_\//] }));

// First install: control the open page right away, so it works offline without a reload.
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// The page asks the waiting worker to take over when the user accepts an update.
self.addEventListener('message', e => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

/** `act`: signed token the buttons send back (server/notifier/actions.ts). `goal`: a habit's daily goal. */
interface ReminderPush { title: string; body: string; tag: string; taskId: string; listId: string; habitId?: string; at: number; act?: string; goal?: number }
type NoteData = { taskId?: string; habitId?: string; act?: string };

/** Buttons: Complete and Snooze on a task, Done (or +1) on a habit. Browsers show up to two. */
function buttons(p: ReminderPush) {
  if (!p.act) return [];
  if (p.habitId) return [{ action: 'done', title: (p.goal || 1) > 1 ? '+1' : 'Done' }];
  return [{ action: 'complete', title: 'Complete' }, { action: 'snooze', title: 'Snooze 15 min' }];
}

const pad = (n: number) => String(n).padStart(2, '0');
const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Every push must show a notification: Safari revokes push for silent ones.
self.addEventListener('push', e => {
  let p: ReminderPush;
  try { p = e.data!.json(); } catch { return; }
  e.waitUntil(self.registration.showNotification(p.title, {
    body: p.body, tag: p.tag, data: { taskId: p.taskId, habitId: p.habitId, act: p.act } satisfies NoteData, timestamp: p.at,
    icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', actions: buttons(p),
  } as NotificationOptions));
});

/**
 * A button: the server applies it (open tabs hear about it through sync). If
 * that fails (offline, expired), show why and open the task instead.
 */
async function act(data: NoteData, action: string): Promise<boolean> {
  try {
    const res = await fetch('/api/xairos/push/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.act, action, today: localYmd() }),
    });
    if (res.ok) return true;
    const msg = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    await self.registration.showNotification('xairos', { body: msg || 'That did not work. Open xairos to try again.', tag: 'xairos-action' });
  } catch {
    await self.registration.showNotification('xairos', { body: 'Offline: open xairos to finish this.', tag: 'xairos-action' });
  }
  return false;
}

// Open the task: focus a xairos window if one is open, otherwise open one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data as NoteData | null;
  const id = data?.taskId, habit = !!data?.habitId;
  e.waitUntil((async () => {
    if (e.action && data?.act && await act(data, e.action)) return;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.focused) || wins[0];
    if (win) {
      await win.focus();
      if (habit) win.postMessage({ type: 'open-habits' });
      else if (id) win.postMessage({ type: 'open-task', id });
    } else await self.clients.openWindow(habit ? '/#/habits' : id ? '/?task=' + encodeURIComponent(id) : '/');
  })());
});
