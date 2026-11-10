/**
 * In-tab reminders: system notification, beep and an in-app card. Fire only
 * while a tab is open. With background reminders on (src/push.ts) the server
 * sends the system notification, so this tab only beeps and shows the card.
 */
import type { Habit, Task } from '../types';
import { countOn, doneOn, goalOf, habitReminder } from '../habits';
import { tapHabit } from './habits';
import { $, esc, h, lsGet, lsSet } from '../lib/util';
import { TODAY, addDays, todayD } from '../lib/dates';
import { reminderTimes } from '../reminders';
import { S, dueText, hasDb, prefs, inboxId, listName, live, me, session, touch } from '../store';
import { I } from '../ui/icons';
import { menu } from '../ui/popover';
import { toast } from '../ui/toast';
import { guard, select, toggleDone } from '../actions';
import { go, render } from '../app';
import { closeTaskNotification, pushActive } from '../push';

const firedKey = () => 'xairos.fired.' + me();

export function checkReminders() {
  if (!session || !hasDb()) return;
  const now = Date.now(), fired = lsGet<Record<string, number>>(firedKey()) || {};
  let changed = false;
  for (const t of live()) {
    if (t.assignee && t.assignee !== me()) continue; // only remind the assignee on shared tasks
    for (const r of reminderTimes(t)) {
      if (r.at <= now && !fired[r.key]) {
        fired[r.key] = now; changed = true;
        if (now - r.at < 6 * 36e5) notifyTask(t);
      }
    }
  }
  const today = TODAY();
  for (const hb of Object.values(S.habits)) {
    const r = habitReminder(hb, today, undefined, prefs.weekStart);
    if (r && r.at <= now && !fired[r.key]) {
      fired[r.key] = now; changed = true;
      if (now - r.at < 6 * 36e5) notifyHabit(hb);
    }
  }
  if (changed) {
    for (const k in fired) if (now - fired[k]! > 30 * 864e5) delete fired[k];
    lsSet(firedKey(), fired);
  }
}

export function askNotify(explicit: boolean) {
  if (!('Notification' in window)) { if (explicit) toast('This browser does not support notifications'); return; }
  if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (explicit) toast(p === 'granted' ? 'Notifications enabled' : 'Notifications not enabled'); });
  else if (explicit) toast(Notification.permission === 'granted' ? 'Notifications are on' : 'Notifications are blocked in browser settings');
}

export function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC(); const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.15, ctx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .5);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .55);
  } catch { /* no audio */ }
}

function notifyTask(t: Task) {
  beep();
  if ('Notification' in window && Notification.permission === 'granted' && !pushActive()) {
    try {
      const n = new Notification(t.title || 'Reminder', { body: dueText(t) || 'Reminder', tag: t.id });
      n.onclick = () => { window.focus(); openTask(t.id); n.close(); };
    } catch { /* ignore */ }
  }
  const stack = $('#rem-stack');
  if (stack.querySelector(`[data-rid="${t.id}"]`)) return;
  const card = h(`<div class="rem-card" data-rid="${t.id}" role="alert">
    <div class="rem-h">${I.bell}<span>Reminder</span><button class="icon-btn" data-x aria-label="Dismiss">${I.close}</button></div>
    <div class="rem-t">${esc(t.title || 'Untitled')}</div><div class="rem-s">${esc(dueText(t))}${t.due ? ' · ' + esc(listName(t.listId)) : ''}</div>
    <div class="rem-b"><button class="btn pri" data-c>Complete</button><button class="btn sec" data-s>Snooze</button><button class="btn sec" data-o>Open</button></div></div>`);
  stack.appendChild(card);
  $('[data-x]', card).onclick = () => { card.remove(); closeTaskNotification(t.id); };
  $('[data-o]', card).onclick = () => { card.remove(); closeTaskNotification(t.id); openTask(t.id); };
  $('[data-c]', card).onclick = () => { card.remove(); const x = S.tasks[t.id]; if (x && !x.done) toggleDone(t.id); };
  $('[data-s]', card).onclick = e => {
    const snooze = (ms: number) => { card.remove(); const x = S.tasks[t.id]; if (!x || !guard(x)) return; touch(Object.assign(x, { snooze: Date.now() + ms })); render(); toast('Snoozed'); };
    const tm9 = addDays(todayD(), 1); tm9.setHours(9, 0);
    menu(e.currentTarget as Element, [['5 minutes', () => snooze(5 * 6e4)], ['15 minutes', () => snooze(15 * 6e4)], ['30 minutes', () => snooze(30 * 6e4)], ['1 hour', () => snooze(36e5)], ['Tomorrow 9:00', () => snooze(tm9.getTime() - Date.now())]]);
  };
}

function notifyHabit(hb: Habit) {
  beep();
  const g = goalOf(hb), n = countOn(hb, TODAY());
  const body = g > 1 ? `${n}/${g}${hb.unit ? ' ' + hb.unit : ''} today` : 'Not done yet today';
  if ('Notification' in window && Notification.permission === 'granted' && !pushActive()) {
    try {
      const nt = new Notification(hb.name, { body, tag: 'habit-' + hb.id });
      nt.onclick = () => { window.focus(); go('#/habits'); nt.close(); };
    } catch { /* ignore */ }
  }
  const stack = $('#rem-stack'), rid = 'habit-' + hb.id;
  if (stack.querySelector(`[data-rid="${rid}"]`)) return;
  const card = h(`<div class="rem-card" data-rid="${rid}" role="alert">
    <div class="rem-h">${I.bell}<span>Habit</span><button class="icon-btn" data-x aria-label="Dismiss">${I.close}</button></div>
    <div class="rem-t">${esc(hb.name)}</div><div class="rem-s">${esc(body)}</div>
    <div class="rem-b"><button class="btn pri" data-c>${g > 1 ? '+1' : 'Done'}</button><button class="btn sec" data-o>Open</button></div></div>`);
  stack.appendChild(card);
  const close = () => { card.remove(); closeTaskNotification(rid); };
  $('[data-x]', card).onclick = close;
  $('[data-o]', card).onclick = () => { close(); go('#/habits'); };
  // Done elsewhere since the card appeared: a tap would reset it, so leave it.
  $('[data-c]', card).onclick = () => { close(); const x = S.habits[hb.id]; if (x && !doneOn(x, TODAY())) tapHabit(hb.id); render(); };
}

export function dismissReminder(id: string) { $(`#rem-stack [data-rid="${id}"]`)?.remove(); closeTaskNotification(id); }

export function openTask(id: string) {
  const t = S.tasks[id]; if (!t) return;
  go('#/tasks/' + encodeURIComponent(t.listId === inboxId() ? inboxId() : t.listId));
  setTimeout(() => select(id), 30);
}

export function initReminders() { setInterval(checkReminders, 15000); }
