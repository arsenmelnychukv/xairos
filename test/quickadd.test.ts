/** Apple Shortcuts quick add (step 11): API tokens and POST /api/xairos/quick-add on PocketBase. */
import { describe, expect, inject, it } from 'vitest';
import { PocketBaseServer } from '../src/server/pocketbase';
import { randHex } from '../src/lib/util';
import { parseQuick } from '../src/parser';

const pbUrl = inject('pbUrl');

describe('parser with an explicit today', () => {
  it('anchors relative dates on the given day, not the clock', () => {
    const p = parseQuick('Pay rent tomorrow 9am', new Date(2026, 0, 31));
    expect([p.title, p.due, p.time]).toEqual(['Pay rent', '2026-02-01', '09:00']);
    expect(parseQuick('Plan next week', new Date(2026, 10, 5)).due).toBe('2026-11-09'); // Thu → next Monday
  });
});

describe.skipIf(!pbUrl)('quick add with an API token', () => {
  const srv = new PocketBaseServer(pbUrl!);
  const add = (token: string | null, body: unknown) => fetch(pbUrl + '/api/xairos/quick-add', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body),
  });

  it('creates a parsed task in the Inbox or a named list; tokens are listed without the secret and can be revoked', async () => {
    const a = await srv.signup({ name: 'Ann', email: `ann-${randHex(4)}@xairos.test`, password: randHex(12) });
    const b = await srv.signup({ name: 'Bob', email: `bob-${randHex(4)}@xairos.test`, password: randHex(12) });
    const t = await srv.tokens!.create(a.token, 'iPhone');
    expect(t.token).toMatch(/^kai_[A-Za-z0-9]{32}$/);
    const listed = await srv.tokens!.list(a.token);
    expect(listed).toEqual([expect.objectContaining({ id: t.id, name: 'iPhone', prefix: t.token.slice(0, 8), lastUsed: 0 })]);
    expect(JSON.stringify(listed)).not.toContain(t.token);
    expect(await srv.tokens!.list(b.token)).toEqual([]);

    // No token, a wrong one, or a user session token: refused.
    expect((await add(null, { text: 'x' })).status).toBe(401);
    expect((await add('kai_' + 'x'.repeat(32), { text: 'x' })).status).toBe(401);
    expect((await add(a.token, { text: 'x' })).status).toBe(401);
    expect((await add(t.token, { text: '  ' })).status).toBe(400);
    // The habit routes (N5) take the same token, and only that token.
    const habits = (token: string | null, path = '', body?: unknown) => fetch(pbUrl + '/api/xairos/habits' + path, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    expect((await habits(null)).status).toBe(401);
    expect((await habits(a.token)).status).toBe(401);
    expect((await habits(null, '/x/check', { action: 'done' })).status).toBe(401);
    expect((await habits(a.token, '/x/check', { action: 'done' })).status).toBe(401);
    expect(await (await habits(t.token)).json()).toEqual([]);

    const r = await add(t.token, { text: 'Buy milk tomorrow 9am !high #home', date: '2026-11-05' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ title: 'Buy milk', due: '2026-11-06', time: '09:00', list: 'Inbox', message: 'Added “Buy milk” · tomorrow at 09:00 to Inbox.' });
    const pulled = (await srv.pull(a.token, 0)).tasks.find(x => x.id === j.id)!;
    expect(pulled).toMatchObject({ listId: 'inbox-' + a.user.id, priority: 5, tags: ['home'], reminders: [0], createdBy: a.user.id });

    // ^List picks one of your lists by name; someone else's list falls back to the Inbox.
    const work = 'work-' + randHex(3), bobs = 'bobs-' + randHex(3);
    await srv.push(a.token, { lists: [{ id: work, name: 'Work', color: '0,0,0', ownerId: a.user.id, members: {}, order: 1, mtime: 1 }] });
    await srv.push(b.token, { lists: [{ id: bobs, name: 'Secret', color: '0,0,0', ownerId: b.user.id, members: {}, order: 1, mtime: 1 }] });
    expect(await (await add(t.token, { text: 'Report ^work' })).json()).toMatchObject({ list: 'Work' });
    expect((await srv.pull(a.token, 0)).tasks.some(x => x.title === 'Report' && x.listId === work)).toBe(true);
    expect(await (await add(t.token, { text: 'Snoop ^Secret' })).json()).toMatchObject({ list: 'Inbox' });
    expect((await srv.pull(b.token, 0)).tasks.some(x => x.title === 'Snoop')).toBe(false);

    expect((await srv.tokens!.list(a.token))[0]!.lastUsed).toBeGreaterThan(0);
    await expect(srv.tokens!.revoke(b.token, t.id)).rejects.toMatchObject({ status: 404 }); // not Bob's
    await srv.tokens!.revoke(a.token, t.id);
    expect((await add(t.token, { text: 'Too late' })).status).toBe(401);
  });
});
