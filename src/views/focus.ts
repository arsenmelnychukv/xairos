/**
 * Focus: Pomodoro with short and long breaks, or a stopwatch, optionally
 * linked to a task. The timer runs on timestamps and is saved per
 * account, so a reload or a closed tab does not lose it.
 */
import type { FocusRecord } from '../types';
import { $, esc, lsGet, lsSet, uid } from '../lib/util';
import { TODAY, fmtDue, pad, ymd } from '../lib/dates';
import {
  DEFAULT_FOCUS, type FocusSettings, type Timer, clockSecs, focusedMins, idleTimer, nextPhase, pause, phaseSecs, running, start,
} from '../focus';
import { S, live, me, prefs, savePrefs, session, ui, upd } from '../store';
import { I } from '../ui/icons';
import { closePop, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { openTask } from './reminders';
import { playSound } from '../ui/sounds';
import { go } from '../app';

const settings = (): FocusSettings => ({ ...DEFAULT_FOCUS, ...(prefs.focus || {}) });
const key = () => 'xairos.timer.' + me();
let T: Timer | null = null, owner = '';

/** This account's timer, loaded once per account. */
function timer(): Timer {
  if (!T || owner !== me()) { owner = me(); T = { ...idleTimer(settings()), ...(lsGet<Timer>(key()) || {}) }; }
  return T;
}
function save(t: Timer) { T = t; lsSet(key(), t); }

const fmtClock = (s: number) => { s = Math.max(0, Math.ceil(s)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const PHASE_LABEL = { focus: 'focus', short: 'short break', long: 'long break' } as const;
const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ` : '') + (m % 60 || m < 60 ? `${m % 60}m` : '').trim();

function frac(t: Timer) {
  const secs = clockSecs(t);
  return t.mode === 'pomo' ? 1 - secs / phaseSecs(t.phase, settings()) : (secs % 3600) / 3600;
}
const started = (t: Timer) => running(t) || (t.mode === 'pomo' ? t.left < phaseSecs(t.phase, settings()) : t.swAcc > 0);

/** Total focus minutes linked to a task. */
export const focusedOn = (taskId: string) => Object.values(S.focus).filter(f => !f.removed && f.taskId === taskId).reduce((a, f) => a + f.mins, 0);

/** Link the timer to a task and open Focus. */
export function focusOn(taskId: string) {
  const t = S.tasks[taskId]; if (!t) return;
  save({ ...timer(), task: t.title, taskId });
  go('#/focus');
}

export function renderFocus() {
  const main = $('#main');
  const t = timer(), s = settings();
  const recs = Object.values(S.focus).filter(f => !f.removed).sort((a, b) => a.start - b.start);
  const today = recs.filter(f => ymd(new Date(f.start)) === TODAY());
  const mins = today.reduce((a, f) => a + f.mins, 0), all = recs.reduce((a, f) => a + f.mins, 0);
  // "focus · 2 of 4": the phase and where it sits in the cycle (Gate A).
  const base = t.mode === 'sw' ? 'stopwatch' : t.phase === 'focus' ? `focus · ${t.cycle + 1} of ${s.longEvery}` : t.phase === 'short' ? `short break · ${t.cycle} of ${s.longEvery}` : 'long break';
  const label = base + (!running(t) && started(t) ? ' · paused' : '');
  const linked = t.taskId ? S.tasks[t.taskId] : undefined;
  const rec = (f: FocusRecord) => {
    const d = new Date(f.start), task = f.taskId ? S.tasks[f.taskId] : undefined;
    return `<div class="ses"><span class="mono">${pad(d.getHours())}:${pad(d.getMinutes())}</span><span class="ses-t">${task
      ? `<button class="rec-task" data-open="${task.id}">${esc(task.title || f.task || 'Task')}</button>` : `<span class="rec-note">${esc(f.task || 'Focus')}</span>`}</span><span class="mono">${f.mins}m</span></div>`;
  };
  const earlier = recs.filter(f => ymd(new Date(f.start)) !== TODAY()).reverse().slice(0, 10);
  const recE = (f: FocusRecord) => rec(f).replace('<span class="mono">', `<span class="mono" title="${esc(fmtDue(ymd(new Date(f.start))))}">`).replace(/^<div class="ses">/, '<div class="ses early">');
  const dots = t.mode === 'pomo' ? `<div class="f-cycle" title="Sessions until the long break">${Array.from({ length: s.longEvery }, (_, i) => `<i class="${i < t.cycle ? 'on' : ''}"></i>`).join('')}</div>` : '';
  main.innerHTML = `
    <div class="topbar"><h1>Focus</h1>
      <div class="seg"><button class="${t.mode === 'pomo' ? 'on' : ''}" data-m="pomo">Pomo</button><button class="${t.mode === 'sw' ? 'on' : ''}" data-m="sw">Stopwatch</button></div>
      <button class="icon-btn" id="f-set" aria-label="Focus settings">${I.dots}</button>
    </div>
    <div class="content"><div class="focus">
      <div class="focus-l">
        <span class="f-phase mono">${label}</span>
        <div class="f-clock mono" id="f-time" role="timer" aria-label="Time left">${fmtClock(clockSecs(t))}</div>
        <div class="f-track ${t.phase !== 'focus' && t.mode === 'pomo' ? 'brk' : ''}" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(frac(t) * 100)}"><b id="f-bar" style="transform:scaleX(${frac(t)})"></b></div>
        <div class="f-task ${linked ? 'linked' : ''}">
          ${linked ? `<span class="cb ${linked.done ? 'on' : ''}" aria-hidden="true">${I.check}</span>${linked.priority ? `<span class="pm p${linked.priority}" aria-hidden="true"></span>` : ''}` : ''}
          <input id="f-task" placeholder="Focus on…" value="${esc(linked ? linked.title : t.task)}" ${linked ? 'readonly' : ''}>
          ${linked && linked.dur ? `<span class="mono f-dur">${fmtMins(linked.dur)}</span>` : ''}
          ${linked ? `<button class="icon-btn" id="f-unlink" aria-label="Unlink task" title="Unlink task">${I.close}</button>` : `<button class="icon-btn" id="f-pick" aria-label="Pick a task" title="Pick a task">${I.tasks}</button>`}
        </div>
        ${dots}
        <div class="f-btns">
          ${running(t) ? `<button class="btn pri" id="f-pause">Pause</button>` : `<button class="btn pri" id="f-start">${started(t) ? 'Continue' : t.phase === 'focus' || t.mode === 'sw' ? 'Start' : 'Start break'}</button>`}
          ${t.mode === 'pomo' && t.phase !== 'focus' ? `<button class="btn sec" id="f-skip">Skip</button>` : started(t) ? `<button class="btn sec" id="f-stop">End</button>` : ''}
        </div>
      </div>
      <div class="focus-r">
        <h4 class="f-h">Today</h4>
        <div class="sess">${today.slice().reverse().map(rec).join('') || '<div class="f-none">No sessions yet</div>'}</div>
        <span class="mono f-sum">${fmtMins(mins)} focused today</span>
        <div class="stats">
          <div class="stat"><div class="k">Today's Pomos</div><div class="v">${today.filter(f => f.mins >= s.focus * .8).length}</div></div>
          <div class="stat"><div class="k">Today's Focus</div><div class="v">${fmtMins(mins)}</div></div>
          <div class="stat"><div class="k">Total Pomos</div><div class="v">${recs.filter(f => f.mins >= s.focus * .8).length}</div></div>
          <div class="stat"><div class="k">Total Focus</div><div class="v">${fmtMins(all)}</div></div>
        </div>
        ${earlier.length ? `<h4 class="f-h">Earlier</h4><div class="sess">${earlier.map(recE).join('')}</div>` : ''}
      </div>
    </div></div>`;

  main.querySelectorAll<HTMLElement>('[data-m]').forEach(b => b.onclick = () => {
    if (running(timer()) || started(timer())) return toast('End the current session first');
    const cur = timer();
    save(idleTimer(s, { mode: b.dataset.m as Timer['mode'], task: cur.task, taskId: cur.taskId, cycle: cur.cycle })); renderFocus();
  });
  const inp = $<HTMLInputElement>('#f-task');
  inp.oninput = () => save({ ...timer(), task: inp.value, taskId: null });
  $('#f-pick')?.addEventListener('click', e => pickTask(e.currentTarget as Element));
  $('#f-unlink')?.addEventListener('click', () => { save({ ...timer(), taskId: null, task: '' }); renderFocus(); });
  $('#f-start')?.addEventListener('click', () => { save(start(timer())); renderFocus(); });
  $('#f-pause')?.addEventListener('click', () => { save(pause(timer())); renderFocus(); });
  $('#f-stop')?.addEventListener('click', () => endSession(true));
  $('#f-skip')?.addEventListener('click', () => { save(nextPhase(timer(), s, false)); renderFocus(); });
  $('#f-set').onclick = e => settingsPop(e.currentTarget as Element);
  main.querySelectorAll<HTMLElement>('[data-open]').forEach(b => b.onclick = () => openTask(b.dataset.open!));
}

/** Pick an open task to focus on: today's and overdue first, then the rest. */
function pickTask(anchor: Element) {
  const today = TODAY();
  const open = live().filter(t => !t.done).sort((a, b) => +!(a.due && a.due <= today) - +!(b.due && b.due <= today) || (a.due || '9').localeCompare(b.due || '9'));
  const p = popover(anchor, `<input class="dlg-input" id="fp-q" placeholder="Search tasks"><div class="fp-list" id="fp-list"></div>`, 300);
  const list = $('#fp-list', p), q = $<HTMLInputElement>('#fp-q', p);
  const draw = () => {
    const needle = q.value.trim().toLowerCase();
    const hits = open.filter(t => !needle || t.title.toLowerCase().includes(needle)).slice(0, 8);
    list.innerHTML = hits.map(t => `<div class="mi" data-t="${t.id}">${esc(t.title || 'Untitled')}<span class="kbd">${t.due ? esc(fmtDue(t.due)) : ''}</span></div>`).join('') || '<div class="mi" style="color:var(--t3)">No open tasks</div>';
    list.querySelectorAll<HTMLElement>('[data-t]').forEach(el => el.onclick = () => { closePop(); focusOn(el.dataset.t!); renderFocus(); });
  };
  q.oninput = draw; draw(); q.focus();
}

function settingsPop(anchor: Element) {
  const s = settings();
  const num = (id: string, v: number, min: number, max: number, unit: string) =>
    `<input type="number" id="${id}" min="${min}" max="${max}" value="${v}" style="max-width:64px"><span class="hint">${unit}</span>`;
  const p = popover(anchor, `
    <h4>Pomo settings</h4>
    <div class="fld"><span class="lab">Focus</span>${num('fs-f', s.focus, 1, 180, 'min')}</div>
    <div class="fld"><span class="lab">Short break</span>${num('fs-s', s.short, 1, 60, 'min')}</div>
    <div class="fld"><span class="lab">Long break</span>${num('fs-l', s.long, 1, 90, 'min')}</div>
    <div class="fld"><span class="lab">Long break</span>${num('fs-e', s.longEvery, 2, 12, 'after this many')}</div>
    <div class="fld"><span class="lab"></span><label class="opt"><input type="checkbox" id="fs-a" ${s.autoStart ? 'checked' : ''}>Start breaks and the next focus by themselves</label></div>
    <div class="fld"><span class="lab">Sounds</span><span class="opts">
      <label class="opt"><input type="checkbox" id="fs-sf" ${prefs.sounds?.focusEnd ? 'checked' : ''}>Bell when focus ends</label>
      <label class="opt"><input type="checkbox" id="fs-sb" ${prefs.sounds?.breakEnd ? 'checked' : ''}>Two tones when a break ends</label>
      <label class="opt"><input type="checkbox" id="fs-st" ${prefs.sounds?.taskDone ? 'checked' : ''}>Tick when a task is completed</label></span></div>
    <div class="btns"><button class="btn sec" data-x>Cancel</button><button class="btn pri" data-ok>Save</button></div>`, 320);
  const n = (id: string, min: number, max: number, d: number) => Math.min(max, Math.max(min, Math.round(+$<HTMLInputElement>(id, p).value || d)));
  $('[data-x]', p).onclick = closePop;
  $('[data-ok]', p).onclick = () => {
    prefs.focus = { focus: n('#fs-f', 1, 180, 25), short: n('#fs-s', 1, 60, 5), long: n('#fs-l', 1, 90, 15), longEvery: n('#fs-e', 2, 12, 4), autoStart: $<HTMLInputElement>('#fs-a', p).checked };
    prefs.sounds = { focusEnd: $<HTMLInputElement>('#fs-sf', p).checked, breakEnd: $<HTMLInputElement>('#fs-sb', p).checked, taskDone: $<HTMLInputElement>('#fs-st', p).checked };
    savePrefs(); closePop();
    // An idle timer takes the new length right away.
    const t = timer();
    if (!started(t)) save({ ...t, left: phaseSecs(t.phase, settings()) });
    renderFocus();
  };
}

/** Save the focus done so far as a record. */
function record(t: Timer, mins: number) {
  if (mins < 1) return;
  const task = t.taskId ? S.tasks[t.taskId] : undefined;
  upd('focus', { id: uid(), start: t.startedAt || Date.now() - mins * 6e4, mins, task: task?.title || t.task, taskId: task ? task.id : null });
}

/** End the session by hand: record the focus done, reset. */
function endSession(manual: boolean) {
  const t = timer(), s = settings();
  if (t.mode === 'sw' || t.phase === 'focus') record(t, focusedMins(t, s));
  save(idleTimer(s, { mode: t.mode, task: t.task, taskId: t.taskId, cycle: t.mode === 'pomo' && t.phase === 'focus' ? t.cycle : 0 }));
  document.title = 'xairos';
  if (!manual) toast('Session ended');
  if (ui.route === 'focus') renderFocus();
}

/** A Pomo phase ran out: record focus, move to the break (or back to focus). */
function phaseDone(t: Timer) {
  const s = settings();
  playSound(t.phase === 'focus' ? 'focusEnd' : 'breakEnd', prefs.sounds);
  let next: Timer;
  if (t.phase === 'focus') {
    record(t, s.focus);
    next = nextPhase(t, s, true);
    notify('Focus complete', next.phase === 'long' ? `Time for a ${s.long}-minute long break.` : `Time for a ${s.short}-minute break.`);
  } else {
    next = nextPhase(t, s, false);
    notify('Break over', 'Ready for the next focus session.');
  }
  // Auto-start continues from when the phase ended, so time spent with the tab closed counts.
  if (s.autoStart) next = start(next, Math.min(Date.now(), t.endAt || Date.now()));
  save(next);
  if (ui.route === 'focus') renderFocus();
}

function notify(title: string, body: string) {
  toast(title + ' — ' + body);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'xairos-focus' }); } catch { /* ignore */ }
}

/** One loop for every account: finish phases on time, keep the clock and tab title current. */
export function initFocus() {
  setInterval(() => {
    if (!session) return;
    let t = timer();
    // Several phases may have passed while the tab was closed (with auto-start on).
    for (let i = 0; i < 20 && t.mode === 'pomo' && t.endAt && t.endAt <= Date.now(); i++) { phaseDone(t); t = timer(); }
    if (ui.route === 'focus') {
      const el = document.getElementById('f-time'); if (el) el.textContent = fmtClock(clockSecs(t));
      const bar = document.getElementById('f-bar'); if (bar) bar.style.transform = `scaleX(${frac(t)})`;
    }
    document.title = running(t) ? `${fmtClock(clockSecs(t))} · ${t.phase === 'focus' || t.mode === 'sw' ? 'Focus' : 'Break'} · xairos` : 'xairos';
  }, 250);
}
