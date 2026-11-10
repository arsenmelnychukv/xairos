/**
 * Themes: Classic or Quiet Sails, each light and dark. The
 * mode follows the system setting unless set. CSS keys off two attributes
 * on <html>: data-mode="light|dark" and data-family="sails" (see style.css;
 * index.html sets both before first paint).
 */
import { prefs, savePrefs, type Prefs } from '../store';
import { esc } from '../lib/util';
import { render } from '../app';
import { closePop, popover } from './popover';
import { I } from './icons';

export type Family = 'classic' | 'sails';
export const FAMILIES: [Family, string][] = [['classic', 'Classic'], ['sails', 'Quiet Sails']];
const MODES: [Prefs['theme'], string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);

export function applyTheme() {
  const r = document.documentElement;
  r.dataset.mode = isDark() ? 'dark' : 'light';
  if (prefs.family === 'sails') r.dataset.family = 'sails'; else delete r.dataset.family;
  // Browser and iOS status bar colour follow the page background.
  const bg = getComputedStyle(r).getPropertyValue('--bg').trim();
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  if (bg) meta.content = `rgb(${bg})`;
}

export function setTheme(t: Prefs['theme']) { prefs.theme = t; savePrefs(); applyTheme(); render(); }
export function setFamily(f: Family) { prefs.family = f; savePrefs(); applyTheme(); render(); }

/** Swatch colours for the picker: background, accent, second accent. */
const SWATCH: Record<Family, [string, string, string][]> = {
  classic: [['#ffffff', '#4772FA', '#FAA80C'], ['#242424', '#4772FA', '#FAA80C']],
  sails: [['#F7F5F0', '#8C5A2B', '#4E6B4A'], ['#2B2F33', '#C9925A', '#8FAF86']],
};

/** The theme menu: family (with light and dark swatches) and mode. */
export function themeMenu(anchor: Element) {
  const fam = prefs.family || 'classic';
  const sw = (f: Family) => SWATCH[f].map(([bg, a, b]) => `<span class="sw" style="background:${bg}"><i style="background:${a}"></i><i style="background:${b}"></i></span>`).join('');
  const p = popover(anchor, `
    <h4>Theme</h4>
    ${FAMILIES.map(([f, lab]) => `<div class="mi theme-opt" data-f="${f}" role="menuitemradio" aria-checked="${fam === f}"><span class="sws">${sw(f)}</span>${esc(lab)}${fam === f ? `<span class="kbd">${I.check}</span>` : ''}</div>`).join('')}
    <div class="sep"></div>
    <div class="seg theme-mode" role="radiogroup" aria-label="Light or dark">${MODES.map(([m, lab]) => `<button data-m="${m}" class="${prefs.theme === m ? 'on' : ''}" role="radio" aria-checked="${prefs.theme === m}">${lab}</button>`).join('')}</div>`, 240);
  p.querySelectorAll<HTMLElement>('[data-f]').forEach(el => el.onclick = () => { closePop(); setFamily(el.dataset.f as Family); });
  p.querySelectorAll<HTMLElement>('[data-m]').forEach(el => el.onclick = () => { closePop(); setTheme(el.dataset.m as Prefs['theme']); });
}
