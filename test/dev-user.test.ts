/** scripts/dev-user.mjs: guards, default password, and the dev user on a real PocketBase. */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, describe, expect, inject, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const pbUrl = inject('pbUrl');
const UNREACHABLE = 'http://127.0.0.1:1';
const EMAIL = 'admin@xairos.local';
// Never create the dev user with the default password: the shared test PocketBase must not hold it.
const TEST_PW = 'dev-user-test-pw';

function run(env: Record<string, string>, args: string[] = ['--dev-machine']) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !['NODE_ENV', 'XAIROS_PB_URL', 'XAIROS_DEV_PASSWORD'].includes(k)) base[k] = v;
  return spawnSync(process.execPath, ['scripts/dev-user.mjs', ...args], { cwd: root, env: { ...base, ...env }, encoding: 'utf8', timeout: 15000 });
}

async function login(password: string) {
  const r = await fetch(`${pbUrl}/api/xairos/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  return r.status;
}

describe('dev user script guards', () => {
  it('refuses to run without --dev-machine before any network call', () => {
    const r = run({ XAIROS_PB_URL: UNREACHABLE }, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--dev-machine/);
    expect(r.stderr).not.toMatch(/not reachable/);
    expect(r.stdout).not.toMatch(/Using the/);
  });

  it('checks the flag before NODE_ENV=production', () => {
    const r = run({ NODE_ENV: 'production', XAIROS_PB_URL: UNREACHABLE }, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--dev-machine/);
    expect(r.stderr).not.toMatch(/NODE_ENV=production/);
  });

  it('accepts only the exact --dev-machine flag', () => {
    const r = run({ XAIROS_PB_URL: UNREACHABLE }, ['--dev']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--dev-machine/);
    expect(r.stderr).not.toMatch(/not reachable/);
  });

  it('npm run dev:user passes --dev-machine', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev:user']).toContain('--dev-machine');
  });

  it('refuses NODE_ENV=production before any network call', () => {
    const r = run({ NODE_ENV: 'production', XAIROS_PB_URL: UNREACHABLE });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing to run with NODE_ENV=production/);
    expect(r.stderr).not.toMatch(/not reachable/);
  });

  it('refuses a non-local host by its parsed hostname', () => {
    const r = run({ XAIROS_PB_URL: 'http://example.com:8090' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing host "example.com"/);
    expect(r.stderr).not.toMatch(/not reachable/);
  });

  it('refuses a host that only contains 127.0.0.1 as a substring', () => {
    const r = run({ XAIROS_PB_URL: 'http://127.0.0.1.example.com:8090' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing host/);
  });

  it('refuses a URL that does not parse', () => {
    const r = run({ XAIROS_PB_URL: 'not a url' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not a valid URL/);
  });

  it('refuses XAIROS_DEV_PASSWORD shorter than 8 characters', () => {
    const r = run({ XAIROS_PB_URL: UNREACHABLE, XAIROS_DEV_PASSWORD: '1234' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/too short/);
    expect(r.stderr).not.toMatch(/not reachable/);
  });

  it('accepts localhost as a host (guard passes, then the network check fails)', () => {
    const r = run({ XAIROS_PB_URL: 'http://localhost:1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not reachable/);
  });
});

describe('dev user script, PocketBase unreachable', () => {
  it('uses the env password and does not print the default', () => {
    const r = run({ XAIROS_PB_URL: UNREACHABLE, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Using the password from XAIROS_DEV_PASSWORD/);
    expect(r.stdout).not.toMatch(/12345678/);
    expect(r.stderr).toMatch(/PocketBase is not reachable at http:\/\/127\.0\.0\.1:1 \(run `npm run pb`\)/);
  });

  it('uses the default password 12345678 when XAIROS_DEV_PASSWORD is unset', () => {
    const r = run({ XAIROS_PB_URL: UNREACHABLE });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Using the default dev password 12345678/);
    expect(r.stderr).toMatch(/not reachable/);
  });
});

describe.skipIf(!pbUrl)('dev user script with PocketBase', () => {
  it('first run creates the user with the env password', async () => {
    const r = run({ XAIROS_PB_URL: pbUrl!, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(EMAIL);
    expect(await login(TEST_PW)).toBe(200);
  });

  it('second identical run exits 0 and reports the user exists', () => {
    const r = run({ XAIROS_PB_URL: pbUrl!, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already exists/);
  });

  it('a run with the default password does not change the existing password', async () => {
    const r = run({ XAIROS_PB_URL: pbUrl! });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already exists/);
    expect(r.stdout).toMatch(/Using the default dev password 12345678/);
    expect(await login(TEST_PW)).toBe(200);
    expect(await login('12345678')).not.toBe(200);
  });
});

// Async spawn: the stub server lives in this process, so the script must not block the event loop.
function runAsync(env: Record<string, string>, args: string[] = ['--dev-machine']) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !['NODE_ENV', 'XAIROS_PB_URL', 'XAIROS_DEV_PASSWORD'].includes(k)) base[k] = v;
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done, fail) => {
    const child = spawn(process.execPath, ['scripts/dev-user.mjs', ...args], { cwd: root, env: { ...base, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error('dev-user script timed out')); }, 15000);
    child.on('error', (err) => { clearTimeout(timer); fail(err); });
    child.on('close', (status) => { clearTimeout(timer); done({ status, stdout, stderr }); });
  });
}

type Answer = { status: number; headers?: Record<string, string>; body?: string };

// Stub PocketBase on 127.0.0.1, random port. Records "METHOD path" for every request it receives.
async function startStub(answer: (base: string, method: string, path: string) => Answer) {
  const requests: string[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const path = req.url ?? '';
      const method = req.method ?? '';
      requests.push(`${method} ${path}`);
      const a = answer(url, method, path);
      res.writeHead(a.status, { 'content-type': 'application/json', ...a.headers });
      res.end(a.body ?? '{}');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stubs.push(server);
  return { url, requests };
}

const stubs: Server[] = [];

describe('dev user script against a stub server', () => {
  afterEach(async () => {
    await Promise.all(stubs.splice(0).map((s) => new Promise<void>((done) => {
      s.closeAllConnections();
      s.close(() => done());
    })));
  });

  it('signup 403 then login 200 exits 0 and reports the user exists', async () => {
    const stub = await startStub((_base, _method, path) => (path === '/api/xairos/signup' ? { status: 403 } : { status: 200 }));
    const r = await runAsync({ XAIROS_PB_URL: stub.url, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already exists/);
    expect(stub.requests).toEqual(['POST /api/xairos/signup', 'POST /api/xairos/login']);
  });

  it('signup 403 then login 400 exits 1 with the sign-up closed message', async () => {
    const stub = await startStub((_base, _method, path) => (path === '/api/xairos/signup' ? { status: 403 } : { status: 400 }));
    const r = await runAsync({ XAIROS_PB_URL: stub.url, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Sign-up is closed/);
    expect(stub.requests).toEqual(['POST /api/xairos/signup', 'POST /api/xairos/login']);
  });

  it('without --dev-machine sends no request to the server', async () => {
    const stub = await startStub(() => ({ status: 200 }));
    const r = await runAsync({ XAIROS_PB_URL: stub.url, XAIROS_DEV_PASSWORD: TEST_PW }, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--dev-machine/);
    expect(stub.requests).toEqual([]);
  });

  it('does not follow a 307 redirect from signup', async () => {
    const stub = await startStub((base, _method, path) => (path === '/api/xairos/signup'
      ? { status: 307, headers: { location: `${base}/redirected` } }
      : { status: 404 }));
    const r = await runAsync({ XAIROS_PB_URL: stub.url, XAIROS_DEV_PASSWORD: TEST_PW });
    expect(r.status).toBe(1);
    expect(stub.requests).toEqual(['POST /api/xairos/signup']);
  });
});
