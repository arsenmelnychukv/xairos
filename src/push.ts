/**
 * Background reminders over Web Push. The notifier sidecar
 * (server/notifier) sends them; this file manages this browser's
 * subscription. One subscription per browser: the last account that turns
 * it on in this browser receives the pushes.
 *
 * iPhone: push works only in the Home Screen app (iOS 16.4+), and the
 * permission prompt must come from a tap, so enablePush runs from a menu click.
 */
import { lsGet, lsSet } from './lib/util';
import { me, prefs, server, session } from './store';
import { toast } from './ui/toast';

const flagKey = () => 'xairos.push.' + me();
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';

/** Push needs a service worker, so it exists only in production builds. */
export const pushSupported = () =>
  import.meta.env.PROD && !!server.webPush && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** This browser has background reminders on for the signed-in account. */
export const pushActive = () => pushSupported() && !!session && !!lsGet<boolean>(flagKey()) && Notification.permission === 'granted';

const keyBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** Subscribe (or reuse the subscription) and register it with the server. */
async function subscribe(): Promise<void> {
  const token = session!.token;
  const key = await server.webPush!.key(token);
  if (!key) throw new Error('Background reminders are not set up on this server.');
  const reg = await navigator.serviceWorker.ready;
  const want = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  // The server's key changed (keys were regenerated): the old subscription is useless.
  if (sub && !sameKey(sub.options.applicationServerKey, want)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await server.webPush!.subscribe(token, { endpoint: j.endpoint, keys: j.keys }, tz(), prefs.weekStart);
}

export async function enablePush() {
  if (!pushSupported()) {
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
    return toast(ios ? 'Add xairos to your Home Screen to get background reminders' : 'This browser cannot receive background reminders');
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') return toast(p === 'denied' ? 'Notifications are blocked in browser settings' : 'Notifications not enabled');
  try {
    await subscribe();
    lsSet(flagKey(), true);
    toast('Background reminders on');
  } catch (e) {
    toast((e as Error).message || 'Could not turn on background reminders');
  }
}

export async function disablePush(quiet = false) {
  if (!session) return;
  lsSet(flagKey(), false);
  if (!pushSupported()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await server.webPush!.unsubscribe(session.token, sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
    if (!quiet) toast('Background reminders off');
  } catch { /* offline: the server drops it when the push service reports it gone */ }
}

/**
 * On every start: report the current time zone, and replace a subscription
 * the browser dropped or rotated. Quiet: errors wait for the next start.
 */
export async function refreshPush() {
  if (!pushSupported() || !session || !lsGet<boolean>(flagKey())) return;
  if (Notification.permission !== 'granted') { lsSet(flagKey(), false); return; }
  try { await subscribe(); } catch { /* offline or server not set up */ }
}

/** Close this task's system notification once it was handled in the app. */
export async function closeTaskNotification(id: string) {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    for (const n of (await reg?.getNotifications({ tag: id })) || []) n.close();
  } catch { /* ignore */ }
}
