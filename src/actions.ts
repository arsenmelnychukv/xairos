/** Task actions shared by the views: complete, delete, move, select. */
import type { Task } from './types';
import { $, clone, uid } from './lib/util';
import { TODAY, fmtDue, nextMonday, tomorrow } from './lib/dates';
import { advanceRepeat } from './recurrence';
import { S, canWrite, dueText, listName, ord, peopleOf, prefs, touch, ui } from './store';
import { menu } from './ui/popover';
import { toast } from './ui/toast';
import { playSound } from './ui/sounds';
import { dismissReminder } from './views/reminders';
import { focusOn } from './views/focus';
import { render } from './app';

export function guard(t: Task) { if (canWrite(t.listId)) return true; toast('You have view-only access to this list'); return false; }

function animateOut(rowEl?: Element | null) {
  if (rowEl) { rowEl.classList.add('done', 'leaving'); rowEl.querySelector('[data-cb]')?.classList.add('on'); setTimeout(render, 420); }
  else render();
}

export function toggleDone(id: string, rowEl?: Element | null) {
  const t = S.tasks[id]; if (!t || !guard(t)) return;
  if (t.deleted) { touch({ ...t, deleted: false }); render(); toast('Task restored'); return; }
  if (!t.done && t.repeat && t.due) return completeRepeating(t, rowEl);
  Object.assign(t, { done: !t.done, doneAt: !t.done ? Date.now() : null, snooze: null }); touch(t);
  dismissReminder(id);
  if (t.done) {
    playSound('taskDone', prefs.sounds);
    animateOut(rowEl);
    toast('Completed', () => { touch(Object.assign(S.tasks[id]!, { done: false, doneAt: null })); render(); });
  } else render();
}

/** Log a completed copy and move the task to its next date. */
function completeRepeating(t: Task, rowEl?: Element | null) {
  const r = t.repeat!, before = clone(t);
  const { next, finished } = advanceRepeat(r, t.due!, TODAY());
  playSound('taskDone', prefs.sounds);
  if (finished) { Object.assign(t, { done: true, doneAt: Date.now(), snooze: null }); touch(t); animateOut(rowEl); toast('Completed — last occurrence'); return; }
  const copy: Task = { ...clone(t), id: uid(), done: true, doneAt: Date.now(), repeat: null, reminders: [], snooze: null, repeatOf: t.id, created: Date.now(), order: Date.now() };
  touch(copy);
  Object.assign(t, { due: next, snooze: null, items: (t.items || []).map(i => ({ ...i, done: false })), repeat: { ...r, done: (r.done || 0) + 1 } });
  touch(t); dismissReminder(t.id);
  animateOut(rowEl);
  toast(`Next: ${dueText(t)}`, () => {
    touch({ ...S.tasks[copy.id]!, removed: true });
    touch(Object.assign(S.tasks[t.id]!, { ...before, mtime: S.tasks[t.id]!.mtime }));
    render();
  });
}

export function del(id: string) {
  const t = S.tasks[id]; if (!t || !guard(t)) return;
  if (t.deleted) touch({ ...t, removed: true });
  else { touch({ ...t, deleted: true }); toast('Moved to Trash', () => { touch({ ...S.tasks[id]!, deleted: false }); render(); }); }
  if (ui.sel === id) ui.sel = null;
  dismissReminder(id); render();
}

export function moveTo(t: Task, listId: string) {
  if (!canWrite(listId)) return toast('You cannot add tasks to that list');
  const people = peopleOf(S.lists[listId]);
  touch(Object.assign(t, { listId, assignee: t.assignee && people.includes(t.assignee) ? t.assignee : null }));
  render(); toast(`Moved to ${listName(listId)}`);
}

export function taskMenu(anchor: Element, id: string) {
  const t = S.tasks[id]; if (!t) return;
  if (!canWrite(t.listId)) return toast('View only');
  if (t.deleted) return menu(anchor, [['Restore', () => toggleDone(id)], ['Delete forever', () => del(id)]]);
  const set = (o: Partial<Task>) => { touch(Object.assign(t, o)); render(); };
  menu(anchor, [
    ['Today', () => set({ due: TODAY() })], ['Tomorrow', () => set({ due: tomorrow() })], ['Next week', () => set({ due: nextMonday() })],
    ['Priority: High', () => set({ priority: 5 })], ['Priority: Medium', () => set({ priority: 3 })], ['Priority: Low', () => set({ priority: 1 })], ['Priority: None', () => set({ priority: 0 })],
    ['Start focus', () => focusOn(id)],
    ['Duplicate', () => { touch({ ...clone(t), id: uid(), created: Date.now(), order: ord(t) + 1, done: false, doneAt: null }); render(); }],
    ['Delete', () => del(id)],
  ]);
}

export function select(id: string) {
  ui.sel = id; render();
  setTimeout(() => { const ta = $<HTMLTextAreaElement>('#d-title'); if (ta && !ta.value && !ta.disabled) ta.focus(); });
}
