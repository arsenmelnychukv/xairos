/** Password brute-force protection on PocketBase (per-account lockout, built-in login off). */
import { describe, expect, inject, it } from 'vitest';
import { PocketBaseServer } from '../src/server/pocketbase';
import { randHex } from '../src/lib/util';

const pbUrl = inject('pbUrl');

describe.skipIf(!pbUrl)('login protection', () => {
  const srv = new PocketBaseServer(pbUrl!);

  it('locks an account after 10 wrong passwords, other accounts unaffected', async () => {
    const pw = randHex(12), email = `lock-${randHex(4)}@xairos.test`, other = `free-${randHex(4)}@xairos.test`;
    await srv.signup({ name: 'Lock', email, password: pw });
    await srv.signup({ name: 'Free', email: other, password: pw });
    for (let i = 0; i < 10; i++) await expect(srv.login({ email, password: 'wrong-' + i })).rejects.toMatchObject({ status: 401 });
    // Locked now: even the right password waits.
    await expect(srv.login({ email, password: pw })).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Try again in 15 minutes/) });
    expect((await srv.login({ email: other, password: pw })).user.name).toBe('Free');
  });

  it('PocketBase\'s own password login is off', async () => {
    const pw = randHex(12), email = `pb-${randHex(4)}@xairos.test`;
    await srv.signup({ name: 'Pb', email, password: pw });
    const r = await fetch(pbUrl + '/api/collections/users/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) });
    expect(r.ok).toBe(false);
  });
});
