/** Entry point: `node dist-server/notifier.mjs` (see npm run notifier). */
import { Notifier } from './main';

function env(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) { console.error(`Missing ${name}. Run: npm run vapid`); process.exit(1); }
  return v;
}

async function main() {
  const n = new Notifier({
    pbUrl: env('XAIROS_PB_URL', 'http://127.0.0.1:8090').replace(/\/$/, ''),
    secret: env('XAIROS_NOTIFIER_SECRET'),
    vapid: { publicKey: env('XAIROS_VAPID_PUBLIC'), privateKey: env('XAIROS_VAPID_PRIVATE'), subject: env('XAIROS_VAPID_SUBJECT') },
    stateFile: env('XAIROS_NOTIFIER_STATE', 'server/notifier_data/state.json'),
    // Google Calendar sync runs when the OAuth client is set (see README).
    google: process.env.XAIROS_GOOGLE_CLIENT_ID && process.env.XAIROS_GOOGLE_CLIENT_SECRET
      ? { clientId: process.env.XAIROS_GOOGLE_CLIENT_ID, secret: process.env.XAIROS_GOOGLE_CLIENT_SECRET, oauthBase: process.env.XAIROS_GOOGLE_OAUTH_BASE, apiBase: process.env.XAIROS_GOOGLE_API_BASE }
      : null,
  });
  console.log('xairos notifier: polling', process.env.XAIROS_PB_URL || 'http://127.0.0.1:8090', n.google ? '(with Google Calendar sync)' : '');
  let failing = false;
  for (;;) {
    try {
      const sent = await n.tick();
      if (sent) console.log(new Date().toISOString(), `sent ${sent} reminder${sent > 1 ? 's' : ''}`);
      if (failing) console.log('PocketBase reachable again');
      failing = false;
    } catch (e) {
      if (!failing) console.error(new Date().toISOString(), 'tick failed:', (e as Error).message);
      failing = true;
    }
    await new Promise(r => setTimeout(r, 30000));
  }
}

main();
