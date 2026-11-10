import type { List, Task } from '../types';
import { $, esc, uid } from '../lib/util';
import { TODAY, addDays, todayD, ymd } from '../lib/dates';
import {
  COLORS, S, allTags, tc, dueOf, allTasks, inboxId, isOwner, isShared, listById, listName, live, me, prefs, saveLocal, savePrefs,
  server, sess, ui, upd, userLists, userName,
} from '../store';
import { I } from '../ui/icons';
import { closePop, menu, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { shareDialog } from './share';
import { go, render } from '../app';

export const SMART_KEYS = ['today', 'tomorrow', 'week', 'all', 'assigned', 'completed', 'trash'];

/** Tasks shown for a sidebar key: smart list, `tag:x`, or a list id. */
export function tasksFor(key: string): Task[] {
  const L = live(), t = TODAY();
  const d = (x: Task) => dueOf(x);
  if (key === 'today') return L.filter(x => (d(x) && d(x)! <= t && !x.done) || (x.done && d(x) === t));
  if (key === 'tomorrow') return L.filter(x => d(x) === ymd(addDays(todayD(), 1)));
  if (key === 'week') return L.filter(x => d(x) && d(x)! <= ymd(addDays(todayD(), 6)) && (!x.done || d(x)! >= t));
  if (key === 'all') return L;
  if (key === 'assigned') return L.filter(x => x.assignee === me());
  if (key === 'completed') return L.filter(x => x.done);
  if (key === 'trash') return allTasks().filter(x => x.deleted);
  if (key.startsWith('tag:')) return L.filter(x => (x.tags || []).includes(key.slice(4)));
  return L.filter(x => x.listId === key);
}
const countFor = (key: string) => tasksFor(key).filter(t => !t.done).length;

export function keyTitle(key: string): string {
  const smart: Record<string, string> = { today: 'Today', tomorrow: 'Tomorrow', week: 'Next 7 Days', all: 'All', assigned: 'Assigned to Me', completed: 'Completed', trash: 'Trash' };
  return smart[key] || (key.startsWith('tag:') ? '#' + key.slice(4) : listName(key));
}

export function renderSide() {
  const side = $('#side');
  if (ui.route !== 'tasks') { side.style.display = 'none'; return; }
  side.style.display = '';
  side.classList.toggle('open', ui.sideOpen);
  $('#scrim').classList.toggle('on', ui.sideOpen);
  const todayIco = I.today.replace('DD', String(todayD().getDate()));
  const ico = (s: string) => s.replace('<svg', '<svg class="ico"');
  const nav = (key: string, icon: string, name: string, drop = '', cnt = true) =>
    `<div class="nav-item ${ui.listKey === key ? 'on' : ''}" data-k="${esc(key)}" ${drop}>${icon}<span class="name">${esc(name)}</span>${cnt ? `<span class="cnt">${countFor(key) || ''}</span>` : ''}</div>`;
  const lc = prefs.sideClosed.lists, tagsClosed = prefs.sideClosed.tags;
  const anyShared = Object.values(S.lists).some(l => isShared(l) && !l.removed);
  const listRow = (l: List) => `<div class="nav-item ${ui.listKey === l.id ? 'on' : ''}" data-k="${l.id}" data-list="${l.id}" data-drop="list" data-v="${l.id}"><span class="dot" style="background:rgb(${tc(l.color)})"></span><span class="name">${esc(l.name)}</span>${isShared(l) ? `<span class="shared" title="${l.ownerId === me() ? 'Shared' : 'Shared by ' + esc(userName(l.ownerId))}">${I.users}</span>` : ''}<span class="cnt">${countFor(l.id) || ''}</span></div>`;
  side.innerHTML = `<div class="side-scroll">
    ${nav('today', ico(todayIco), 'Today', 'data-drop="smart" data-v="today"')}${nav('tomorrow', ico(I.tomorrow), 'Tomorrow', 'data-drop="smart" data-v="tomorrow"')}${nav('week', ico(I.week), 'Next 7 Days')}${nav(inboxId(), ico(I.inbox), 'Inbox', `data-drop="list" data-v="${inboxId()}"`)}
    ${anyShared ? nav('assigned', ico(I.person), 'Assigned to Me') : ''}
    <div class="side-sep"></div>
    <div class="side-head ${lc ? 'closed' : ''}"><span class="caret" data-fold="lists">Lists ${I.caret}</span><button id="add-list" aria-label="Add list">${I.plus}</button></div>
    ${lc ? '' : userLists().map(listRow).join('')}
    <div class="side-head ${tagsClosed ? 'closed' : ''}"><span class="caret" data-fold="tags">Tags ${I.caret}</span></div>
    ${tagsClosed ? '' : (allTags().map(t => nav('tag:' + t, ico(I.tag), t, `data-drop="tag" data-v="${esc(t)}"`)).join('') || '<div class="nav-item" style="color:var(--t3);cursor:default;font-size:12px">Type #tag when adding tasks</div>')}
    <div class="side-sep"></div>
    ${nav('all', ico(I.list), 'All')}${nav('completed', ico(I.done), 'Completed', '', false)}${nav('trash', ico(I.trash), 'Trash', 'data-drop="trash"', false)}
  </div>`;
  side.querySelectorAll<HTMLElement>('.nav-item[data-k]').forEach(el => el.onclick = () => go('#/tasks/' + encodeURIComponent(el.dataset.k!)));
  side.querySelectorAll<HTMLElement>('[data-list]').forEach(el => el.oncontextmenu = e => { e.preventDefault(); listMenu(el, el.dataset.list!); });
  side.querySelectorAll<HTMLElement>('[data-fold]').forEach(el => el.onclick = () => { const k = el.dataset.fold!; prefs.sideClosed[k] = !prefs.sideClosed[k]; savePrefs(); renderSide(); });
  $('#add-list').onclick = e => listDialog(e.currentTarget as Element);
}

export function initSide() { $('#scrim').onclick = () => { ui.sideOpen = false; renderSide(); }; }

function listDialog(anchor: Element, list?: List) {
  let color = list?.color || COLORS[0]!;
  const p = popover(anchor, `<h4>${list ? 'Edit List' : 'Add List'}</h4><input class="dlg-input" placeholder="Name" value="${esc(list?.name || '')}"><div class="swatches">${COLORS.map(c => `<button data-c="${c}" style="background:rgb(${tc(c)});color:rgb(${tc(c)})" class="${c === color ? 'on' : ''}" aria-label="Color"></button>`).join('')}</div><div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok>Save</button></div>`, 260);
  const inp = $<HTMLInputElement>('input', p); inp.focus();
  p.querySelectorAll<HTMLElement>('[data-c]').forEach(b => b.onclick = () => { color = b.dataset.c!; p.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
  const ok = () => {
    const n = inp.value.trim(); if (!n) return;
    if (list) upd('lists', { ...list, name: n, color });
    else { const id = uid(); upd('lists', { id, name: n, color, ownerId: me(), members: {}, order: userLists().length + 1, created: Date.now() }); go('#/tasks/' + id); }
    closePop(); render();
  };
  $('[data-ok]', p).onclick = ok; $('[data-x]', p).onclick = closePop;
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
}

function listMenu(anchor: Element, id: string) {
  const l = listById(id); if (!l) return;
  if (!isOwner(id)) return menu(anchor, [['Share details…', () => shareDialog(anchor, id)], ['Leave list', async () => {
    try {
      await server.leaveList(sess().token, id);
      delete S.lists[id];
      for (const t of Object.values(S.tasks)) if (t.listId === id) delete S.tasks[t.id];
      saveLocal();
      if (ui.listKey === id) go('#/tasks/today'); else render();
      toast(`Left “${l.name}”`);
    } catch (e) { toast((e as Error).message); }
  }]]);
  menu(anchor, [['Edit', () => listDialog(anchor, l)], ['Share…', () => shareDialog(anchor, id)], ['Delete', () => {
    if (!confirm(`Delete list “${l.name}” and its tasks${isShared(l) ? ' for everyone it is shared with' : ''}?`)) return;
    for (const t of Object.values(S.tasks)) if (t.listId === id) { delete S.tasks[t.id]; delete S.dirty.tasks[t.id]; }
    upd('lists', { ...l, removed: true });
    if (ui.listKey === id) go('#/tasks/' + encodeURIComponent(inboxId())); else render();
    toast(`Deleted list “${l.name}”`);
  }]]);
}
