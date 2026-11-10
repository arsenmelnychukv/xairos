/**
 * Minimal Web Push sender on node:crypto, no dependencies.
 * - Payload encryption: RFC 8291 with the aes128gcm content coding (RFC 8188).
 * - Sender identity: VAPID (RFC 8292), an ES256 JWT signed with our P-256 key.
 */
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

export interface VapidKeys { publicKey: string; privateKey: string; subject: string }
export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }
export type SendResult = { ok: true } | { ok: false; status: number; gone: boolean; body: string };

/** Push services we send to (also checked by PocketBase on subscribe). */
export const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function pushEndpointOk(url: string, anyHost = process.env.XAIROS_PUSH_ANY_HOST === '1'): boolean {
  try {
    const u = new URL(url);
    if (anyHost) return u.protocol === 'https:' || u.protocol === 'http:';
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (u.port === '' || u.port === '443') && PUSH_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

/** A new P-256 key pair, base64url: public is the 65-byte uncompressed point. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** `Authorization` header value for a push service origin. Valid for 12 hours. */
export function vapidAuth(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const pub = unb64u(keys.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const sig = sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Encrypt one payload for one subscription: a single aes128gcm record. */
export function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Buffer {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  if (uaPub.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (only) record.
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

/**
 * Send one push. 404/410 mean the subscription is gone (the user turned
 * notifications off or the browser dropped it): the caller deletes it.
 */
export async function sendPush(sub: PushSubscriptionKeys, payload: unknown, keys: VapidKeys, opts: { ttl?: number; urgency?: 'normal' | 'high'; topic?: string } = {}): Promise<SendResult> {
  if (!pushEndpointOk(sub.endpoint)) return { ok: false, status: 0, gone: true, body: 'push service not allowed' };
  let body: Buffer;
  try { body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.p256dh, sub.auth); }
  catch (e) { return { ok: false, status: 0, gone: true, body: (e as Error).message }; } // corrupt keys: never deliverable
  const headers: Record<string, string> = {
    Authorization: vapidAuth(sub.endpoint, keys),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 6 * 3600),
    Urgency: opts.urgency ?? 'high',
  };
  // A topic replaces an undelivered push with the same topic (max 32 base64url chars).
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(15000) });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, body: (await res.text().catch(() => '')).slice(0, 300) };
}
