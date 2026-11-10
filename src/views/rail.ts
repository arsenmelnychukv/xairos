import { $, esc, uid } from '../lib/util';
import { TODAY } from '../lib/dates';
import { COLORS, S, allTasks, avatarHtml, canWrite, inboxId, me, prefs, savePrefs, server, sess, ui, upd, userLists } from '../store';
import { planImport, readHabitFile, type ImportResult } from '../lib/import-habits';
import { Sync, doSync, pendingCount } from '../sync/engine';
import { I } from '../ui/icons';
import { closePop, menu, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { isDark, themeMenu } from '../ui/theme';
import { askNotify } from './reminders';
import { disablePush, enablePush, pushActive, pushSupported, refreshPush } from '../push';
import { googleMenu, googleStatus } from '../google';
import { shortcutsPanel } from './shortcuts';
import { tasksCsv, tasksIcs } from '../lib/export';
import { deleteAccountDialog, signOut, switchAccount } from './auth';
import { render } from '../app';
import { isOwnBackup } from '../lib/rename';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function syncTip(): string {
  const n = pendingCount(), queued = n ? ` · ${n} change${n > 1 ? 's' : ''} saved on this device` : '';
  if (Sync.state === 'offline') return 'Offline' + (queued || ' · changes are saved on this device');
  if (Sync.state === 'error') return 'Sync failed — click to retry' + queued;
  if (Sync.state === 'syncing') return 'Syncing…';
  return (Sync.last ? 'Synced ' + hhmm(Sync.last) : 'Not synced yet') + queued;
}

function updateSyncBtn(b: HTMLElement) {
  b.className = 'rail-btn sync ' + (Sync.state === 'syncing' ? 'syncing' : Sync.state === 'error' ? 'err' : Sync.state === 'offline' ? 'offline' : '');
  const tip = syncTip();
  b.innerHTML = (Sync.state === 'syncing' ? I.syncing : I.cloud) + `<span class="tip">${tip}</span>`;
}
export function refreshSyncBtn() { const b = $('#sync-btn'); if (b) updateSyncBtn(b); }

export function renderRail() {
  const items: [string, string, string, string][] = [
    ['tasks', 'Tasks', I.tasks, '#/tasks/' + encodeURIComponent(ui.listKey)], ['calendar', 'Calendar', I.cal, '#/calendar'],
    ['matrix', 'Eisenhower Matrix', I.matrix, '#/matrix'], ['focus', 'Focus', I.focus, '#/focus'],
    ['habits', 'Habit Tracker', I.habit, '#/habits'], ['search', 'Search', I.search, '#/search'],
  ];
  const rail = $('#rail');
  rail.innerHTML = `<button class="rail-btn" id="acct-btn" aria-label="Account">${avatarHtml(sess().user)}</button>` +
    items.map(([k, n, ic, href]) => `<a class="rail-btn ${ui.route === k ? 'on' : ''}" href="${href}" aria-label="${n}">${ic}<span class="tip">${n}</span></a>`).join('') +
    `<div class="grow"></div><button class="rail-btn sync" id="sync-btn" aria-label="Sync now"></button><button class="rail-btn" id="theme-btn" aria-label="Theme">${isDark() ? I.sun : I.moon}<span class="tip">Theme</span></button>`;
  updateSyncBtn($('#sync-btn'));
  $('#sync-btn').onclick = () => doSync();
  $('#theme-btn').onclick = e => themeMenu(e.currentTarget as Element);
  $('#acct-btn').onclick = e => accountMenu(e.currentTarget as Element);
}

function accountMenu(anchor: Element) {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const u = sess().user;
  const p = popover(anchor, `
    <div class="acct">${avatarHtml(u)}<div><div class="n">${esc(u.name)}</div><div class="e">${esc(u.email)}</div></div></div>
    <div class="sep"></div>
    <div class="mi" data-a="sync">${I.syncing}Sync now<span class="kbd">${Sync.last ? hhmm(Sync.last) : ''}</span></div>
    <div class="mi" data-a="notif">${I.bell}Notifications<span class="kbd">${perm === 'granted' ? 'On' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'Unsupported' : 'Enable'}</span></div>
    ${pushSupported() || /iPhone|iPad/.test(navigator.userAgent) ? `<div class="mi" data-a="push">${I.bell}Background reminders<span class="kbd">${pushActive() ? 'On' : 'Off'}</span></div>` : ''}
    ${server.google ? `<div class="mi" data-a="google">${I.cal}Google Calendar<span class="kbd">${googleStatus()?.connected ? (googleStatus()!.error ? 'Error' : 'On') : 'Off'}</span></div>` : ''}
    ${server.tokens ? `<div class="mi" data-a="shortcuts">${I.plus}Apple Shortcuts</div>` : ''}
    <div class="mi" data-a="week">${I.cal}Week starts on<span class="kbd">${prefs.weekStart === 1 ? 'Monday' : 'Sunday'}</span></div>
    <div class="mi" data-a="export">${I.inbox}Export…</div>
    <div class="mi" data-a="import">${I.plus}Import backup</div>
    <div class="sep"></div>
    <div class="mi" data-a="switch">${I.users}Use another account in this tab</div>
    <div class="mi danger" data-a="out">${I.close}Sign out</div>
    <div class="mi danger" data-a="delete">${I.trash}Delete account…</div>`, 260);
  p.querySelectorAll<HTMLElement>('[data-a]').forEach(el => el.onclick = async () => {
    const a = el.dataset.a; closePop();
    if (a === 'sync') doSync();
    if (a === 'notif') askNotify(true);
    if (a === 'push') pushActive() ? disablePush() : enablePush();
    if (a === 'google') googleMenu(anchor);
    if (a === 'shortcuts') shortcutsPanel(anchor);
    if (a === 'week') { prefs.weekStart = prefs.weekStart === 1 ? 0 : 1; savePrefs(); render(); refreshPush(); }
    if (a === 'export') menu(anchor, [
      ['Full backup (JSON)', exportBackup],
      ['Tasks for spreadsheets (CSV)', () => download(tasksCsv(allTasks(), S.lists), `xairos-tasks-${TODAY()}.csv`, 'text/csv;charset=utf-8')],
      ['Tasks for calendar apps (ICS)', () => download(tasksIcs(allTasks(), S.lists), `xairos-tasks-${TODAY()}.ics`, 'text/calendar;charset=utf-8')],
    ]);
    if (a === 'import') $('#import-file').click();
    if (a === 'out') signOut(false);
    if (a === 'switch') switchAccount();
    if (a === 'delete') deleteAccountDialog(anchor);
  });
}

function download(text: string, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportBackup() {
  const data = { app: 'xairos', version: 1, exported: new Date().toISOString(), lists: userLists(), tasks: allTasks(), habits: Object.values(S.habits), focus: Object.values(S.focus) };
  download(JSON.stringify(data, null, 2), `xairos-backup-${TODAY()}.json`, 'application/json');
}

export function initImport() {
  $<HTMLInputElement>('#import-file').onchange = async e => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    try {
      // Another habit app's export: preview first, then merge by name.
      const other = await readHabitFile(f.name, new Uint8Array(await f.arrayBuffer()));
      if (other) return habitImportPreview(other);
      const data = JSON.parse(await f.text());
      if (!isOwnBackup(data.app)) throw new Error('Not a xairos backup');
      const idMap: Record<string, string> = {};
      for (const l of data.lists || []) {
        const mine = !S.lists[l.id] || S.lists[l.id]!.ownerId === me();
        const id = mine ? l.id : uid(); idMap[l.id] = id;
        upd('lists', { ...l, id, ownerId: me(), members: mine ? (l.members || {}) : {} });
      }
      for (const t of data.tasks || []) {
        const listId = idMap[t.listId] || (canWrite(t.listId) ? t.listId : inboxId());
        upd('tasks', { ...t, listId: String(t.listId || '').startsWith('inbox-') ? inboxId() : listId });
      }
      for (const x of data.habits || []) upd('habits', { ...x });
      for (const x of data.focus || []) upd('focus', { ...x });
      toast('Backup imported'); render();
    } catch (ex) { toast('Import failed: ' + (ex as Error).message); }
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Show what an import from another habit app will do, and run it on OK. */
function habitImportPreview(r: ImportResult) {
  const plan = planImport(Object.values(S.habits), r.habits, { now: Date.now(), palette: COLORS.slice(0, 7), newId: uid });
  const news = plan.rows.filter(x => !x.merge).length, merges = plan.rows.length - news;
  const notes: string[] = [];
  if (r.dropped.skips) notes.push(`${plural(r.dropped.skips, 'skipped day')} not imported: xairos has no skip days yet.`);
  if (r.dropped.notes) notes.push(`${plural(r.dropped.notes, 'note')} not imported: xairos has no day notes yet.`);
  for (const h of r.dropped.habits) notes.push(`Not imported: ${h}.`);
  notes.push(...r.warnings);
  const anchor = $('#acct-btn');
  const p = popover(anchor, `
    <h4>Import from ${esc(r.source)}</h4>
    <div class="imp-sum">${plan.rows.length ? `${plural(news, 'new habit')}${merges ? `, ${merges} merged into yours` : ''}` : 'No habits found in this file.'}</div>
    <div class="imp-list">${plan.rows.map(x => `<div class="imp-row"><span class="n">${esc(x.name)}</span><span class="t">${x.merge ? `merge · +${plural(x.days, 'day')}` : `new · ${plural(x.days, 'day')}`}</span></div>`).join('')}</div>
    ${notes.length ? `<ul class="imp-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok ${plan.create.length + plan.update.length ? '' : 'disabled'}>Import</button></div>`, 360);
  $('[data-x]', p).onclick = closePop;
  $('[data-ok]', p).onclick = () => {
    for (const h of plan.create) upd('habits', h);
    for (const h of plan.update) upd('habits', h);
    closePop();
    toast(`Imported from ${r.source}: ${plural(news, 'new habit')}${merges ? `, ${merges} merged` : ''}`);
    render();
  };
}
