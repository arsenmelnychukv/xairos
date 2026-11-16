/**
 * The dev demo account (dev-login#01): the mock backend seeds it in DEV builds
 * only, and PocketBase never has it.
 */
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { LocalServer, demoUser } from '../src/server/local';
import { PocketBaseServer } from '../src/server/pocketbase';

// Minimal in-memory localStorage for LocalServer in Node.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, String(v)), removeItem: k => void mem.delete(k),
  clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
} as Storage;

const pbUrl = inject('pbUrl');
const DEMO = { email: 'admin@xairos.local', password: '12345678' };

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllEnvs());

describe('dev demo user on the mock backend', () => {
  it('DEV: the demo user is configured and can sign in', async () => {
    const demo = demoUser();
    expect(demo).not.toBeNull();
    const s = await new LocalServer(0).login(demo!);
    expect(s.user.email).toBe(DEMO.email);
    expect(s.token).toBeTruthy();
  });

  it('production build: no demo user, and sign in with its credentials is refused', async () => {
    vi.stubEnv('DEV', false);
    expect(demoUser()).toBeNull();
    await expect(new LocalServer(0).login(DEMO)).rejects.toMatchObject({ status: 401 });
  });

  describe.skipIf(!pbUrl)('PocketBase never has the demo user', () => {
    it('DEV: the demo user is configured, but PocketBase refuses its credentials', async () => {
      expect(demoUser()).not.toBeNull();
      await expect(new PocketBaseServer(pbUrl!).login(DEMO)).rejects.toMatchObject({ status: 401 });
    });
  });

  it('DEV: sign up still rejects a 4-character password, and the demo user still signs in', async () => {
    const srv = new LocalServer(0);
    await expect(srv.signup({ name: 'New', email: 'new@xairos.test', password: '1234' }))
      .rejects.toMatchObject({ status: 400, message: 'Password must be at least 8 characters.' });
    await expect(srv.login(demoUser()!)).resolves.toMatchObject({ user: { email: DEMO.email } });
  });

  it('DEV: sign up still rejects a bad email, and the demo user still signs in', async () => {
    const srv = new LocalServer(0);
    await expect(srv.signup({ name: 'New', email: 'not-an-email', password: '12345678' }))
      .rejects.toMatchObject({ status: 400, message: 'Please enter a valid email.' });
    await expect(srv.login(demoUser()!)).resolves.toMatchObject({ user: { email: DEMO.email } });
  });
});
