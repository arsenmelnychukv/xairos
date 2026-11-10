/**
 * Tokens for the buttons on a reminder notification (Complete, Snooze, Done).
 * One token names one task or habit and one user, and expires after a week.
 * PocketBase checks it in `pushAction` (server/pb_hooks/xairos_lib.js), with
 * the same shared secret: XAIROS_NOTIFIER_SECRET.
 */
import { createHmac } from 'node:crypto';

export const ACT_TTL_MS = 7 * 864e5;

/**
 * `due`: the task's due date when the push was sent. Complete then only acts
 * while the task still has that date, so tapping Complete on two devices
 * does not move a repeating task twice.
 */
export function actToken(secret: string, kind: 'task' | 'habit', id: string, user: string, now = Date.now(), due?: string | null): string {
  const payload: Record<string, unknown> = { k: kind, i: id, u: user, e: now + ACT_TTL_MS };
  if (due !== undefined) payload.d = due;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update('act1.' + body).digest('hex');
}
