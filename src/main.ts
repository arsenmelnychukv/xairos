// Brand fonts (OFL), bundled so they work offline. Browsers fetch only the subsets a page uses.
import '@fontsource-variable/onest/wght.css';
import '@fontsource-variable/martian-mono/wght.css';
import './ui/tokens.css';
import './style.css';
import { $ } from './lib/util';
import { flushLocal, loadLocal, saveSession, session } from './store';
import { initApp, readHash } from './app';
import { doSync, initSync, subscribeSync } from './sync/engine';
import { applyTheme } from './ui/theme';
import { initPopover } from './ui/popover';
import { initToast } from './ui/toast';
import { initDnd } from './ui/dnd';
import { initSide } from './views/side';
import { initImport } from './views/rail';
import { initCalendar } from './views/calendar';
import { initFocus } from './views/focus';
import { handleGoogleReturn, initGoogle, refreshGoogle } from './google';
import { checkReminders, initReminders, openTask } from './views/reminders';
import { refreshPush } from './push';
import { renderAuth } from './views/auth';
import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/toast';

initApp(); initSync(); initPopover(); initToast(); initDnd(); initSide(); initImport(); initReminders(); initCalendar(); initFocus(); initGoogle();
applyTheme();

// Write pending changes before the page is hidden or closed (mobile kills background tabs).
addEventListener('pagehide', () => { flushLocal(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushLocal(); });

async function boot() {
  if (!session) return renderAuth('signin');
  saveSession();
  await loadLocal();
  subscribeSync();
  $('#app').hidden = false;
  if (!location.hash) location.hash = '#/tasks/today'; else readHash();
  doSync();
  setTimeout(checkReminders, 1500);
  refreshPush();
  handleGoogleReturn(); refreshGoogle(true);
  // Opened from a reminder notification: /?task=<id>
  const open = new URLSearchParams(location.search).get('task');
  if (open) { history.replaceState(null, '', location.pathname + location.hash); openTask(open); }
}
boot();

// A reminder notification was clicked while the app was already open.
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'open-task' && session) openTask(String(e.data.id));
  if (e.data?.type === 'open-habits' && session) location.hash = '#/habits';
});

// Service worker (production builds only). A new version waits until the user reloads.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const update = registerSW({
    onNeedRefresh: () => toast('A new version of xairos is ready', () => update(true), { label: 'Reload', sticky: true }),
  });
}
