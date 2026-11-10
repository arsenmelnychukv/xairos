/**
 * Google Calendar in the app: connect and disconnect, and the
 * events read from your Google calendars, cached per account so the
 * calendar shows them offline too. The server's worker does the syncing.
 */
import type { ExtEvent, GoogleStatus } from './server/adapter';
import { esc, lsGet, lsSet } from './lib/util';
import { me, server, session, ui } from './store';
import { deviceTz } from './lib/tz';
import { $ } from './lib/util';
import { closePop, popover } from './ui/popover';
import { toast } from './ui/toast';
import { render } from './app';

interface Cache { status: GoogleStatus | null; events: ExtEvent[]; eventsAt: number }
const key = () => 'xairos.gcal.' + me();
let C: Cache | null = null, owner = '';

function cache(): Cache {
  if (!C || owner !== me()) { owner = me(); C = lsGet<Cache>(key()) || { status: null, events: [], eventsAt: 0 }; }
  return C;
}
const save = () => { if (C) lsSet(key(), C); };

/** Events from Google for the calendar (empty when not connected). */
export const googleEvents = (): ExtEvent[] => (session && cache().status?.connected ? cache().events : []);
export const googleStatus = () => (session ? cache().status : null);

let busy = false, lastCheck = 0;
/** Fetch status, and the events when they changed on the server. Quiet when offline. */
export async function refreshGoogle(force = false) {
  if (!session || !server.google || busy) return;
  if (!force && Date.now() - lastCheck < 15000) return;
  busy = true; lastCheck = Date.now();
  try {
    const c = cache(), token = session.token;
    const status = await server.google.status(token);
    let changed = JSON.stringify(status) !== JSON.stringify(c.status);
    c.status = status;
    if (!status.connected) { if (c.events.length) { c.events = []; changed = true; } }
    else if (force || status.eventsAt !== c.eventsAt) {
      const r = await server.google.events(token);
      c.events = r.events; c.eventsAt = r.eventsAt; changed = true;
    }
    if (changed) { save(); if (ui.route === 'calendar') render(); }
  } catch { /* offline: keep the cache */ }
  finally { busy = false; }
}

/**
 * Google sent the browser back (via the server's callback) with a code and
 * state in the hash. Finish the sign-in with this session; the server checks
 * the state was started by this user.
 */
export async function handleGoogleReturn() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const code = q.get('google_code'), state = q.get('google_state'), err = q.get('google_error');
  if (!code && !err) return;
  history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
  if (err || !code || !state || !session || !server.google) { toast(err === 'access_denied' ? 'Google Calendar was not connected' : 'Google sign-in did not finish. Try again.'); return; }
  try {
    await server.google.finish(session.token, code, state);
    toast('Google Calendar connected. Tasks appear there within a minute.');
    refreshGoogle(true);
  } catch (e) { toast((e as Error).message); }
}

async function connect() {
  const g = server.google!, token = session!.token;
  try {
    const r = await g.authUrl(token, deviceTz());
    if (!r.manual) { location.href = r.url; return; }
    // Fallback: Google returns to a loopback address that does not load. The user copies it here.
    window.open(r.url, '_blank', 'noopener');
    const p = popover($('#acct-btn'), `<h4>Finish connecting</h4>
      <p class="hint" style="margin:0 8px 8px">After you allow access, Google opens a page that does not load. Copy that page's address and paste it here.</p>
      <input class="dlg-input" id="gc-url" placeholder="http://127.0.0.1/?state=…&code=…">
      <div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok>Connect</button></div>`, 320);
    const inp = $<HTMLInputElement>('#gc-url', p); inp.focus();
    $('[data-x]', p).onclick = closePop;
    $('[data-ok]', p).onclick = async () => {
      let code = '', state = '';
      try { const u = new URL(inp.value.trim()); code = u.searchParams.get('code') || ''; state = u.searchParams.get('state') || ''; } catch { /* not a URL */ }
      if (!code || !state) { toast('That address has no sign-in code'); return; }
      try { await g.finish(token, code, state); closePop(); toast('Google Calendar connected'); refreshGoogle(true); }
      catch (e) { toast((e as Error).message); }
    };
  } catch (e) { toast((e as Error).message); }
}

async function disconnect() {
  if (!confirm('Disconnect Google Calendar? xairos stops updating its calendar in Google and stops showing your Google events. The "xairos" calendar stays in Google; delete it there if you like.')) return;
  try { await server.google!.disconnect(session!.token); C = { status: null, events: [], eventsAt: 0 }; save(); refreshGoogle(true); render(); toast('Google Calendar disconnected'); }
  catch (e) { toast((e as Error).message); }
}

/** The Google Calendar panel in the account menu. */
export function googleMenu(anchor: Element) {
  const s = googleStatus();
  const when = (ms: number) => ms ? new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'not yet';
  const body = !server.google ? '<p class="hint">This server has no Google Calendar support.</p>'
    : !s ? '<p class="hint">Checking…</p>'
    : !s.configured ? '<p class="hint">Not set up on this server yet. See "Google Calendar" in the README.</p>'
    : !s.connected ? `<p class="hint">xairos puts your timed tasks in a "xairos" calendar in Google, and shows your Google events here.</p><div class="btns"><button class="btn pri" data-gc>Connect Google</button></div>`
    : `<p class="hint">Connected as <b>${esc(s.email || 'your Google account')}</b>.<br>Events last read: ${esc(when(s.eventsAt))}.</p>
       ${s.error ? `<p class="err">${esc(s.error)}</p><div class="btns"><button class="btn pri" data-gc>Connect again</button></div>` : ''}
       <div class="btns"><button class="btn sec" data-gd>Disconnect</button></div>`;
  const p = popover(anchor, `<h4>Google Calendar</h4>${body}`, 300);
  p.querySelector<HTMLElement>('[data-gc]')?.addEventListener('click', () => { closePop(); connect(); });
  p.querySelector<HTMLElement>('[data-gd]')?.addEventListener('click', () => { closePop(); disconnect(); });
  refreshGoogle(true);
}

export function initGoogle() {
  setInterval(() => refreshGoogle(), 5 * 60000);
  addEventListener('focus', () => refreshGoogle());
}
