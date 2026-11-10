/**
 * Background reminders: time zones, Web Push crypto, the scheduler's rules,
 * and the notifier end to end against a real PocketBase and a fake push service.
 */
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { zonedEpoch } from '../src/lib/dates';
import { reminderTimes } from '../src/reminders';
import { PocketBaseServer } from '../src/server/pocketbase';
import { randHex } from '../src/lib/util';
import type { Habit, List, Task } from '../src/types';
import { Scheduler, type PushSub } from '../server/notifier/scheduler';
import { encryptPayload, pushEndpointOk, vapidAuth } from '../server/notifier/webpush';
import { Notifier } from '../server/notifier/main';
import { actToken } from '../server/notifier/actions';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Call Ann', desc: '', listId: 'L', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u1', ...o,
});
const list = (o: Partial<List> = {}): List => ({ id: 'L', name: 'Work', color: '0,0,0', ownerId: 'u1', members: {}, order: 0, ...o });
const sub = (o: Partial<PushSub> = {}): PushSub => ({ id: 's1', user: 'u1', endpoint: 'https://fcm.googleapis.com/x', p256dh: '', auth: '', tz: 'UTC', created: 0, ...o });

/** A browser's side of a subscription: keys, and RFC 8291 decryption. */
function fakeBrowser() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url'),
    decrypt(body: Buffer): unknown {
      const salt = body.subarray(0, 16), idlen = body[20]!, asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
      const shared = ecdh.computeSecret(asPub);
      const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
      return JSON.parse(plain.subarray(0, plain.length - 1).toString());
    },
  };
}

describe('time zones', () => {
  it('resolves a floating time in a given zone', () => {
    expect(new Date(zonedEpoch('2026-07-01', 9, 0, 'Europe/Berlin')).toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(new Date(zonedEpoch('2026-01-15', 9, 0, 'Europe/Berlin')).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(new Date(zonedEpoch('2026-11-05', 23, 30, 'America/New_York')).toISOString()).toBe('2026-11-06T04:30:00.000Z');
  });

  it('a time skipped by DST lands an hour later; a repeated one takes the first', () => {
    // Berlin, 29 Mar 2026: 02:00 jumps to 03:00. 25 Oct 2026: 03:00 falls back to 02:00.
    expect(new Date(zonedEpoch('2026-03-29', 2, 30, 'Europe/Berlin')).toISOString()).toBe('2026-03-29T01:30:00.000Z'); // 03:30 CEST
    expect(new Date(zonedEpoch('2026-10-25', 2, 30, 'Europe/Berlin')).toISOString()).toBe('2026-10-25T00:30:00.000Z'); // first 02:30, CEST
  });

  it('reminderTimes uses the zone, and 9:00 for untimed tasks', () => {
    const [r] = reminderTimes(task({ due: '2026-07-01', reminders: [15] }), 'Europe/Berlin');
    expect(new Date(r!.at).toISOString()).toBe('2026-07-01T06:45:00.000Z');
  });
});

describe('web push crypto', () => {
  it('encrypts a payload the browser can decrypt (RFC 8291)', () => {
    const br = fakeBrowser();
    const body = encryptPayload(Buffer.from(JSON.stringify({ title: 'Hi' })), br.p256dh, br.auth);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(br.decrypt(body)).toEqual({ title: 'Hi' });
  });

  it('signs a VAPID JWT for the push service origin (RFC 8292)', () => {
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const keys = { publicKey: ecdh.getPublicKey('base64url'), privateKey: ecdh.getPrivateKey('base64url'), subject: 'mailto:a@b.c' };
    const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 1_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(m[2]!, 'base64url').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'mailto:a@b.c' });
    const pub = ecdh.getPublicKey();
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3]!, 'base64url'))).toBe(true);
  });

  it('only sends to known push services', () => {
    expect(pushEndpointOk('https://fcm.googleapis.com/fcm/send/x', false)).toBe(true);
    expect(pushEndpointOk('https://web.push.apple.com/QO', false)).toBe(true);
    expect(pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/x', false)).toBe(true);
    expect(pushEndpointOk('https://evil.example/fcm.googleapis.com/', false)).toBe(false);
    expect(pushEndpointOk('https://fcm.googleapis.com.evil.example/x', false)).toBe(false);
    expect(pushEndpointOk('http://fcm.googleapis.com/x', false)).toBe(false);
    expect(pushEndpointOk('https://127.0.0.1/x', false)).toBe(false);
  });
});

describe('scheduler', () => {
  const at9 = Date.parse('2026-11-05T09:00:00Z');
  const make = (tasks: Task[], lists: List[], subs: PushSub[]) => {
    const s = new Scheduler({ floor: 1 });
    s.apply({ checkpoint: 1, lists, tasks, subs });
    return s;
  };

  it('sends a due reminder once, to every device of the user', () => {
    const s = make([task({ due: '2026-11-05', time: '09:00', reminders: [0] })], [list()], [sub(), sub({ id: 's2' })]);
    expect(s.due(at9 - 1000)).toHaveLength(0);
    const due = s.due(at9 + 1000);
    expect(due.map(d => d.sub.id)).toEqual(['s1', 's2']);
    expect(due[0]!.payload).toMatchObject({ title: 'Call Ann', body: 'Today, 9:00 AM · Work', tag: 't1' });
    due.forEach(d => s.mark(d.key));
    expect(s.due(at9 + 60000)).toHaveLength(0);
  });

  it('resolves floating times in each device zone', () => {
    const s = make([task({ due: '2026-11-05', time: '09:00', reminders: [0] })], [list()], [sub(), sub({ id: 'berlin', tz: 'Europe/Berlin' })]);
    expect(s.due(at9 - 36e5 + 1000).map(d => d.sub.id)).toEqual(['berlin']); // 09:00 in Berlin is 08:00 UTC
  });

  it('shared lists remind every member, assigned tasks only the assignee', () => {
    const L = list({ members: { u2: 'edit', u3: 'view' } });
    const subs = [sub(), sub({ id: 's2', user: 'u2' }), sub({ id: 's3', user: 'u3' }), sub({ id: 'x', user: 'stranger' })];
    const t = task({ due: '2026-11-05', time: '09:00', reminders: [0] });
    expect(make([t], [L], subs).due(at9).map(d => d.sub.id)).toEqual(['s1', 's2', 's3']);
    expect(make([{ ...t, assignee: 'u2' }], [L], subs).due(at9).map(d => d.sub.id)).toEqual(['s2']);
    expect(make([{ ...t, assignee: 'gone' }], [L], subs).due(at9)).toHaveLength(0);
  });

  it('skips done, deleted and removed tasks, late reminders, and times before the device subscribed', () => {
    const t = task({ due: '2026-11-05', time: '09:00', reminders: [0] });
    const s = make([t], [list()], [sub()]);
    expect(s.due(at9 + 7 * 36e5)).toHaveLength(0); // more than 6 h late
    s.apply({ checkpoint: 2, lists: [], tasks: [{ ...t, done: true }], subs: [sub()] });
    expect(s.due(at9)).toHaveLength(0);
    expect(make([t], [list()], [sub({ created: at9 + 1 })]).due(at9 + 1000)).toHaveLength(0);
    const first = new Scheduler({}, at9 + 1); // first start: no replay of what was due before
    first.apply({ checkpoint: 1, lists: [list()], tasks: [t], subs: [sub()] });
    expect(first.due(at9 + 1000)).toHaveLength(0);
  });

  it('habit reminders go to the owner while the habit is not done', () => {
    const h = { id: 'h1', name: 'Stretch', color: '0,0,0', checks: {}, order: 0, created: 1, ownerId: 'u1', remind: '09:00', goal: 3, unit: 'sets' } as Habit;
    const s = new Scheduler({ floor: 1 });
    s.apply({ checkpoint: 1, lists: [], tasks: [], habits: [h], subs: [sub(), sub({ id: 'x', user: 'u2' })] });
    const due = s.due(at9 + 1000);
    expect(due.map(d => d.sub.id)).toEqual(['s1']);
    expect(due[0]!.payload).toMatchObject({ title: 'Stretch', body: '0/3 sets today', habitId: 'h1' });
    s.apply({ checkpoint: 2, lists: [], tasks: [], habits: [{ ...h, checks: { '2026-11-05': 3 } }], subs: [sub()] });
    expect(s.due(at9 + 1000)).toHaveLength(0);
  });

  it('a moved task or a snooze reminds again', () => {
    const t = task({ due: '2026-11-05', time: '09:00', reminders: [0] });
    const s = make([t], [list()], [sub()]);
    s.due(at9).forEach(d => s.mark(d.key));
    s.apply({ checkpoint: 2, lists: [], tasks: [{ ...t, time: '10:00' }], subs: [sub()] });
    expect(s.due(at9 + 36e5)).toHaveLength(1);
    s.apply({ checkpoint: 3, lists: [], tasks: [{ ...t, due: null, snooze: at9 + 5 * 6e4 }], subs: [sub()] });
    expect(s.due(at9 + 5 * 6e4)[0]!.payload.body).toBe('Snoozed · Work');
  });
});

const pbUrl = inject('pbUrl');
const pushEnv = inject('pushEnv');

describe.skipIf(!pbUrl)('notifier with PocketBase', () => {
  const srv = new PocketBaseServer(pbUrl!);
  let fake: Server, base = '';
  const got: { path: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];
  const gonePaths = new Set<string>();
  beforeAll(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c)).on('end', () => {
        got.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(gonePaths.has(req.url!) ? 410 : 201).end();
      });
    });
    await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  });
  afterAll(() => { fake.close(); });

  const notifier = (now: number) => {
    process.env.XAIROS_PUSH_ANY_HOST = '1';
    const n = new Notifier({ pbUrl: pbUrl!, secret: pushEnv.secret, vapid: { ...pushEnv, subject: 'mailto:test@xairos.test' }, stateFile: null, log: () => {} });
    n.sched.state.floor = now - 36e5;
    return n;
  };

  it('guards the notifier routes with the shared secret', async () => {
    for (const secret of ['', 'wrong-secret-wrong-secret', pushEnv.secret.slice(0, -1) + '_']) {
      const r = await fetch(pbUrl + '/api/xairos/internal/changes?since=0', { headers: { 'X-xairos-Secret': secret } });
      expect(r.status).toBe(403);
    }
    expect((await fetch(pbUrl + '/api/xairos/internal/changes', { headers: { 'X-xairos-Secret': pushEnv.secret } })).status).toBe(200);
  });

  it('subscribing checks the keys and needs a session', async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    expect(await srv.webPush!.key(a.token)).toBe(pushEnv.publicKey);
    await expect(srv.webPush!.subscribe(a.token, { endpoint: base + '/x', keys: { p256dh: 'short', auth: 'x' } }, 'UTC')).rejects.toMatchObject({ status: 400 });
    await expect(srv.webPush!.subscribe('bad', { endpoint: base + '/x', keys: { p256dh: 'x', auth: 'x' } }, 'UTC')).rejects.toMatchObject({ status: 401 });
  });

  it('sends a due reminder once, encrypted, and drops subscriptions the push service says are gone', async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    const phone = fakeBrowser(), old = fakeBrowser();
    const id = randHex(4);
    await srv.webPush!.subscribe(a.token, { endpoint: `${base}/phone-${id}`, keys: { p256dh: phone.p256dh, auth: phone.auth } }, 'UTC');
    await srv.webPush!.subscribe(a.token, { endpoint: `${base}/old-${id}`, keys: { p256dh: old.p256dh, auth: old.auth } }, 'UTC');
    gonePaths.add(`/old-${id}`);

    // A task due two minutes from now (UTC wall time), reminding at the time.
    const at = Math.ceil(Date.now() / 6e4) * 6e4 + 6e4, d = new Date(at);
    const due = d.toISOString().slice(0, 10), time = d.toISOString().slice(11, 16);
    const inbox = 'inbox-' + a.user.id;
    await srv.push(a.token, { tasks: [task({ id: 'push-' + id, title: 'Water plants', listId: inbox, due, time, reminders: [0], createdBy: a.user.id, mtime: 1 })] });

    const n = notifier(at);
    expect(await n.tick(at - 1000)).toBe(0);
    expect(await n.tick(at + 1000)).toBe(1);
    const mine = got.filter(g => g.path.endsWith(id));
    expect(mine.map(g => g.path).sort()).toEqual([`/old-${id}`, `/phone-${id}`]);
    const hit = mine.find(g => g.path === `/phone-${id}`)!;
    expect(hit.headers['content-encoding']).toBe('aes128gcm');
    expect(hit.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(phone.decrypt(hit.body)).toMatchObject({ title: 'Water plants', body: expect.stringMatching(/^(Today|Tomorrow), \d+:\d\d [AP]M · Inbox$/), taskId: 'push-' + id });

    // Sent once; the gone subscription is deleted on the server.
    expect(await n.tick(at + 31000)).toBe(0);
    expect(got.filter(g => g.path.endsWith(id))).toHaveLength(2);
    const ch = await (await fetch(pbUrl + '/api/xairos/internal/changes?since=0', { headers: { 'X-xairos-Secret': pushEnv.secret } })).json();
    expect(ch.subs.map((s: PushSub) => s.endpoint).filter((e: string) => e.endsWith(id))).toEqual([`${base}/phone-${id}`]);

    // Unsubscribing removes the device.
    await srv.webPush!.unsubscribe(a.token, `${base}/phone-${id}`);
    const ch2 = await (await fetch(pbUrl + '/api/xairos/internal/changes?since=0', { headers: { 'X-xairos-Secret': pushEnv.secret } })).json();
    expect(ch2.subs.filter((s: PushSub) => s.endpoint.endsWith(id))).toHaveLength(0);
  });

  it('a subscription moves to the account that subscribed last', async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    const b = await srv.signup({ name: 'Bob', email: `bob-${randHex(4)}@xairos.test`, password: randHex(12) });
    const br = fakeBrowser(), ep = `${base}/shared-${randHex(4)}`;
    await srv.webPush!.subscribe(a.token, { endpoint: ep, keys: { p256dh: br.p256dh, auth: br.auth } }, 'UTC');
    await srv.webPush!.subscribe(b.token, { endpoint: ep, keys: { p256dh: br.p256dh, auth: br.auth } }, 'Europe/Berlin', 0);
    const ch = await (await fetch(pbUrl + '/api/xairos/internal/changes?since=0', { headers: { 'X-xairos-Secret': pushEnv.secret } })).json();
    expect(ch.subs.filter((s: PushSub) => s.endpoint === ep)).toEqual([expect.objectContaining({ user: b.user.id, tz: 'Europe/Berlin', weekStart: 0 })]);
    // Ann cannot remove Bob's subscription.
    await srv.webPush!.unsubscribe(a.token, ep);
    const ch2 = await (await fetch(pbUrl + '/api/xairos/internal/changes?since=0', { headers: { 'X-xairos-Secret': pushEnv.secret } })).json();
    expect(ch2.subs.filter((s: PushSub) => s.endpoint === ep)).toHaveLength(1);
  });
});

describe.skipIf(!pbUrl)('notification buttons', () => {
  const srv = new PocketBaseServer(pbUrl!);
  const act = (token: string, action: string, today = '2026-11-07') =>
    fetch(pbUrl + '/api/xairos/push/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, today }) });
  const setup = async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    return { a, inbox: 'inbox-' + a.user.id, id: randHex(4) };
  };
  const pulled = async (token: string) => srv.pull(token, 0);

  it('completes and snoozes a task with the signed token, no session needed', async () => {
    const { a, inbox, id } = await setup();
    await srv.push(a.token, { tasks: [task({ id: 'c-' + id, listId: inbox, due: '2026-11-07', time: '09:00', reminders: [0], createdBy: a.user.id, mtime: 1 })] });
    const tok = actToken(pushEnv.secret, 'task', 'c-' + id, a.user.id);
    const before = Date.now();
    const s = await act(tok, 'snooze');
    expect(s.status).toBe(200);
    let t = (await pulled(a.token)).tasks.find(x => x.id === 'c-' + id)!;
    expect(t.snooze).toBeGreaterThanOrEqual(before + 15 * 6e4 - 1000);
    expect((await act(tok, 'complete')).status).toBe(200);
    t = (await pulled(a.token)).tasks.find(x => x.id === 'c-' + id)!;
    expect(t).toMatchObject({ done: true, snooze: null });
    expect(t.fm!.done).toBeGreaterThan(1);
  });

  it('moves a repeating task to its next date and logs a done copy', async () => {
    const { a, inbox, id } = await setup();
    await srv.push(a.token, { tasks: [task({ id: 'r-' + id, listId: inbox, due: '2026-11-07', repeat: { freq: 'daily', interval: 1 }, items: [{ id: 'i', title: 'x', done: true }], createdBy: a.user.id, mtime: 1 } as Partial<Task>)] });
    expect((await act(actToken(pushEnv.secret, 'task', 'r-' + id, a.user.id), 'complete')).status).toBe(200);
    const ts = (await pulled(a.token)).tasks;
    expect(ts.find(x => x.id === 'r-' + id)).toMatchObject({ done: false, due: '2026-11-08', items: [{ done: false }], repeat: { done: 1 } });
    expect(ts.find(x => x.repeatOf === 'r-' + id)).toMatchObject({ done: true, due: '2026-11-07', repeat: null });
  });

  it('Complete on two devices moves a repeating task once', async () => {
    const { a, inbox, id } = await setup();
    await srv.push(a.token, { tasks: [task({ id: 'd-' + id, listId: inbox, due: '2026-11-07', repeat: { freq: 'daily', interval: 1 }, createdBy: a.user.id, mtime: 1 })] });
    const phone = actToken(pushEnv.secret, 'task', 'd-' + id, a.user.id, Date.now(), '2026-11-07');
    const laptop = actToken(pushEnv.secret, 'task', 'd-' + id, a.user.id, Date.now(), '2026-11-07');
    expect((await act(phone, 'complete')).status).toBe(200);
    expect(await (await act(laptop, 'complete')).json()).toMatchObject({ message: 'Already completed.' });
    const ts = (await pulled(a.token)).tasks;
    expect(ts.find(x => x.id === 'd-' + id)).toMatchObject({ due: '2026-11-08', repeat: { done: 1 } });
    expect(ts.filter(x => x.repeatOf === 'd-' + id)).toHaveLength(1);
  });

  it('checks in a habit for the device\'s day', async () => {
    const { a, id } = await setup();
    await srv.push(a.token, { habits: [{ id: 'h-' + id, name: 'Water', color: '0,0,0', checks: { '2026-11-07': 2 }, goal: 8, order: 0, created: 1, mtime: 1 } as Habit] });
    expect((await act(actToken(pushEnv.secret, 'habit', 'h-' + id, a.user.id), 'done')).status).toBe(200);
    expect((await pulled(a.token)).habits.find(x => x.id === 'h-' + id)!.checks['2026-11-07']).toBe(3);
  });

  it('refuses forged, expired and foreign tokens', async () => {
    const { a, inbox, id } = await setup();
    const b = await srv.signup({ name: 'Bob', email: `bob-${randHex(4)}@xairos.test`, password: randHex(12) });
    await srv.push(a.token, { tasks: [task({ id: 'f-' + id, listId: inbox, createdBy: a.user.id, mtime: 1 })] });
    const good = actToken(pushEnv.secret, 'task', 'f-' + id, a.user.id);
    expect((await act(actToken('another-secret-that-is-long', 'task', 'f-' + id, a.user.id), 'complete')).status).toBe(401);
    expect((await act(actToken(pushEnv.secret, 'task', 'f-' + id, a.user.id, Date.now() - 8 * 864e5), 'complete')).status).toBe(401);
    expect((await act(good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'), 'complete')).status).toBe(401);
    expect((await act(good, 'explode')).status).toBe(400);
    // Bob's token for Ann's Inbox task: he cannot write there.
    expect((await act(actToken(pushEnv.secret, 'task', 'f-' + id, b.user.id), 'complete')).status).toBe(403);
    expect((await pulled(a.token)).tasks.find(x => x.id === 'f-' + id)!.done).toBe(false);
  });
});
