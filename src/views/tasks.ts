import type { KanbanColumn, List, Task, Ymd } from '../types';
import { byColumn, columnsOf, moveColumn } from '../kanban';
import { closePop, menu, promptPop } from '../ui/popover';
import { toast } from '../ui/toast';
import { $, esc, uid } from '../lib/util';
import { DOW, MON, TODAY, addDays, fmtDue, parseYmd, todayD, ymd } from '../lib/dates';
import { pinnedTz } from '../lib/tz';
import { repeatLabel } from '../recurrence';
import { TRASH_DAYS } from '../lib/trash';
import { parseQuick } from '../parser';
import {
  S, avatarHtml, canWrite, dueCls, dueOf, dueText, inboxId, isShared, listName, me, newTask, prefs, savePrefs, sortTasks, touch, ui, upd, userLists, userOf,
} from '../store';
import { I, emptyArt } from '../ui/icons';
import { select, taskMenu, toggleDone } from '../actions';
import { makeDraggable } from '../ui/dnd';
import { askNotify } from './reminders';
import { keyTitle, renderSide, tasksFor } from './side';
import { shareDialog } from './share';
import { render } from '../app';

interface Section { id: string; name: string; tasks: Task[]; due?: Ymd; keep?: boolean }

export function sectionsFor(key: string, tasks: Task[]): Section[] {
  if (key === 'completed') {
    const by: Record<string, Task[]> = {};
    tasks.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).forEach(t => { const k = ymd(new Date(t.doneAt || t.created)); (by[k] = by[k] || []).push(t); });
    return Object.entries(by).map(([k, v]) => ({ id: 'c' + k, name: fmtDue(k) || k, tasks: v }));
  }
  if (key === 'trash') return [{ id: 'trash', name: `Deleted · kept ${TRASH_DAYS} days`, tasks }];
  const open = sortTasks(tasks.filter(t => !t.done)), done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const t = TODAY(), tm = ymd(addDays(todayD(), 1)), wk = ymd(addDays(todayD(), 6));
  const D = (x: Task) => dueOf(x) || ''; // this device's date; '' = none
  let secs: Section[];
  if (key === 'week') {
    secs = [{ id: 'over', name: 'Overdue', tasks: open.filter(x => D(x) && D(x) < t) }];
    for (let i = 0; i < 7; i++) {
      const d = ymd(addDays(todayD(), i)), dd = parseYmd(d);
      secs.push({ id: 'd' + d, name: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DOW[dd.getDay()]}, ${MON[dd.getMonth()]} ${dd.getDate()}`, tasks: open.filter(x => D(x) === d), due: d, keep: true });
    }
  } else {
    secs = [
      { id: 'over', name: 'Overdue', tasks: open.filter(x => D(x) && D(x) < t) },
      { id: 'today', name: 'Today', tasks: open.filter(x => D(x) === t), due: t },
      { id: 'tom', name: 'Tomorrow', tasks: open.filter(x => D(x) === tm), due: tm },
      { id: 'next', name: 'Next 7 Days', tasks: open.filter(x => D(x) && D(x) > tm && D(x) <= wk) },
      { id: 'later', name: 'Later', tasks: open.filter(x => D(x) && D(x) > wk) },
      { id: 'nod', name: 'No Date', tasks: open.filter(x => !D(x)), due: 'none' },
    ];
  }
  secs = secs.filter(s => s.tasks.length || (s.keep && key === 'week'));
  if (done.length) secs.push({ id: 'done', name: 'Completed', tasks: done });
  return secs;
}

export function rowHtml(t: Task, opts: { showList?: boolean; drop?: boolean; q?: string } = {}) {
  const p = t.priority ? 'p' + t.priority : '';
  const ro = !canWrite(t.listId);
  const items = t.items?.length ? `<span class="sub">${I.sub}${t.items.filter(i => i.done).length}/${t.items.length}</span>` : '';
  const note = t.desc ? `<span title="Has description">${I.note}</span>` : '';
  const rep = t.repeat && !t.done ? `<span title="${esc(repeatLabel(t.repeat))}">${I.repeat}</span>` : '';
  const bell = t.reminders?.length && t.due && !t.done ? `<span title="Reminder">${I.bell}</span>` : '';
  const who = t.assignee ? avatarHtml(userOf(t.assignee)) : '';
  const showList = opts.showList && t.listId !== inboxId() ? `<span>${esc(listName(t.listId))}</span>` : '';
  let title = esc(t.title || 'Untitled');
  if (opts.q) {
    const re = new RegExp('(' + esc(opts.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    title = title.replace(re, '<mark>$1</mark>');
  }
  return `<div class="row ${t.done ? 'done' : ''} ${ui.sel === t.id ? 'sel' : ''}" data-id="${t.id}" ${opts.drop ? 'data-drop="row"' : ''}>
    <button class="cb ${p} ${t.done ? 'on' : ''}" data-cb aria-label="Complete" ${ro ? 'disabled' : ''}>${I.check}</button>
    <div class="title">${title}</div>
    <div class="meta">${items}${note}${rep}${bell}${(t.tags || []).slice(0, 2).map(g => `<span class="tag">${esc(g)}</span>`).join('')}${showList}${t.due ? `<span class="due ${dueCls(t)}">${esc(dueText(t))}${pinnedTz(t) ? ' ' + I.globe : ''}</span>` : ''}${who}</div>
  </div>`;
}

export function bindRows(root: ParentNode, draggable = true) {
  root.querySelectorAll<HTMLElement>('.row[data-id]').forEach(r => {
    const id = r.dataset.id!, t = S.tasks[id];
    r.onclick = e => { if ((e.target as Element).closest('[data-cb]')) return; select(id); };
    r.oncontextmenu = e => { e.preventDefault(); taskMenu(r, id); };
    const cb = r.querySelector<HTMLElement>('[data-cb]');
    if (cb) cb.onclick = e => { e.stopPropagation(); toggleDone(id, r); };
    // On touch, holding a row without dragging opens its menu.
    if (draggable && t && !t.deleted && canWrite(t.listId)) makeDraggable(r, id, () => taskMenu(r, id));
  });
}

export function renderTasks() {
  const key = ui.listKey, main = $('#main');
  const tasks = tasksFor(key), secs = sectionsFor(key, tasks);
  // Board or list is remembered per list (list view until switched).
  const board = prefs.boards?.[key] ?? false;
  const setBoard = (on: boolean) => { prefs.boards = { ...(prefs.boards || {}), [key]: on }; savePrefs(); renderTasks(); };
  const isListKey = !!S.lists[key] || key === inboxId();
  const canAdd = !['completed', 'trash'].includes(key) && (!isListKey || canWrite(key));
  const showList = !isListKey;
  const l = S.lists[key];
  const badge = l && isShared(l) ? `<span class="badge">${l.ownerId === me() ? 'Shared' : (canWrite(key) ? 'Shared with you' : 'View only')}</span>` : '';
  const zone = (s: Section) => `data-drop="zone" data-zone ${s.due ? `data-due="${s.due}"` : ''}`;
  const rows = (s: Section) => s.tasks.map(t => rowHtml(t, { showList, drop: true })).join('');
  main.innerHTML = `
    <div class="topbar">
      <button class="icon-btn menu-toggle" id="menu-btn" aria-label="Lists">${I.menu}</button>
      <h1>${esc(keyTitle(key))}${badge}</h1>
      ${l && !l.inbox ? `<button class="icon-btn" id="share-btn" aria-label="Share list">${I.users}</button>` : ''}
      ${key === 'trash' && tasks.length ? `<button class="btn sec" style="flex:none" id="empty-trash">Empty Trash</button>` : ''}
      <button class="icon-btn ${!board ? 'on' : ''}" id="v-list" aria-label="List view">${I.list}</button>
      <button class="icon-btn ${board ? 'on' : ''}" id="v-board" aria-label="Kanban view">${I.board}</button>
    </div>
    <div class="content" id="content">
      ${canAdd ? `<label class="qa"><svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><input id="qa" placeholder="Add task to “${esc(keyTitle(key))}”, press Enter to save." autocomplete="off"><span class="chips" id="qa-chips"></span></label>` : ''}
      ${board && l ? boardHtml(l, tasks) : secs.length ? (board
        ? `<div class="kanban">${secs.map(s => `<div class="kcol" ${zone(s)}><div class="sec-h">${esc(s.name)} <span class="n">${s.tasks.length}</span></div>${rows(s)}</div>`).join('')}</div>`
        : secs.map(s => { const closed = prefs.closed[key + ':' + s.id] ?? (s.id === 'done'); return `<div class="sec ${closed ? 'closed' : ''}" data-sec="${s.id}" ${zone(s)}><div class="sec-h">${I.caret}${esc(s.name)} <span class="n">${s.tasks.length}</span></div><div class="rows">${rows(s)}</div></div>`; }).join(''))
      : `<div class="empty">${emptyArt}<b>${key === 'trash' ? 'Trash is empty' : key === 'completed' ? 'No completed tasks' : 'No tasks'}</b><span>${canAdd ? 'Add a task above. Try “Pay rent every month 9am !high”' : ''}</span></div>`}
    </div>`;
  $('#menu-btn').onclick = () => { ui.sideOpen = true; renderSide(); };
  $('#v-list').onclick = () => setBoard(false);
  $('#v-board').onclick = () => setBoard(true);
  const sb = $('#share-btn'); if (sb) sb.onclick = e => shareDialog(e.currentTarget as Element, key);
  const et = $('#empty-trash');
  if (et) et.onclick = () => { if (!confirm('Permanently delete all tasks in Trash?')) return; for (const t of tasks) if (canWrite(t.listId)) touch({ ...t, removed: true }); render(); };
  main.querySelectorAll<HTMLElement>('[data-sec] > .sec-h').forEach(hd => hd.onclick = () => {
    const sec = hd.parentElement!, id = sec.dataset.sec!, k = key + ':' + id;
    const cur = prefs.closed[k] ?? (id === 'done'); prefs.closed[k] = !cur; savePrefs(); sec.classList.toggle('closed');
  });
  bindRows(main, key !== 'trash');
  if (board && l) bindBoard(main, l);
  const qa = $<HTMLInputElement>('#qa');
  if (qa) bindQuickAdd(qa, $('#qa-chips'), () => {
    const o: Partial<Task> = {};
    if (isListKey) o.listId = key;
    if (key === 'today' || key === 'week') o.due = TODAY();
    if (key === 'tomorrow') o.due = ymd(addDays(todayD(), 1));
    if (key.startsWith('tag:')) o.tags = [key.slice(4)];
    if (key === 'assigned') o.assignee = me();
    return o;
  });
}

/** A list's board: its own columns, then its completed tasks. */
function boardHtml(l: List, tasks: Task[]) {
  const rw = canWrite(l.id), cols = byColumn(columnsOf(l), sortTasks(tasks.filter(t => !t.done)));
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const row = (t: Task) => rowHtml(t, { drop: true });
  return `<div class="kanban">${cols.map(({ col, tasks: ts }) => `<div class="kcol" data-drop="zone" data-zone data-col="${esc(col.id)}">
      <div class="sec-h">${esc(col.name)} <span class="n">${ts.length}</span>${rw ? `<button class="icon-btn kc-menu" data-kc="${esc(col.id)}" aria-label="Column options">${I.dots}</button>` : ''}</div>
      ${ts.map(row).join('')}
      ${rw ? `<button class="kc-add" data-kadd="${esc(col.id)}">${I.plus}Add task</button>` : ''}
    </div>`).join('')}
    ${done.length ? `<div class="kcol done-col"><div class="sec-h">Completed <span class="n">${done.length}</span></div>${done.slice(0, 50).map(row).join('')}</div>` : ''}
    ${rw ? `<button class="kc-new" id="kc-new">${I.plus}Add column</button>` : ''}
  </div>`;
}

function bindBoard(main: HTMLElement, l: List) {
  const setCols = (columns: KanbanColumn[]) => { upd('lists', { ...S.lists[l.id]!, columns }); render(); };
  const cols = () => columnsOf(S.lists[l.id]);
  main.querySelectorAll<HTMLElement>('[data-kadd]').forEach(b => b.onclick = () => {
    const t = newTask({ listId: l.id, col: b.dataset.kadd! });
    touch(t); select(t.id);
  });
  main.querySelectorAll<HTMLElement>('[data-kc]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const id = b.dataset.kc!, c = cols(), i = c.findIndex(x => x.id === id);
    const items: [string, () => void][] = [
      ['Rename', () => promptPop(b, 'Rename column', { placeholder: 'Column name', value: c[i]!.name }, n => { if (!n) return; closePop(); setCols(c.map(x => x.id === id ? { ...x, name: n } : x)); })],
    ];
    if (i > 0) items.push(['Move left', () => setCols(moveColumn(c, id, -1))]);
    if (i < c.length - 1) items.push(['Move right', () => setCols(moveColumn(c, id, 1))]);
    if (c.length > 1) items.push(['Delete column', () => {
      setCols(c.filter(x => x.id !== id));
      // Tasks keep their column id, so undo puts them back where they were.
      toast(`Column deleted. Its tasks show in “${(i === 0 ? c[1] : c[0])!.name}”`, () => setCols(c));
    }]);
    menu(b, items);
  });
  const nb = $('#kc-new');
  if (nb) nb.onclick = () => promptPop(nb, 'New column', { placeholder: 'e.g. Waiting' }, n => {
    if (!n) return; closePop(); setCols([...cols(), { id: uid(), name: n }]);
  });
}

/** Wire a quick-add input: live chips while typing, create on Enter. */
export function bindQuickAdd(input: HTMLInputElement, chipsEl: HTMLElement, defaults: () => Partial<Task>) {
  const showChips = () => { const p = parseQuick(input.value); chipsEl.innerHTML = p.chips.map(c => `<span class="chip ${c.cls}">${esc(c.txt)}</span>`).join(''); };
  input.oninput = showChips;
  input.onkeydown = e => {
    if (e.key === 'Escape') { input.value = ''; showChips(); input.blur(); }
    if (e.key !== 'Enter' || e.isComposing) return;
    const p = parseQuick(input.value);
    if (!p.title) return;
    const d = defaults();
    let listId = d.listId || inboxId();
    if (p.listName) { const l = userLists().find(x => x.name.toLowerCase() === p.listName!.toLowerCase()); if (l && canWrite(l.id)) listId = l.id; }
    const t = newTask({
      title: p.title, listId, due: p.due ?? d.due ?? null, time: p.time, priority: p.priority ?? d.priority ?? 0,
      tags: [...new Set([...(d.tags || []), ...p.tags])], repeat: p.repeat, reminders: p.time ? [0] : [], assignee: d.assignee || null,
    });
    touch(t);
    if (t.reminders.length) askNotify(false);
    input.value = ''; chipsEl.innerHTML = '';
    render(); document.getElementById(input.id)?.focus();
  };
}

