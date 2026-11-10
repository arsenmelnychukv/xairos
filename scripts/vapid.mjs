#!/usr/bin/env node
// Create server/.env with Web Push (VAPID) keys and the notifier's shared
// secret, or add the ones missing. Existing values are never replaced: new
// VAPID keys would cut off every device that already subscribed.
// Usage: node scripts/vapid.mjs [path] [mailto:you@example.com]
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] || 'server/.env';
const subject = process.argv[3] || 'mailto:admin@example.com';
const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
const set = new Set([...have.matchAll(/^([A-Z_]+)=/gm)].map(m => m[1]));
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const add = [];
if (!set.has('XAIROS_VAPID_PUBLIC') && !set.has('XAIROS_VAPID_PRIVATE')) {
  add.push(`XAIROS_VAPID_PUBLIC=${ecdh.getPublicKey().toString('base64url')}`, `XAIROS_VAPID_PRIVATE=${ecdh.getPrivateKey().toString('base64url')}`);
}
if (!set.has('XAIROS_VAPID_SUBJECT')) add.push(`XAIROS_VAPID_SUBJECT=${subject}`);
if (!set.has('XAIROS_NOTIFIER_SECRET')) add.push(`XAIROS_NOTIFIER_SECRET=${randomBytes(32).toString('base64url')}`);
if (!add.length) { console.log(`${file}: all keys present, nothing changed`); process.exit(0); }
writeFileSync(file, (have && !have.endsWith('\n') ? have + '\n' : have) + add.join('\n') + '\n', { mode: 0o600 });
console.log(`${file}: added ${add.map(l => l.split('=')[0]).join(', ')}`);
