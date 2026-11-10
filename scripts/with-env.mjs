#!/usr/bin/env node
// Run a command with KEY=value lines from an env file added to its environment
// (if the file exists). Values already in the environment win.
// Usage: node scripts/with-env.mjs <file> -- <command> [args…]
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const [file, sep, cmd, ...args] = process.argv.slice(2);
if (sep !== '--' || !cmd) { console.error('usage: with-env.mjs <file> -- <command> [args…]'); process.exit(2); }
const env = { ...process.env };
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const child = spawn(cmd, args, { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(sig ? 1 : code ?? 0));
