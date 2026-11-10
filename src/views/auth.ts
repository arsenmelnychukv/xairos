import type { Session } from '../types';
import { $, esc, lsDel, lsGet, uid } from '../lib/util';
import { TODAY, addDays, parseYmd, todayD, ymd } from '../lib/dates';
import { firstOccurrence } from '../recurrence';
import { COLORS, SESSION_KEY, backend, clearDb, closeLocal, loadLocal, me, newTask, saveSession, server, session, setSession, ui, upd } from '../store';
import { doSync, subscribeSync } from '../sync/engine';
import { I } from '../ui/icons';
import { readHash, render } from '../app';
import { disablePush } from '../push';
import { closePop, popover } from '../ui/popover';
import { toast } from '../ui/toast';

export function renderAuth(mode: 'signin' | 'signup' = 'signin', err = '') {
  $('#app').hidden = true;
  const a = $('#auth'); a.hidden = false;
  a.innerHTML = `<form class="auth-card" id="auth-form" novalidate>
    <div class="brand"><span class="logo">${I.check}</span>xairos</div>
    <div class="auth-sub">Plan your day. Keep every device in step.</div>
    <div class="tabs"><button type="button" data-m="signin" class="${mode === 'signin' ? 'on' : ''}">Sign in</button><button type="button" data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>
    ${mode === 'signup' ? `<label for="a-name">Name</label><input id="a-name" autocomplete="name" required>` : ''}
    <label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" required>
    <label for="a-pw">Password</label><input id="a-pw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required>
    <div class="err" id="a-err">${esc(err)}</div>
    <button class="btn pri" id="a-go">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    ${backend === 'local' ? '<div class="fine">Demo mode: accounts and sync run on a mock server stored in this browser. Open a second tab to see live sync; create a second account to try sharing.</div>' : ''}
  </form>`;
  a.querySelectorAll<HTMLElement>('[data-m]').forEach(b => b.onclick = () => renderAuth(b.dataset.m as 'signin' | 'signup'));
  $<HTMLFormElement>('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('#a-go'); btn.disabled = true; $('#a-err').textContent = '';
    try {
      const email = $<HTMLInputElement>('#a-email').value, password = $<HTMLInputElement>('#a-pw').value;
      const res = mode === 'signup'
        ? await server.signup({ name: $<HTMLInputElement>('#a-name').value, email, password })
        : await server.login({ email, password });
      await startSession(res, mode === 'signup');
    } catch (ex) { $('#a-err').textContent = (ex as Error).message; btn.disabled = false; }
  };
  setTimeout(() => (mode === 'signup' ? $('#a-name') : $('#a-email'))?.focus());
}

export async function startSession(res: Session, isNew: boolean) {
  setSession(res); saveSession();
  await loadLocal();
  subscribeSync();
  $('#auth').hidden = true; $('#app').hidden = false;
  await doSync();
  if (isNew) seedAccount();
  if (!location.hash) location.hash = '#/tasks/today'; else readHash();
  render();
}

async function endSession(erase: boolean) {
  await closeLocal(erase);
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  setSession(null); clearDb(); ui.sel = null;
  subscribeSync();
  $('#rem-stack').innerHTML = '';
}

export async function signOut(expired: boolean) {
  if (!expired) { await doSync(); await disablePush(true); try { await server.logout(session!.token); } catch { /* ignore */ } }
  if (lsGet<Session>(SESSION_KEY)?.token === session?.token) lsDel(SESSION_KEY);
  // An expired session keeps local data: signing in again pushes the queued edits.
  await endSession(!expired);
  renderAuth('signin', expired ? 'Please sign in again.' : '');
}

/** Delete the account for good, after the password and a typed confirmation. */
export function deleteAccountDialog(anchor: Element) {
  const p = popover(anchor, `
    <h4>Delete account</h4>
    <p class="hint">This erases your account, your lists and their tasks, habits and focus history on the server and this device. People you share lists with lose those lists. It cannot be undone. Export a backup first if you want to keep anything.</p>
    <input class="dlg-input" type="password" id="del-pw" placeholder="Your password" autocomplete="current-password">
    <input class="dlg-input" id="del-ok" placeholder="Type DELETE to confirm" autocomplete="off">
    <div class="btns"><button class="btn pri danger" id="del-go" disabled>Delete for good</button></div>`, 300);
  const pw = $<HTMLInputElement>('#del-pw', p), ok = $<HTMLInputElement>('#del-ok', p), go = $<HTMLButtonElement>('#del-go', p);
  pw.focus();
  const check = () => { go.disabled = !pw.value || ok.value.trim() !== 'DELETE'; };
  pw.oninput = ok.oninput = check;
  go.onclick = async () => {
    go.disabled = true;
    try { await server.deleteAccount(session!.token, pw.value); }
    catch (e) { toast((e as Error).message); check(); return; }
    closePop();
    await disablePush(true);
    if (lsGet<Session>(SESSION_KEY)?.token === session?.token) lsDel(SESSION_KEY);
    await endSession(true);
    renderAuth('signin', 'Your account was deleted.');
  };
}

export async function switchAccount() {
  await doSync();
  await endSession(false);
  renderAuth('signin');
}

/** Demo content for a new account. */
function seedAccount() {
  const t = TODAY(), tm = ymd(addDays(todayD(), 1)), y = ymd(addDays(todayD(), -1)), d3 = ymd(addDays(todayD(), 3)), now = Date.now();
  const mk = (name: string, color: string, order: number) => { const l = { id: uid(), name, color, ownerId: me(), members: {}, order, created: now }; upd('lists', l); return l.id; };
  const work = mk('Work', COLORS[0]!, 1), personal = mk('Personal', COLORS[3]!, 2), shop = mk('Groceries', COLORS[2]!, 3);
  const add = (title: string, o: Parameters<typeof newTask>[0] = {}) => upd('tasks', newTask({ title, ...o }));
  add('Welcome to xairos — open me', { due: t, priority: 1, desc: 'Quick add understands plain language:\n“Pay rent every month on 1/12 9am !high #home”\n“Standup every weekday 9:30”\n\nDrag tasks onto lists, dates, the calendar or matrix quadrants.\nRight-click a list → Share to invite another account.\n\nShortcuts: N new task · / search · 1–5 views · Esc close' });
  add('Review pull requests', { listId: work, due: t, time: '10:30', priority: 5, tags: ['dev'], reminders: [0] });
  add('Team standup', { listId: work, due: firstOccurrence({ freq: 'weekly', byDay: [1, 2, 3, 4, 5] }), time: '09:30', repeat: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], from: 'due', dom: 1 }, reminders: [5] });
  add('Prepare sprint demo', { listId: work, due: tm, priority: 3, items: [{ id: uid(), title: 'Record screen capture', done: true }, { id: uid(), title: 'Write release notes', done: false }] });
  add('Send invoice to client', { listId: work, due: y, priority: 5 });
  add('Gym — leg day', { listId: personal, due: t, time: '18:00', tags: ['health'], repeat: { freq: 'weekly', interval: 1, byDay: [parseYmd(t).getDay()], from: 'due', dom: 1 } });
  add('Water the plants', { listId: personal, due: t, repeat: { freq: 'daily', interval: 3, from: 'completion' } });
  add('Book dentist appointment', { listId: personal, due: d3, priority: 1 });
  add('Oat milk', { listId: shop }); add('Coffee beans', { listId: shop });
  add('Read “Deep Work” chapter 3', { tags: ['reading'] });
  ['Drink water', 'Read 20 minutes', 'Morning stretch'].forEach((n, i) => upd('habits', { id: uid(), name: n, color: COLORS[[5, 4, 3][i]!]!, checks: {}, order: i, created: now }));
}
