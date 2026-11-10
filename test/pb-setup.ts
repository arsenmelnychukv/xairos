/** Vitest global setup: start a throwaway PocketBase for the contract tests. */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

const root = resolve(import.meta.dirname, '..');
const bin = join(root, 'bin/pocketbase');

declare module 'vitest' {
  export interface ProvidedContext {
    pbUrl: string | null;
    /** Web Push settings the test PocketBase runs with. */
    pushEnv: { secret: string; publicKey: string; privateKey: string };
    /** Port the fake Google (test/google.test.ts) listens on; PocketBase points at it. */
    googlePort: number;
  }
}

export default async function setup(project: TestProject) {
  if (!existsSync(bin)) {
    console.warn('bin/pocketbase missing (run npm run pb:get): PocketBase contract tests are skipped');
    project.provide('pbUrl', null);
    project.provide('pushEnv', { secret: '', publicKey: '', privateKey: '' });
    project.provide('googlePort', 0);
    return;
  }
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const pushEnv = { secret: randomBytes(24).toString('base64url'), publicKey: ecdh.getPublicKey('base64url'), privateKey: ecdh.getPrivateKey('base64url') };
  project.provide('pushEnv', pushEnv);
  // Hooks use the app's parser through a generated bundle: rebuild it so tests run the current one.
  execSync('npx vite build -c vite.hooks.config.ts --logLevel error', { cwd: root, stdio: 'inherit' });
  const dir = mkdtempSync(join(tmpdir(), 'xairos-pb-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const googlePort = port + 1000;
  project.provide('googlePort', googlePort);
  const url = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(bin, [
    'serve', '--dir', dir, '--hooksDir', join(root, 'server/pb_hooks'),
    '--migrationsDir', join(root, 'server/pb_migrations'), '--http', `127.0.0.1:${port}`, '--hooksWatch=false',
  ], {
    env: {
      ...process.env, XAIROS_OPEN_SIGNUP: '1',
      // Push: test keys, and any host so a local fake push service is allowed.
      XAIROS_NOTIFIER_SECRET: pushEnv.secret, XAIROS_VAPID_PUBLIC: pushEnv.publicKey, XAIROS_PUSH_ANY_HOST: '1',
      // Google: a fake on googlePort stands in for accounts.google.com and oauth2.googleapis.com.
      XAIROS_GOOGLE_CLIENT_ID: 'test-client', XAIROS_GOOGLE_CLIENT_SECRET: 'test-secret', XAIROS_PUBLIC_URL: url,
      XAIROS_GOOGLE_AUTH_BASE: `http://127.0.0.1:${googlePort}`, XAIROS_GOOGLE_OAUTH_BASE: `http://127.0.0.1:${googlePort}`,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url + '/api/health')).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  project.provide('pbUrl', url);
  return () => { proc.kill(); rmSync(dir, { recursive: true, force: true }); };
}
