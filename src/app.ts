/** Render root, routing and global keyboard handling. */
import { $, isTyping } from './lib/util';
import { S, hasDb, inboxId, prefs, session, ui, type Route } from './store';
import { closePop, isPopOpen } from './ui/popover';
import { renderRail } from './views/rail';
import { SMART_KEYS, renderSide } from './views/side';
import { renderTasks } from './views/tasks';
import { renderDetail } from './views/detail';
import { renderCalendar, setView } from './views/calendar';
import { applyTheme } from './ui/theme';
import { renderMatrix } from './views/matrix';
import { renderFocus } from './views/focus';
import { askYesterday, renderHabits } from './views/habits';
import { renderHabitDetail } from './views/habit-detail';
import { renderSearch } from './views/search';

const VIEWS: Record<Route, () => void> = {
  tasks: renderTasks, calendar: renderCalendar, matrix: renderMatrix, focus: renderFocus, habits: () => (ui.habit ? renderHabitDetail(ui.habit) : renderHabits()), search: renderSearch,
};

export function render() {
  if (!session || !hasDb()) return;
  if (ui.sel && !S.tasks[ui.sel]) ui.sel = null;
  // Unknown list: fall back to Today, but not before the first pull has filled the db.
  if (ui.route === 'tasks' && S.checkpoint > 0 && !SMART_KEYS.includes(ui.listKey) && !ui.listKey.startsWith('tag:') && !S.lists[ui.listKey] && ui.listKey !== inboxId()) ui.listKey = 'today';
  renderRail(); renderSide(); VIEWS[ui.route](); renderDetail();
  askYesterday();
}

/** Remote changes: re-render unless the user is typing (then wait until focus leaves). */
export function softRender() {
  const a = document.activeElement;
  if (isTyping(a) && !a!.closest('.auth')) { ui.pending = true; renderRail(); return; }
  render();
}

export const go = (hash: string) => { location.hash = hash; };

export function readHash() {
  if (!session) return;
  // A query after the route (#/calendar?google=…) is handled elsewhere.
  const p = location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/');
  ui.route = (p[0]! in VIEWS ? p[0] : 'tasks') as Route;
  if (ui.route === 'tasks') ui.listKey = decodeURIComponent(p[1] || 'today');
  if (ui.listKey === 'inbox') ui.listKey = inboxId();
  const hab = ui.route === 'habits' && p[1] ? decodeURIComponent(p[1]) : null;
  if (hab !== ui.habit) ui.habitYear = null;
  ui.habit = hab;
  ui.sideOpen = false;
  if (innerWidth <= 1100) ui.sel = null;
  render();
}

/** Run a render that softRender deferred, once the user is no longer typing. */
export function flushPending() {
  if (ui.pending && !isTyping()) { ui.pending = false; render(); }
}

export function initApp() {
  addEventListener('hashchange', readHash);
  document.addEventListener('focusout', () => setTimeout(flushPending, 60));
  // Backstop: focus can leave without a focusout (window not focused, element removed).
  setInterval(flushPending, 1000);
  // A new day while the app stays open: ask about yesterday then too.
  setInterval(() => { if (session && hasDb()) askYesterday(); }, 60_000);
  document.addEventListener('keydown', e => {
    if (!session) return;
    const typing = isTyping();
    if (e.key === 'Escape') {
      if (isPopOpen()) return closePop();
      if (ui.sel && !typing) { ui.sel = null; render(); }
      if (typing) (document.activeElement as HTMLElement).blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n') { e.preventDefault(); if (ui.route !== 'tasks') go('#/tasks/' + encodeURIComponent(ui.listKey)); setTimeout(() => $('#qa')?.focus()); }
    if (e.key === '/') { e.preventDefault(); go('#/search'); }
    const views: Record<string, string> = { '1': '#/tasks/today', '2': '#/calendar', '3': '#/matrix', '4': '#/focus', '5': '#/habits' };
    if (views[e.key]) go(views[e.key]!);
    if (ui.route === 'calendar') {
      const cv: Record<string, 'month' | 'week' | 'day'> = { m: 'month', w: 'week', d: 'day' };
      if (cv[e.key]) setView(cv[e.key]!);
      if (e.key === 't') { ui.calDate = null; render(); }
    }
  });
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => { if (prefs.theme === 'system') { applyTheme(); render(); } });
  let rT: ReturnType<typeof setTimeout> | undefined;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (session) renderDetail(); }, 120); });
}
