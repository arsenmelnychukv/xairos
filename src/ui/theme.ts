/**
 * One brand theme in light and dark (tokens in ui/tokens.css). The mode
 * follows the system setting unless set. CSS keys off data-mode="light|dark"
 * on <html>; index.html sets it before first paint.
 */
import { prefs, savePrefs, type Prefs } from '../store';
import { esc } from '../lib/util';
import { render } from '../app';
import { closePop, popover } from './popover';

const MODES: [Prefs['theme'], string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);

export function applyTheme() {
  const r = document.documentElement;
  r.dataset.mode = isDark() ? 'dark' : 'light';
  delete r.dataset.family; // older builds set this for the retired Quiet Sails theme
  // Browser and iOS status bar colour follow the page background.
  const bg = getComputedStyle(r).getPropertyValue('--ground').trim();
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  if (bg) meta.content = bg;
}

export function setTheme(t: Prefs['theme']) { prefs.theme = t; savePrefs(); applyTheme(); render(); }
/** The theme menu: system, light or dark. */
export function themeMenu(anchor: Element) {
  const p = popover(anchor, `
    <h4>Theme</h4>
    <div class="seg theme-mode" role="radiogroup" aria-label="Light or dark">${MODES.map(([m, lab]) => `<button data-m="${m}" class="${prefs.theme === m ? 'on' : ''}" role="radio" aria-checked="${prefs.theme === m}">${esc(lab)}</button>`).join('')}</div>`, 240);
  p.querySelectorAll<HTMLElement>('[data-m]').forEach(el => el.onclick = () => { closePop(); setTheme(el.dataset.m as Prefs['theme']); });
}
