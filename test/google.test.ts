/**
 * Google Calendar (step 10) against a fake Google: the sign-in through
 * PocketBase, the worker writing timed tasks to a "xairos" calendar, and
 * reading the user's other calendars back.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PocketBaseServer } from '../src/server/pocketbase';
import { randHex } from '../src/lib/util';
import type { Task } from '../src/types';
import { Notifier } from '../server/notifier/main';
import { eventFor } from '../server/notifier/google';
import { extInRange } from '../src/calendar';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't', title: 'T', desc: '', listId: 'L', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u', ...o,
});

describe('event mapping', () => {
  it('a floating task uses the user zone; a pinned one its own; the end can cross midnight', () => {
    const e = eventFor(task({ id: 'a', title: 'Call', due: '2026-11-05', time: '23:30', dur: 60 }), 'Work', 'Europe/Berlin');
    expect(e.start).toEqual({ dateTime: '2026-11-05T23:30:00', timeZone: 'Europe/Berlin' });
    expect(e.end).toEqual({ dateTime: '2026-11-06T00:30:00', timeZone: 'Europe/Berlin' });
    expect(e.extendedProperties!.private!.xairosTask).toBe('a');
    const p = eventFor(task({ id: 'b', due: '2026-11-05', time: '15:00', tz: 'America/New_York' }), undefined, 'Europe/Berlin');
    expect(p.start!.timeZone).toBe('America/New_York');
    expect(p.end!.dateTime).toBe('2026-11-05T15:30:00'); // default 30 min
  });

  it('the hash changes only when what Google shows changes', () => {
    const a = eventFor(task({ due: '2026-11-05', time: '09:00' }), 'Work', 'UTC');
    const b = eventFor(task({ due: '2026-11-05', time: '09:00', priority: 5, tags: ['x'] }), 'Work', 'UTC');
    const c = eventFor(task({ due: '2026-11-05', time: '09:15' }), 'Work', 'UTC');
    expect(b.extendedProperties!.private!.xairosHash).toBe(a.extendedProperties!.private!.xairosHash);
    expect(c.extendedProperties!.private!.xairosHash).not.toBe(a.extendedProperties!.private!.xairosHash);
  });

  it('places Google events on local days: all-day spans, overnight timed events on both days', () => {
    const at = (s: string) => new Date(s).getTime();
    const evs = [
      { id: '1', cal: 'c', calName: 'C', color: '#f00', title: 'Trip', date: '2026-11-04', endDate: '2026-11-07' },
      { id: '2', cal: 'c', calName: 'C', color: '#f00', title: 'Late', start: at('2026-11-05T22:00'), end: at('2026-11-06T01:00') },
    ];
    const p = extInRange(evs, '2026-11-05', '2026-11-06');
    expect(p.filter(x => x.ev.id === '1').map(x => x.day)).toEqual(['2026-11-05', '2026-11-06']);
    expect(p.filter(x => x.ev.id === '2').map(x => [x.day, x.start, x.end])).toEqual([['2026-11-05', 1320, 1440], ['2026-11-06', 0, 60]]);
  });
});

// ---------- fake Google ----------

interface FakeEvent { id: string; [k: string]: unknown }
function fakeGoogle() {
  const g = {
    calendars: new Map<string, { summary: string; events: Map<string, FakeEvent> }>(),
    access: 'acc-1', refresh: 'ref-1', revoked: [] as string[], calls: [] as string[], n: 0,
    server: null as unknown as Server,
  };
  g.calendars.set('primary@x', { summary: 'Ann', events: new Map([['e1', { id: 'e1', summary: 'Dentist', start: { dateTime: '2026-11-05T10:00:00Z' }, end: { dateTime: '2026-11-05T11:00:00Z' }, htmlLink: 'https://calendar.google.com/e1' }], ['e2', { id: 'e2', summary: 'Holiday', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } }]]) });
  const idToken = 'h.' + Buffer.from(JSON.stringify({ email: 'ann@mail.test' })).toString('base64url') + '.s';
  g.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c).on('end', () => {
      const url = new URL(req.url!, 'http://x'), path = url.pathname, m = req.method!;
      g.calls.push(`${m} ${path}`);
      const send = (code: number, body?: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body)); };
      if (path === '/token') {
        const f = new URLSearchParams(raw);
        if (f.get('client_secret') !== 'test-secret') return send(401, { error: 'invalid_client' });
        if (f.get('grant_type') === 'authorization_code') return f.get('code') === 'good-code' ? send(200, { access_token: g.access, refresh_token: g.refresh, expires_in: 3600, id_token: idToken }) : send(400, { error: 'invalid_grant' });
        if (f.get('refresh_token') !== g.refresh) return send(400, { error: 'invalid_grant' });
        g.access = 'acc-' + ++g.n; return send(200, { access_token: g.access, expires_in: 3600 });
      }
      if (path === '/revoke') { g.revoked.push(url.searchParams.get('token')!); return send(200, {}); }
      if (req.headers.authorization !== 'Bearer ' + g.access) return send(401, { error: { message: 'bad token' } });
      if (path === '/users/me/calendarList') return send(200, { items: [...g.calendars].map(([id, c]) => ({ id, summary: c.summary, backgroundColor: '#039be5' })) });
      if (path === '/calendars' && m === 'POST') { const id = 'xairos-' + randHex(3) + '@group'; g.calendars.set(id, { summary: JSON.parse(raw).summary, events: new Map() }); return send(200, { id }); }
      const cm = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(path);
      if (!cm) return send(404, {});
      const cal = g.calendars.get(decodeURIComponent(cm[1]!));
      if (!cal) return send(404, { error: { message: 'Not Found' } });
      if (!cm[2]) return send(200, { id: cm[1] });
      const eid = cm[3] && decodeURIComponent(cm[3]);
      if (!eid && m === 'GET') return send(200, { items: [...cal.events.values()] });
      if (!eid && m === 'POST') { const id = 'ev' + ++g.n; cal.events.set(id, { ...JSON.parse(raw), id }); return send(200, { id }); }
      if (!cal.events.has(eid!)) return send(404, { error: { message: 'Not Found' } });
      if (m === 'PUT') { cal.events.set(eid!, { ...JSON.parse(raw), id: eid }); return send(200, { id: eid }); }
      if (m === 'DELETE') { cal.events.delete(eid!); res.writeHead(204).end(); return; }
      return send(405, {});
    });
  });
  return g;
}

const pbUrl = inject('pbUrl'), pushEnv = inject('pushEnv'), googlePort = inject('googlePort');

describe.skipIf(!pbUrl)('Google Calendar with PocketBase', () => {
  const srv = new PocketBaseServer(pbUrl!);
  const g = fakeGoogle();
  const base = `http://127.0.0.1:${googlePort}`;
  beforeAll(() => new Promise<void>(r => g.server.listen(googlePort, '127.0.0.1', r)));
  afterAll(() => { g.server.close(); });
  const worker = () => new Notifier({
    pbUrl: pbUrl!, secret: pushEnv.secret, vapid: { ...pushEnv, subject: 'mailto:t@xairos.test' }, stateFile: null, log: () => {},
    google: { clientId: 'test-client', secret: 'test-secret', oauthBase: base, apiBase: base },
  });
  const xairosCal = () => [...g.calendars].find(([, c]) => c.summary === 'xairos');

  it('connects, writes timed tasks, follows edits, survives a restart, reads events, disconnects', async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    expect(await srv.google!.status(a.token)).toMatchObject({ configured: true, manual: false, connected: false });

    // Sign-in: Google sends the browser back to PocketBase with a code and the state.
    const { url } = await srv.google!.authUrl(a.token, 'Europe/Berlin');
    const auth = new URL(url);
    expect(auth.origin + auth.pathname).toBe(base + '/o/oauth2/v2/auth');
    expect(auth.searchParams.get('redirect_uri')).toBe(pbUrl + '/api/xairos/google/callback');
    expect(auth.searchParams.get('scope')).toContain('calendar.app.created');
    const state = auth.searchParams.get('state')!;
    // The callback has no session: it only hands code and state to the app.
    const back = await fetch(`${pbUrl}/api/xairos/google/callback?code=good-code&state=${state}`, { redirect: 'manual' });
    expect([back.status, back.headers.get('location')]).toEqual([302, `/#/calendar?google_code=good-code&google_state=${state}`]);
    expect((await srv.google!.status(a.token)).connected).toBe(false);
    expect((await fetch(`${pbUrl}/api/xairos/google/callback?error=access_denied`, { redirect: 'manual' })).headers.get('location')).toBe('/#/calendar?google_error=access_denied');
    // Someone else cannot finish Ann's sign-in (a link they started cannot attach Ann's Google to them, and vice versa).
    const mallory = await srv.signup({ name: 'M', email: `m-${randHex(4)}@xairos.test`, password: randHex(12) });
    await expect(srv.google!.finish(mallory.token, 'good-code', state)).rejects.toMatchObject({ status: 400 });
    await expect(srv.google!.finish(a.token, 'good-code', 'nope')).rejects.toMatchObject({ status: 400 });
    expect(await srv.google!.finish(a.token, 'good-code', state)).toMatchObject({ connected: true, email: 'ann@mail.test', error: '' });
    // The state is single use.
    await expect(srv.google!.finish(a.token, 'good-code', state)).rejects.toMatchObject({ status: 400 });

    // Tasks: one timed, one untimed, one timed but done. Only the first goes to Google.
    const inbox = 'inbox-' + a.user.id, id = (s: string) => `${s}-${randHex(3)}`;
    const timed = task({ id: id('timed'), title: 'Standup', listId: inbox, due: '2026-11-05', time: '09:30', dur: 15, createdBy: a.user.id, mtime: 1 });
    await srv.push(a.token, { tasks: [timed, task({ id: id('untimed'), listId: inbox, due: '2026-11-05', createdBy: a.user.id, mtime: 1 }), task({ id: id('done'), listId: inbox, due: '2026-11-05', time: '08:00', done: true, createdBy: a.user.id, mtime: 1 })] });
    const w = worker();
    await w.tick();
    const [, cal] = xairosCal()!;
    expect([...cal.events.values()].map(e => [e.summary, (e.start as { dateTime: string; timeZone: string })])).toEqual([['Standup', { dateTime: '2026-11-05T09:30:00', timeZone: 'Europe/Berlin' }]]);
    const evId = [...cal.events.keys()][0];

    // Rename: the same event is updated. Nothing changes: nothing is sent.
    await srv.push(a.token, { tasks: [{ ...timed, title: 'Daily standup', mtime: 2, fm: undefined }] });
    await w.tick();
    expect([...cal.events.values()].map(e => [e.id, e.summary])).toEqual([[evId, 'Daily standup']]);
    const puts = g.calls.filter(c => c.startsWith('PUT')).length;
    await w.tick();
    expect(g.calls.filter(c => c.startsWith('PUT')).length).toBe(puts);

    // A restarted worker finds the event in Google instead of making a second one.
    await worker().tick();
    expect(cal.events.size).toBe(1);

    // Events from the user's other calendars reach the app; the xairos calendar is not read back.
    const ev = await srv.google!.events(a.token);
    expect(ev.events.map(e => e.title).sort()).toEqual(['Dentist', 'Holiday']);
    expect(ev.events.find(e => e.title === 'Holiday')).toMatchObject({ date: '2026-11-06', endDate: '2026-11-07' });
    expect(ev.events.find(e => e.title === 'Dentist')).toMatchObject({ start: Date.parse('2026-11-05T10:00:00Z'), link: 'https://calendar.google.com/e1' });

    // Completing the task removes its event.
    await srv.push(a.token, { tasks: [{ ...timed, title: 'Daily standup', done: true, mtime: 3, fm: undefined }] });
    await w.tick();
    expect(cal.events.size).toBe(0);

    // An expired access token is refreshed; a revoked grant shows as an error to reconnect.
    g.access = 'acc-expired-elsewhere'; // Google stops accepting the token early
    await w.tick();
    expect((await srv.google!.status(a.token)).error).toBe('');
    g.access = 'acc-gone'; g.refresh = 'ref-revoked'; // the user removed xairos in their Google account
    await w.tick();
    expect((await srv.google!.status(a.token)).error).toMatch(/Connect again/);

    await srv.google!.disconnect(a.token);
    expect(g.revoked.length).toBe(1);
    expect(await srv.google!.status(a.token)).toMatchObject({ connected: false });
  });
});
