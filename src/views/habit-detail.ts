/** One habit's page (#/habits/<id>): stats, a year heatmap to fix past days, per-month counts and best streaks. */
import type { Habit, Ymd } from '../types';
import { $, esc } from '../lib/util';
import { DOW, MON, TODAY, addDays, parseYmd, ymd } from '../lib/dates';
import { weekStartOf } from '../calendar';
import { countOn, dayLevel, doneOn, goalOf, habitStats, metWeekFill, perMonth, perWeekOf, yearWeeks, type Run } from '../habits';
import { S, prefs, ui, upd } from '../store';
import { I } from '../ui/icons';
import { menu } from '../ui/popover';
import { go } from '../app';
import { bindDays, habitEditor, hueOf, milestoneHtml } from './habits';

const LEVEL_NAME = { none: 'not done', part: 'partly done', done: 'done', over: 'over goal' };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shortDate = (d: Ymd, year = true) => { const x = parseYmd(d); return `${MON[x.getMonth()]} ${x.getDate()}${year ? ', ' + x.getFullYear() : ''}`; };

function heatmap(hb: Habit, year: number, today: Ymd): string {
  const weeks = yearWeeks(year, prefs.weekStart), g = goalOf(hb), y = String(year);
  // Month label on the first week that holds the 1st of that month.
  const months = weeks.map(w => { const first = w.find(d => d.startsWith(y) && d.endsWith('-01')); return first ? MON[+first.slice(5, 7) - 1]! : ''; });
  const rows = Array.from({ length: 7 }, (_, i) => DOW[(prefs.weekStart + i) % 7]!);
  const cells = weeks.map(w => w.map(d => {
    if (!d.startsWith(y)) return '<span class="hm-c out"></span>';
    const lv = dayLevel(hb, d), n = countOn(hb, d), fill = metWeekFill(hb, d, prefs.weekStart);
    const label = `${shortDate(d)}: ${g > 1 ? `${n} of ${g}` : LEVEL_NAME[lv]}${fill ? ', week goal met' : ''}`;
    return `<button class="hm-c ${lv}${fill ? ' fill' : ''}${d === today ? ' today' : ''}" data-h="${hb.id}" data-d="${d}" ${d > today ? 'disabled' : ''} aria-label="${label}" title="${label}"></button>`;
  }).join('')).join('');
  return `<div class="hm-scroll"><div class="hm" style="--weeks:${weeks.length}">
    <span class="hm-corner"></span>${months.map(m => `<span class="hm-m">${m}</span>`).join('')}
    <div class="hm-days">${rows.map((r, i) => `<span>${i % 2 ? '' : r}</span>`).join('')}</div>
    <div class="hm-grid">${cells}</div>
  </div></div>`;
}

/** All habits, last 12 weeks, in orchid: each day's share of habits done (five steps, as on the board). */
function overview(today: Ymd): string {
  const hs = Object.values(S.habits).filter(x => !x.removed);
  const start = addDays(weekStartOf(parseYmd(today), prefs.weekStart), -77);
  const cells = Array.from({ length: 84 }, (_, i) => {
    const d = ymd(addDays(start, i));
    if (d > today || !hs.length) return `<i class="ov-c future"></i>`;
    const n = hs.filter(x => doneOn(x, d)).length, lv = Math.round((n / hs.length) * 4);
    return `<i class="ov-c l${lv}" title="${shortDate(d)}: ${n} of ${hs.length} habits"></i>`;
  }).join('');
  return `<div class="hm-scroll"><div class="ov-grid" role="img" aria-label="All habits, last 12 weeks">${cells}</div></div>`;
}

function legend(hb: Habit): string {
  const lv: (keyof typeof LEVEL_NAME)[] = goalOf(hb) > 1 ? ['none', 'part', 'done', 'over'] : ['none', 'done'];
  const met = perWeekOf(hb) ? '<span><i class="hm-c none fill"></i>Week goal met</span>' : '';
  return `<div class="hm-legend">${lv.map(l => `<span><i class="hm-c ${l}"></i>${l === 'none' ? 'Not done' : l === 'part' ? 'Partly' : l === 'done' ? 'Done' : 'Over goal'}</span>`).join('')}${met}</div>`;
}

function monthBars(hb: Habit, year: number, today: Ymd): string {
  const cur = +today.slice(0, 4), end = year < cur ? `${year}-12-31` : today;
  const data = perMonth(hb, end, year < cur ? 12 : +today.slice(5, 7));
  const max = Math.max(1, ...data.map(m => m.n));
  return `<div class="hd-bars" role="list">${data.map(m => {
    const name = MON[+m.month.slice(5) - 1]!;
    return `<div class="hd-bar" role="listitem" aria-label="${name}: ${plural(m.n, 'day')}"><span class="v">${m.n || ''}</span><i style="height:${(m.n / max) * 100}%"></i><span class="k">${name[0]}</span></div>`;
  }).join('')}</div>`;
}

function topRuns(top: Run[], unit: 'day' | 'week'): string {
  if (!top.length) return '<div class="hd-none">No streaks yet.</div>';
  const max = top[0]!.n;
  return top.map(r => {
    const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
    return `<div class="hd-run"><span class="d">${shortDate(r.start, !sameYear)} – ${shortDate(r.end)}</span><span class="b"><i style="width:${(r.n / max) * 100}%"></i></span><span class="n">${plural(r.n, unit)}</span></div>`;
  }).join('');
}

export function renderHabitDetail(id: string) {
  const hb = S.habits[id];
  // Before the first pull the habit may just not be here yet: wait, don't leave a deep link.
  if (!hb && S.checkpoint <= 0) { $('#main').innerHTML = '<div class="topbar"><h1></h1></div>'; return; }
  if (!hb || hb.removed) return go('#/habits');
  const main = $('#main'), today = TODAY(), cur = +today.slice(0, 4);
  const firstYear = Math.min(cur, ...Object.keys(hb.checks).map(d => +d.slice(0, 4)));
  const year = Math.min(cur, Math.max(firstYear, ui.habitYear ?? cur));
  const st = habitStats(hb, today, prefs.weekStart), pw = perWeekOf(hb), g = goalOf(hb);
  const rate = st.rate === null ? '—' : `${Math.round(st.rate * 100)}%`;
  const what = [pw ? `${pw}× a week` : 'Every day', g > 1 ? `${g}${hb.unit ? ' ' + esc(hb.unit) : ''} a day` : ''].filter(Boolean).join(' · ');
  main.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="hd-back" aria-label="Back to habits">${I.left}</button>
      <h1>${esc(hb.name)}</h1>
      <button class="icon-btn" id="hd-more" aria-label="More">${I.dots}</button>
    </div>
    <div class="content hd" style="--hc:${hueOf(hb)}">
      <div class="hd-what">${what}</div>
      ${milestoneHtml(hb)}
      <div class="hd-stats">
        <div class="stat"><div class="k">Current streak</div><div class="v">${st.current}<small> ${st.unit}${st.current === 1 ? '' : 's'}</small></div></div>
        <div class="stat"><div class="k">Best streak</div><div class="v">${st.best}<small> ${st.unit}${st.best === 1 ? '' : 's'}</small></div></div>
        <div class="stat"><div class="k">Completion rate</div><div class="v">${rate}</div></div>
        <div class="stat"><div class="k">Days done</div><div class="v">${st.total}</div></div>
      </div>
      <section class="hd-sec">
        <div class="hd-head"><h2>${year}</h2>
          <button class="icon-btn" id="hd-prev" aria-label="Previous year" ${year <= firstYear ? 'disabled' : ''}>${I.left}</button>
          <button class="icon-btn" id="hd-next" aria-label="Next year" ${year >= cur ? 'disabled' : ''}>${I.right}</button>
        </div>
        ${heatmap(hb, year, today)}
        ${legend(hb)}
      </section>
      <section class="hd-sec"><div class="hd-head"><h2>All habits</h2></div>${overview(today)}</section>
      <section class="hd-sec"><div class="hd-head"><h2>Days done per month</h2></div>${monthBars(hb, year, today)}</section>
      <section class="hd-sec"><div class="hd-head"><h2>Best streaks</h2></div>${topRuns(st.top, st.unit)}</section>
    </div>`;
  const redraw = () => renderHabitDetail(id);
  bindDays(main, redraw);
  $('#hd-back').onclick = () => go('#/habits');
  $('#hd-prev').onclick = () => { ui.habitYear = year - 1; redraw(); };
  $('#hd-next').onclick = () => { ui.habitYear = year + 1; redraw(); };
  $('#hd-more').onclick = e => {
    const b = e.currentTarget as Element;
    menu(b, [
      ['Edit', () => habitEditor(b, hb, redraw)],
      ['Delete', () => { upd('habits', { ...hb, removed: true }); go('#/habits'); }],
    ]);
  };
  // Show the latest weeks first when the year does not fit.
  const sc = main.querySelector<HTMLElement>('.hm-scroll');
  if (sc && year === cur) sc.scrollLeft = sc.scrollWidth;
}
