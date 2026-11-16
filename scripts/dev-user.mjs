#!/usr/bin/env node
// Create the local dev user (admin@xairos.local) in a PocketBase on 127.0.0.1 or localhost.
// Refuses production and non-local hosts. Safe to run twice.
// The --dev-machine flag is required, so a server install cannot run it by accident.
// Usage: [XAIROS_PB_URL=http://127.0.0.1:8090] [XAIROS_DEV_PASSWORD=<8+ chars>] node scripts/dev-user.mjs --dev-machine
const EMAIL = 'admin@xairos.local';
const DEFAULT_PASSWORD = '12345678';
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!process.argv.slice(2).includes('--dev-machine')) fail('Refusing to run without --dev-machine: this creates an account with a known password; never use it on a server install.');

const url = process.env.XAIROS_PB_URL || 'http://127.0.0.1:8090';
const envPassword = process.env.XAIROS_DEV_PASSWORD;

if (process.env.NODE_ENV === 'production') fail('Refusing to run with NODE_ENV=production.');
let host;
try { host = new URL(url).hostname; } catch { fail(`XAIROS_PB_URL is not a valid URL: ${url}`); }
if (host !== '127.0.0.1' && host !== 'localhost') fail(`Refusing host "${host}": only 127.0.0.1 or localhost.`);
if (envPassword !== undefined && envPassword.length < 8) fail('XAIROS_DEV_PASSWORD is too short: the server needs 8 or more characters.');

const password = envPassword ?? DEFAULT_PASSWORD;
console.log(envPassword === undefined
  ? `Using the default dev password ${DEFAULT_PASSWORD} (set XAIROS_DEV_PASSWORD to change it).`
  : 'Using the password from XAIROS_DEV_PASSWORD.');

const post = (path, body) => fetch(`${url}/api/xairos/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  redirect: 'error',
});
const exists = () => { console.log(`${EMAIL} already exists; its password is unchanged by this run.`); process.exit(0); };

let res;
try {
  res = await post('signup', { name: 'Admin', email: EMAIL, password });
  // The server checks "sign-up closed" before "email taken", so a repeat run on a used database
  // answers 403. Probe with a login to tell that apart from a really closed sign-up.
  if (res.status === 403) {
    const login = await post('login', { email: EMAIL, password });
    if (login.status === 200) exists();
  }
} catch {
  fail(`PocketBase is not reachable at ${url} (run \`npm run pb\`).`);
}

if (res.status === 200) { console.log(`Dev login: ${EMAIL} / ${password}`); process.exit(0); }
if (res.status === 409) exists();
if (res.status === 403) fail('Sign-up is closed: start PocketBase with `XAIROS_OPEN_SIGNUP=1 npm run pb`. The dev user may already exist.');
const text = await res.text().catch(() => '');
fail(`Sign-up failed with status ${res.status}: ${text}`);
