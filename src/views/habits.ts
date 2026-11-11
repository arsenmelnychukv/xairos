/** Habits: daily goals ("8 glasses"), "N times a week", streaks and a reminder. */
import type { Habit } from '../types';
import { $, esc, h, lsGet, lsSet, uid } from '../lib/util';
import { DOW, TODAY, addDays, fmtTime, parseYmd, ymd } from '../lib/dates';
import { checkValue, countOn, doneInWeek, doneOn, goalOf, metWeekFill, missedYesterday, perWeekOf, streak, stripDays, tapValue } from '../habits';
import { COLORS, S, prefs, session, tc, upd } from '../store';
import { I, emptyArt } from '../ui/icons';
import { closePop, menu, popover } from '../ui/popover';
import { askNotify } from './reminders';
import { go, render } from '../app';

/** A habit's colour as a full CSS colour. */
export const hueOf = (hb: Habit) => `rgb(${tc(hb.color)})`;

const live = () => Object.values(S.habits).filter(x => !x.removed).sort((a, b) => (a.order || 0) - (b.order || 0));

/** Tap a day: toggle (goal 1) or +1. */
export function tapHabit(id: string, day = TODAY()) {
  const hb = S.habits[id]; if (hb) setDay(hb, day, tapValue(hb, day));
}

function setDay(hb: Habit, day: string, v: true | number | undefined) {
  const checks = { ...hb.checks };
  if (v === undefined) delete checks[day]; else checks[day] = v;
  upd('habits', { ...hb, checks });
}

/** Right-click or long-press a day: take one back, or clear it. `after` redraws the view. */
function dayMenu(anchor: Element, id: string, day: string, after: () => void) {
  const hb = S.habits[id]; if (!hb) return;
  const n = countOn(hb, day), g = goalOf(hb);
  const items: [string, () => void][] = [];
  if (g > 1) items.push(['+1', () => setDay(hb, day, checkValue(hb, n + 1))]);
  if (n > 0 && g > 1) items.push(['−1', () => setDay(hb, day, checkValue(hb, n - 1))]);
  if (g > 1 && n < g) items.push([`Done (${g})`, () => setDay(hb, day, checkValue(hb, g))]);
  if (n > 0) items.push(['Clear day', () => setDay(hb, day, undefined)]);
  else if (g === 1) items.push(['Done', () => setDay(hb, day, true)]);
  menu(anchor, items.map(([l, f]) => [l, () => { f(); after(); }] as [string, () => void]));
}

/** The goal in words, plus the reminder time. */
function sub(hb: Habit): string {
  const pw = perWeekOf(hb), g = goalOf(hb);
  const what = pw ? `${pw} ${pw === 1 ? 'time' : 'times'} a week` : 'every day';
  const parts = [g > 1 ? `${g}${hb.unit ? ' ' + esc(hb.unit) : ''} a day${pw ? ', ' + what : ''}` : what];
  if (hb.remind) parts.push(`${I.bell.replace('<svg', '<svg class="ib"')}${fmtTime(hb.remind)}`);
  return parts.join(' · ');
}

/** The count at the end of a row (Martian Mono): week progress, today's count, else the streak ("12d", "3w"). */
function stk(hb: Habit): { txt: string; label: string } {
  const today = TODAY(), pw = perWeekOf(hb), g = goalOf(hb), s = streak(hb, today, prefs.weekStart);
  const label = s.n ? `${s.n} ${s.unit}${s.n === 1 ? '' : 's'} streak` : 'No streak';
  if (pw) return { txt: `${doneInWeek(hb, today, prefs.weekStart)}/${pw}`, label: `${label}, ${doneInWeek(hb, today, prefs.weekStart)} of ${pw} this week` };
  if (g > 1) return { txt: `${countOn(hb, today)}/${g}`, label: `${label}, ${countOn(hb, today)} of ${g} today` };
  return { txt: s.n ? `${s.n}${s.unit[0]}` : '', label };
}

/** A 7, 30 or 100 day streak just reached: the log line plays once, as the one slow moment (M5). */
const MILESTONES = [7, 30, 100];
let mile: { id: string; n: number; at: number } | null = null;
export const milestoneHtml = (hb: Habit) => mile && mile.id === hb.id && Date.now() - mile.at < 4000
  ? `<span class="logl" role="status"><i class="dot" aria-hidden="true"></i>${mile.n}-day streak · ${esc(hb.name)}</span>` : '';

function dayBtn(hb: Habit, k: string) {
  const d = new Date(k + 'T00:00'), n = countOn(hb, k), g = goalOf(hb), done = n >= g, future = k > TODAY();
  // A partly done day shows its count and a ring filled to the goal; an empty day of a met week, a small mark.
  const ring = !done && n > 0 ? ` style="--p:${Math.round((n / g) * 100)}%"` : '';
  const fill = metWeekFill(hb, k, prefs.weekStart);
  return `<div class="wd ${k === TODAY() ? 'today' : ''}">${DOW[d.getDay()]![0]}<button class="${done ? 'on' : n ? 'part' : fill ? 'fill' : ''}"${ring} data-h="${hb.id}" data-d="${k}" ${future ? 'disabled' : ''} aria-label="${k}: ${n} of ${g}${fill ? ', week goal met' : ''}">${done ? (n > g ? n : I.check) : n ? n : ''}</button></div>`;
}

export function renderHabits() {
  const main = $('#main');
  const habits = live();
  main.innerHTML = `
    <div class="topbar"><h1>Habit</h1><button class="icon-btn" id="h-add" aria-label="Add habit">${I.plus}</button></div>
    <div class="content">
      ${habits.map(hb => { const c = stk(hb); return `<div class="habit ${doneOn(hb, TODAY()) ? 'today-done' : ''}" style="--hc:${hueOf(hb)}">
        <button class="h-open" data-hd="${hb.id}" aria-label="${esc(hb.name)}: details"><span class="h-info"><span class="h-name">${esc(hb.name)}</span><span class="s">${sub(hb)}</span></span></button>
        <div class="week">${stripDays(hb, TODAY(), prefs.weekStart).map(k => dayBtn(hb, k)).join('')}</div>
        <span class="stk" title="${c.label}" aria-label="${c.label}">${c.txt}</span>
        <button class="icon-btn" data-hm="${hb.id}" aria-label="More">${I.dots}</button>
      </div>${milestoneHtml(hb)}`; }).join('') || `<div class="empty">${emptyArt}<b>No habits yet</b><span>Small daily wins add up.</span></div>`}
    </div>`;
  bindDays(main, renderHabits);
  main.querySelectorAll<HTMLElement>('[data-hm]').forEach(b => b.onclick = () => {
    const hb = S.habits[b.dataset.hm!]!;
    menu(b, [
      ['Details', () => go('#/habits/' + hb.id)],
      ['Edit', () => habitEditor(b, hb, renderHabits)],
      ['Delete', () => { upd('habits', { ...hb, removed: true }); renderHabits(); }],
    ]);
  });
  main.querySelectorAll<HTMLElement>('[data-hd]').forEach(b => b.onclick = () => go('#/habits/' + b.dataset.hd));
  $('#h-add').onclick = e => habitEditor(e.currentTarget as Element, null, renderHabits);
}

/** Day buttons (`data-h`, `data-d`) under `root`: tap to check in, right-click or press and hold for the day menu. */
export function bindDays(root: HTMLElement, after: () => void) {
  root.querySelectorAll<HTMLElement>('[data-h]').forEach(b => {
    let held = false, timer: ReturnType<typeof setTimeout> | undefined;
    b.onclick = () => {
      if (held) { held = false; return; }
      const hb = S.habits[b.dataset.h!], was = hb && streak(hb, TODAY(), prefs.weekStart);
      tapHabit(b.dataset.h!, b.dataset.d!);
      const now = S.habits[b.dataset.h!], is = now && streak(now, TODAY(), prefs.weekStart);
      if (was && is && is.unit === 'day' && is.n > was.n && MILESTONES.includes(is.n)) mile = { id: now!.id, n: is.n, at: Date.now() };
      after();
    };
    b.oncontextmenu = e => { e.preventDefault(); dayMenu(b, b.dataset.h!, b.dataset.d!, after); };
    // Touch: press and hold opens the same menu.
    b.onpointerdown = e => { if (e.pointerType === 'mouse') return; timer = setTimeout(() => { held = true; dayMenu(b, b.dataset.h!, b.dataset.d!, after); }, 450); };
    b.onpointerup = b.onpointercancel = b.onpointerleave = () => clearTimeout(timer);
  });
}

/** Create or edit a habit: name, daily goal, frequency, reminder. `after` redraws the view. */
export function habitEditor(anchor: Element, hb: Habit | null, after: () => void) {
  const pw = hb ? perWeekOf(hb) : null;
  const p = popover(anchor, `
    <h4>${hb ? 'Edit habit' : 'New habit'}</h4>
    <input class="dlg-input" id="he-name" placeholder="e.g. Drink water" value="${esc(hb?.name || '')}">
    <div class="fld"><span class="lab">Goal</span><input type="number" id="he-goal" min="1" max="100" value="${hb ? goalOf(hb) : 1}" style="max-width:64px"><input id="he-unit" placeholder="times" value="${esc(hb?.unit || '')}" style="max-width:110px"><span class="hint">a day</span></div>
    <div class="fld"><span class="lab">Repeat</span><select id="he-freq">
      <option value="0">Every day</option>
      ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${pw === n ? 'selected' : ''}>${n} ${n === 1 ? 'day' : 'days'} a week</option>`).join('')}
    </select></div>
    <div class="fld" id="he-sin-row" ${pw ? '' : 'hidden'}><span class="lab">Streak</span><select id="he-sin">
      <option value="weeks">in weeks</option>
      <option value="days" ${hb?.streakIn === 'days' ? 'selected' : ''}>in days</option>
    </select><span class="hint">weeks that met the goal, or every day done</span></div>
    <div class="fld"><span class="lab">Remind</span><input type="time" id="he-rem" value="${hb?.remind || ''}"><span class="hint">if not done yet</span></div>
    <div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok>Save</button></div>`, 300);
  const name = $<HTMLInputElement>('#he-name', p); name.focus();
  const freq = $<HTMLSelectElement>('#he-freq', p);
  freq.onchange = () => { $('#he-sin-row', p).hidden = !+freq.value; };
  const save = () => {
    const n = name.value.trim(); if (!n) return name.focus();
    const goal = Math.min(100, Math.max(1, Math.floor(+$<HTMLInputElement>('#he-goal', p).value || 1)));
    const perWeek = +$<HTMLSelectElement>('#he-freq', p).value || null;
    const remind = $<HTMLInputElement>('#he-rem', p).value || null;
    const unit = $<HTMLInputElement>('#he-unit', p).value.trim() || null;
    const base = hb || { id: uid(), color: COLORS[live().length % 7]!, checks: {}, order: live().length, created: Date.now() };
    const streakIn = perWeek && $<HTMLSelectElement>('#he-sin', p).value === 'days' ? 'days' : null;
    upd('habits', { ...base, name: n, goal: goal > 1 ? goal : null, unit, perWeek, streakIn, remind });
    if (remind) askNotify(false);
    closePop(); after();
  };
  $('[data-ok]', p).onclick = save;
  $('[data-x]', p).onclick = closePop;
  p.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

/**
 * "Did you do these yesterday?" On the first look at a new day, a card lists
 * yesterday's habits that were due and not done, each with a tap to log it.
 * Once per day per device (localStorage), and only once synced data is here.
 */
export function askYesterday() {
  if (!session || S.checkpoint <= 0) return;
  const key = 'xairos.askedYesterday.' + session.user.id, today = TODAY();
  if (lsGet<string>(key) === today) return;
  lsSet(key, today);
  const list = missedYesterday(Object.values(S.habits), today, prefs.weekStart);
  if (!list.length) return;
  const y = ymd(addDays(parseYmd(today), -1));
  // What each day held before the card: a second tap puts it back.
  const before = new Map(list.map(hb => [hb.id, hb.checks[y]]));
  const card = h(`<div class="rem-card yd" data-rid="yesterday" role="dialog" aria-label="Yesterday's habits">
    <div class="rem-h">${I.check}<span>Yesterday</span><button class="icon-btn" data-x aria-label="Dismiss">${I.close}</button></div>
    <div class="rem-t">Did you do these yesterday?</div>
    <div class="yd-list">${list.map(hb => `<div class="yd-row" style="--c:${tc(hb.color)}">
      <span class="yd-n">${esc(hb.name)}<small></small></span>
      <button class="yd-b" data-y="${hb.id}" aria-label="${esc(hb.name)}: done yesterday" aria-pressed="false">${I.check}</button></div>`).join('')}</div>
    <div class="rem-b"><button class="btn pri" data-ok>Done</button></div></div>`);
  const paint = () => card.querySelectorAll<HTMLElement>('[data-y]').forEach(b => {
    const hb = S.habits[b.dataset.y!]; if (!hb) return;
    const done = doneOn(hb, y), g = goalOf(hb);
    b.classList.toggle('on', done); b.setAttribute('aria-pressed', String(done));
    b.parentElement!.querySelector('small')!.textContent = g > 1 ? `${countOn(hb, y)}/${g}${hb.unit ? ' ' + hb.unit : ''}` : '';
  });
  card.querySelectorAll<HTMLElement>('[data-y]').forEach(b => b.onclick = () => {
    const hb = S.habits[b.dataset.y!]; if (!hb) return;
    setDay(hb, y, doneOn(hb, y) ? before.get(hb.id) : checkValue(hb, goalOf(hb)));
    paint(); render();
  });
  $('[data-x]', card).onclick = $('[data-ok]', card).onclick = () => card.remove();
  $('#rem-stack').appendChild(card);
  paint();
}
