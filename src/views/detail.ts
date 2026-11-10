import type { RepeatRule, Task } from '../types';
import { $, esc, uid } from '../lib/util';
import { DOW, addDays, fmtTime, nextMonday, parseYmd, todayD, ymd } from '../lib/dates';
import { allZones, deviceTz, tzCity, when } from '../lib/tz';
import { firstOccurrence, repeatLabel } from '../recurrence';
import { trashDaysLeft, trashedAt } from '../lib/trash';
import {
  COLORS, S, avatarHtml, tc, canWrite, dueCls, dueText, inboxId, isShared, listColor, listName, peopleOf, touch, ui, userLists, userName, userOf,
} from '../store';
import { I } from '../ui/icons';
import { closePop, menu, popover, promptPop } from '../ui/popover';
import { del, moveTo, toggleDone } from '../actions';
import { askNotify } from './reminders';
import { focusedOn } from './focus';

const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
import { render } from '../app';

const autosize = (el: HTMLElement) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
export const REM_OPTS: [number, string][] = [[0, 'On time'], [5, '5 minutes early'], [30, '30 minutes early'], [60, '1 hour early'], [1440, '1 day early']];
const small = (svg: string) => svg.replace('<svg', '<svg style="width:14px;height:14px"');

export function renderDetail() {
  const pane = $('#detail');
  const t = ui.sel ? S.tasks[ui.sel] : undefined;
  const showPane = ['tasks', 'calendar', 'matrix', 'search'].includes(ui.route);
  if (!showPane || (!t && innerWidth <= 1100)) { pane.classList.add('hidden'); return; }
  pane.classList.remove('hidden');
  if (!t) { pane.innerHTML = `<div class="d-empty">${I.tasks}<span>Click a task title to view details</span></div>`; return; }
  const p = t.priority, ro = !canWrite(t.listId) || t.deleted;
  const l = S.lists[t.listId], shared = isShared(l);
  const people = peopleOf(l);
  const dueTxt = t.due ? dueText(t, true) : 'Due date';
  pane.innerHTML = `
    <div class="d-top">
      <button class="cb ${p ? 'p' + p : ''} ${t.done ? 'on' : ''}" id="d-cb" aria-label="Complete" ${ro ? 'disabled' : ''}>${I.check}</button>
      <button class="d-date ${t.due ? (dueCls(t) === 'late' ? 'late' : 'set') : ''}" id="d-date" ${ro ? 'disabled' : ''}>${I.cal}<span>${dueTxt}</span>${t.repeat ? small(I.repeat) : ''}${t.reminders?.length ? small(I.bell) : ''}</button>
      <span class="sp"></span>
      ${shared ? `<button class="icon-btn" id="d-assign" aria-label="Assign" ${ro ? 'disabled' : ''}>${t.assignee ? avatarHtml(S.users[t.assignee] || { id: t.assignee, name: '?' }, 22) : I.person}</button>` : ''}
      <button class="icon-btn flag ${p ? 'p' + p : ''}" id="d-flag" aria-label="Priority" ${ro ? 'disabled' : ''}>${p ? I.flagf : I.flag}</button>
      <button class="icon-btn" id="d-close" aria-label="Close">${I.close}</button>
    </div>
    ${ro ? `<div class="d-ro">${t.deleted ? `In Trash — restore it to edit.${trashedAt(t) > 0 ? ` Deleted for good in ${trashDaysLeft(t) === 1 ? '1 day' : trashDaysLeft(t) + ' days'}.` : ''}` : 'View only — shared by ' + esc(userName(l?.ownerId))}</div>` : ''}
    <div class="d-body">
      <textarea class="d-title" id="d-title" rows="1" placeholder="What would you like to do?" ${ro ? 'disabled' : ''}>${esc(t.title)}</textarea>
      <textarea class="d-desc" id="d-desc" placeholder="Description" ${ro ? 'disabled' : ''}>${esc(t.desc)}</textarea>
      <div id="d-items">${(t.items || []).map(i => `<div class="ck ${i.done ? 'done' : ''}" data-i="${i.id}"><button class="cb round ${i.done ? 'on' : ''}" data-icb ${ro ? 'disabled' : ''}>${I.check}</button><input value="${esc(i.title)}" ${ro ? 'disabled' : ''}>${ro ? '' : `<button class="icon-btn x" data-ix aria-label="Remove subtask">${I.close}</button>`}</div>`).join('')}</div>
      ${ro ? '' : `<label class="add-ck">${I.plus}<input id="d-add" placeholder="Add subtask"></label>`}
      <div class="d-tags">${(t.tags || []).map(g => `<span class="tag">#${esc(g)}</span>`).join('')}</div>
      <div class="d-info">
        ${t.repeat ? `<div>${I.repeat}${esc(repeatLabel(t.repeat))}</div>` : ''}
        ${t.reminders?.length && t.due ? `<div>${I.bell}${t.reminders.map(m => REM_OPTS.find(o => o[0] === m)?.[1] || m + ' min early').join(', ')}${t.time ? '' : ' (9:00 AM)'}</div>` : ''}
        ${t.snooze ? `<div>${I.bell}Snoozed until ${new Date(t.snooze).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
        ${focusedOn(t.id) ? `<div>${I.focus}Focused ${fmtMins(focusedOn(t.id))}</div>` : ''}
        ${shared ? `<div>${I.person}Created by ${esc(userName(t.createdBy))}${t.assignee ? ` · Assigned to ${esc(userName(t.assignee))}` : ''}</div>` : ''}
      </div>
    </div>
    <div class="d-foot">
      <button class="lst" id="d-list" ${ro ? 'disabled' : ''}><span class="dot" style="background:rgb(${listColor(t.listId)})"></span>${esc(listName(t.listId))}</button>
      ${ro ? '' : `<div style="display:flex;gap:2px"><button class="icon-btn" id="d-tag" aria-label="Tags">${I.tag}</button><button class="icon-btn" id="d-del" aria-label="Delete">${I.trash}</button></div>`}
    </div>`;
  const title = $<HTMLTextAreaElement>('#d-title'), desc = $<HTMLTextAreaElement>('#d-desc');
  autosize(title); autosize(desc);
  $('#d-close').onclick = () => { ui.sel = null; render(); };
  if (ro) return;
  title.oninput = () => { t.title = title.value.replace(/\n/g, ' '); autosize(title); touch(t); refreshRow(t); };
  title.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); desc.focus(); } };
  desc.oninput = () => { t.desc = desc.value; autosize(desc); touch(t); };
  $('#d-cb').onclick = () => toggleDone(t.id);
  $('#d-del').onclick = () => del(t.id);
  const setP = (v: number) => { touch(Object.assign(t, { priority: v })); render(); };
  $('#d-flag').onclick = e => menu(e.currentTarget as Element, [
    [`<span class="flag p5">${I.flagf}</span>High`, () => setP(5)], [`<span class="flag p3">${I.flagf}</span>Medium`, () => setP(3)],
    [`<span class="flag p1">${I.flagf}</span>Low`, () => setP(1)], [`<span class="flag" style="color:var(--t3)">${I.flag}</span>None`, () => setP(0)],
  ], true);
  $('#d-date').onclick = e => datePicker(e.currentTarget as Element, t);
  const as = $('#d-assign');
  if (as) as.onclick = e => menu(e.currentTarget as Element, [
    ['Unassigned', () => { touch(Object.assign(t, { assignee: null })); render(); }, !t.assignee],
    ...people.map(u => [`${avatarHtml(userOf(u))}${esc(userName(u))}`, () => { touch(Object.assign(t, { assignee: u })); render(); }, t.assignee === u] as [string, () => void, boolean]),
  ], true);
  $('#d-list').onclick = e => menu(e.currentTarget as Element, [
    [`<span class="dot" style="background:rgb(${tc(COLORS[7]!)})"></span>Inbox`, () => moveTo(t, inboxId())],
    ...userLists().filter(x => canWrite(x.id)).map(x => [`<span class="dot" style="background:rgb(${tc(x.color)})"></span>${esc(x.name)}`, () => moveTo(t, x.id)] as [string, () => void]),
  ], true);
  $('#d-tag').onclick = e => promptPop(e.currentTarget as Element, 'Tags', { placeholder: 'tag1, tag2', value: (t.tags || []).join(', ') }, v => {
    t.tags = [...new Set(v.split(',').map(s => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
    touch(t); closePop(); render();
  });
  pane.querySelectorAll<HTMLElement>('[data-i]').forEach(r => {
    const it = t.items.find(i => i.id === r.dataset.i)!;
    $('[data-icb]', r).onclick = () => { it.done = !it.done; touch(t); render(); };
    $('[data-ix]', r).onclick = () => { t.items = t.items.filter(i => i !== it); touch(t); render(); };
    const inp = $<HTMLInputElement>('input', r);
    inp.oninput = () => { it.title = inp.value; touch(t); };
    inp.onkeydown = e => {
      if (e.key === 'Enter') $('#d-add').focus();
      if (e.key === 'Backspace' && !inp.value) { t.items = t.items.filter(i => i !== it); touch(t); render(); setTimeout(() => $('#d-add')?.focus()); }
    };
  });
  const add = $<HTMLInputElement>('#d-add');
  add.onkeydown = e => {
    if (e.key === 'Enter' && add.value.trim()) {
      t.items = [...(t.items || []), { id: uid(), title: add.value.trim(), done: false }];
      touch(t); render(); setTimeout(() => $('#d-add')?.focus());
    }
  };
}

function refreshRow(t: Task) { document.querySelectorAll(`.row[data-id="${t.id}"] .title`).forEach(el => el.textContent = t.title || 'Untitled'); }

/** Time-block lengths (minutes) for the calendar's hour grid. */
const LENGTHS: [number, string][] = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, '8 hours']];
/** The preset lengths plus a resized one that is not a preset (e.g. 75 min). */
function lengthsFor(cur: number): [number, string][] {
  if (LENGTHS.some(([m]) => m === cur)) return LENGTHS;
  const lab = cur >= 60 ? `${Math.floor(cur / 60)} h ${cur % 60 ? (cur % 60) + ' min' : ''}`.trim() : `${cur} min`;
  return [...LENGTHS, [cur, lab] as [number, string]].sort((a, b) => a[0] - b[0]);
}

/** Date, time, reminder and repeat picker. */
function datePicker(anchor: Element, t: Task) {
  const r = t.repeat, rems = new Set(t.reminders || []);
  const repSel = !r ? 'none'
    : (r.freq === 'weekly' && (r.interval || 1) === 1 && (r.byDay || []).slice().sort().join() === '1,2,3,4,5') ? 'weekdays'
    : ((r.interval || 1) > 1 ? 'custom' : r.freq);
  const byDay = new Set(r?.byDay || (t.due ? [parseYmd(t.due).getDay()] : [todayD().getDay()]));
  const p = popover(anchor, `
    <div class="row-q">
      <button data-q="0">${I.sun}Today</button><button data-q="1">${I.tomorrow}Tomorrow</button><button data-q="w">${I.nextweek}Next week</button><button data-q="x">${I.nodate}Clear</button>
    </div>
    <div class="fld"><span class="lab">Date</span><input type="date" id="dp-d" value="${t.due || ''}"></div>
    <div class="fld"><span class="lab">Time</span><input type="time" id="dp-t" value="${t.time || ''}"></div>
    <div class="fld" id="dp-timeopts"><span class="lab">Zone</span><select id="dp-tz" title="Floating: the same clock time wherever you are. Pinned: that zone's time, shown in your local time elsewhere.">
      <option value="">Floating</option>
      ${[...new Set([deviceTz(), ...(t.tz ? [t.tz] : []), ...allZones()])].map(z => `<option value="${esc(z)}" ${t.tz === z && t.time ? 'selected' : ''}>${esc(tzCity(z))}${z === deviceTz() ? ' (this device)' : ` · ${esc(z)}`}</option>`).join('')}
    </select></div>
    <div class="fld" id="dp-here" hidden><span class="lab"></span><span class="hint" id="dp-here-t"></span></div>
    <div class="fld" id="dp-lenrow"><span class="lab">Length</span><select id="dp-len">${lengthsFor(t.dur || 30).map(([m, lab]) => `<option value="${m}" ${(t.dur || 30) === m ? 'selected' : ''}>${lab}</option>`).join('')}</select></div>
    <div class="fld" style="align-items:flex-start"><span class="lab" style="padding-top:3px">Remind</span><div class="opts">${REM_OPTS.map(([m, lab]) => `<label class="opt"><input type="checkbox" value="${m}" data-rem ${rems.has(m) ? 'checked' : ''}>${lab}</label>`).join('')}</div></div>
    <div class="fld"><span class="lab">Repeat</span><select id="dp-r">
      ${[['none', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['custom', 'Custom…']].map(([v, lab]) => `<option value="${v}" ${repSel === v ? 'selected' : ''}>${lab}</option>`).join('')}
    </select></div>
    <div class="fld" id="dp-custom"><span class="lab">Every</span><input type="number" min="1" max="365" id="dp-n" value="${r?.interval || 1}" style="max-width:70px"><select id="dp-u">${['daily', 'weekly', 'monthly', 'yearly'].map((f, i) => `<option value="${f}" ${r?.freq === f ? 'selected' : ''}>${['day(s)', 'week(s)', 'month(s)', 'year(s)'][i]}</option>`).join('')}</select></div>
    <div class="fld" id="dp-days"><span class="lab">On</span><div class="days">${DOW.map((d, i) => `<button type="button" data-wd="${i}" class="${byDay.has(i) ? 'on' : ''}">${d[0]}</button>`).join('')}</div></div>
    <div class="fld" id="dp-from"><span class="lab"></span><label class="opt"><input type="checkbox" id="dp-fc" ${r?.from === 'completion' ? 'checked' : ''}>Repeat from completion date</label></div>
    <div class="fld" id="dp-end"><span class="lab">Ends</span><input type="date" id="dp-until" value="${r?.until || ''}"></div>
    <div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok>OK</button></div>`, 320);
  const sel = $<HTMLSelectElement>('#dp-r', p), unit = $<HTMLSelectElement>('#dp-u', p);
  const val = (id: string) => $<HTMLInputElement>(id, p).value;
  const sync = () => {
    const v = sel.value;
    $('#dp-custom', p).hidden = v !== 'custom';
    $('#dp-days', p).hidden = !(v === 'weekly' || (v === 'custom' && unit.value === 'weekly'));
    $('#dp-from', p).hidden = $('#dp-end', p).hidden = v === 'none';
  };
  sel.onchange = unit.onchange = sync; sync();
  // Zone and length only mean something with a time; show the local time of a pinned one.
  const tzSel = $<HTMLSelectElement>('#dp-tz', p);
  const syncTime = () => {
    const d = val('#dp-d'), tm = val('#dp-t'), z = tzSel.value;
    $('#dp-timeopts', p).hidden = $('#dp-lenrow', p).hidden = !tm;
    const here = d && tm && z && z !== deviceTz() ? when({ due: d, time: tm, tz: z }) : null;
    $('#dp-here', p).hidden = !here;
    if (here) $('#dp-here-t', p).textContent = `${fmtTime(here.time)}${here.due !== d ? (here.due! > d ? ' next day' : ' previous day') : ''} here`;
  };
  ['#dp-d', '#dp-t'].forEach(s => $(s, p).addEventListener('input', syncTime));
  tzSel.onchange = syncTime; syncTime();
  p.querySelectorAll<HTMLElement>('[data-wd]').forEach(b => b.onclick = () => {
    const d = +b.dataset.wd!;
    if (byDay.has(d)) { if (byDay.size > 1) byDay.delete(d); } else byDay.add(d);
    b.classList.toggle('on', byDay.has(d));
  });
  // dueOverride: undefined = use the inputs, null = clear the date.
  const apply = (dueOverride?: string | null) => {
    let due = dueOverride !== undefined ? dueOverride : (val('#dp-d') || null);
    const time = due ? (val('#dp-t') || null) : null;
    const reminders = due ? [...p.querySelectorAll<HTMLInputElement>('[data-rem]:checked')].map(x => +x.value) : [];
    let repeat: RepeatRule | null = null; const v = sel.value;
    if (v !== 'none' && dueOverride !== null) {
      const freq = (v === 'weekdays' ? 'weekly' : v === 'custom' ? unit.value : v) as RepeatRule['freq'];
      repeat = {
        freq, interval: v === 'custom' ? Math.max(1, +val('#dp-n') || 1) : 1,
        byDay: v === 'weekdays' ? [1, 2, 3, 4, 5] : (freq === 'weekly' ? [...byDay].sort() : undefined),
        from: $<HTMLInputElement>('#dp-fc', p).checked ? 'completion' : 'due', until: val('#dp-until') || null, done: r?.done || 0,
      };
      if (!due) due = firstOccurrence(repeat);
      repeat.dom = parseYmd(due).getDate();
    }
    const tz = time ? tzSel.value || null : null, dur = time ? +$<HTMLSelectElement>('#dp-len', p).value : t.dur ?? null;
    touch(Object.assign(t, { due, time, tz, dur, reminders, repeat, snooze: null }));
    if (reminders.length) askNotify(false);
    closePop(); render();
  };
  p.querySelectorAll<HTMLElement>('[data-q]').forEach(b => b.onclick = () => {
    const q = b.dataset.q!;
    apply(q === 'x' ? null : q === 'w' ? nextMonday() : ymd(addDays(todayD(), +q)));
  });
  $('[data-ok]', p).onclick = () => apply();
  $('[data-x]', p).onclick = closePop;
}

