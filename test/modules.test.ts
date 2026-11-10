/** Module depth: habit goals and weekly targets, the focus timer, kanban columns. */
import { describe, expect, it } from 'vitest';
import { checkValue, countOn, dayLevel, doneInWeek, doneOn, habitReminder, habitStats, metWeekFill, missedYesterday, perMonth, runs, stillDue, streak, stripDays, tapValue, yearWeeks } from '../src/habits';
import { DEFAULT_FOCUS, clockSecs, focusedMins, idleTimer, nextPhase, pause, start } from '../src/focus';
import { byColumn, columnsOf, moveColumn } from '../src/kanban';
import { mergeEntity } from '../src/sync/fields';
import type { Habit, List, Task } from '../src/types';

const habit = (o: Partial<Habit> = {}): Habit => ({ id: 'h', name: 'Water', color: '0,0,0', checks: {}, order: 0, created: 1, ...o });

describe('habits', () => {
  it('counts toward a daily goal; old `true` check-ins count as done', () => {
    const h = habit({ goal: 8, checks: { '2026-11-05': 3, '2026-11-04': true } });
    expect(countOn(h, '2026-11-05')).toBe(3);
    expect(doneOn(h, '2026-11-05')).toBe(false);
    expect(doneOn(h, '2026-11-04')).toBe(true);
  });

  it('a tap toggles a goal of 1, and adds one past a bigger goal without wiping the day', () => {
    expect(tapValue(habit(), '2026-11-05')).toBe(true);
    expect(tapValue(habit({ checks: { '2026-11-05': true } }), '2026-11-05')).toBeUndefined();
    expect(tapValue(habit({ goal: 3, checks: { '2026-11-05': 2 } }), '2026-11-05')).toBe(3);
    expect(tapValue(habit({ goal: 3, checks: { '2026-11-05': 3 } }), '2026-11-05')).toBe(4);
    expect(checkValue(habit({ goal: 3 }), 0)).toBeUndefined(); // −1 from 1 clears the day
    expect(checkValue(habit(), 1)).toBe(true);
  });

  it('daily streaks end today, or yesterday while today is open', () => {
    const h = habit({ checks: { '2026-11-02': true, '2026-11-03': true, '2026-11-04': true } });
    expect(streak(h, '2026-11-05')).toEqual({ n: 3, unit: 'day' });
    expect(streak({ ...h, checks: { ...h.checks, '2026-11-05': true } }, '2026-11-05').n).toBe(4);
    expect(streak(habit({ goal: 2, checks: { '2026-11-04': 1 } }), '2026-11-05').n).toBe(0); // below goal is not done
  });

  it('"3 times a week" counts weeks that met the target (weeks start Monday)', () => {
    // Week of 26 Oct: 3 days. Week of 2 Nov: 2 days so far.
    const h = habit({ perWeek: 3, checks: { '2026-10-26': true, '2026-10-28': true, '2026-10-30': true, '2026-11-02': true, '2026-11-04': true } });
    expect(doneInWeek(h, '2026-11-05', 1)).toBe(2);
    expect(streak(h, '2026-11-05', 1)).toEqual({ n: 1, unit: 'week' });
    expect(streak({ ...h, checks: { ...h.checks, '2026-11-05': true } }, '2026-11-05', 1).n).toBe(2);
    // Sunday weeks split them differently: 1 Nov starts the week.
    expect(doneInWeek(h, '2026-11-05', 0)).toBe(2);
  });

  it('"3 times a week" in days: met weeks add their done days, this week counts while it can still be met', () => {
    // Two full weeks of 3, then 2 so far in the week of 2 Nov (Thu 5 Nov: 4 days left, needs 1).
    const h = habit({ perWeek: 3, streakIn: 'days', checks: {
      '2026-10-19': true, '2026-10-21': true, '2026-10-23': true,
      '2026-10-26': true, '2026-10-28': true, '2026-10-30': true, '2026-10-31': true,
      '2026-11-02': true, '2026-11-04': true,
    } });
    expect(streak(h, '2026-11-05', 1)).toEqual({ n: 9, unit: 'day' });
    // A week below target ends the run: drop one day from the week of 19 Oct.
    const { '2026-10-19': _, ...gap } = h.checks;
    expect(streak({ ...h, checks: gap }, '2026-11-05', 1).n).toBe(6);
    // Sunday 8 Nov with 2 done: today can still make it 3.
    expect(streak(h, '2026-11-08', 1).n).toBe(9);
    // Sunday with 1 done: the week can no longer reach 3, so the streak breaks now, not on Monday.
    const { '2026-11-04': __, ...one } = h.checks;
    expect(streak({ ...h, checks: one }, '2026-11-08', 1)).toEqual({ n: 0, unit: 'day' });
    // Weeks mode (unset) is unchanged.
    expect(streak({ ...h, streakIn: null }, '2026-11-05', 1)).toEqual({ n: 2, unit: 'week' });
  });

  it('reminds every day for daily habits, weekly ones only when they cannot wait', () => {
    const daily = habit({ remind: '20:00' });
    expect(new Date(habitReminder(daily, '2026-11-05', 'Europe/Berlin')!.at).toISOString()).toBe('2026-11-05T19:00:00.000Z');
    expect(habitReminder(habit(), '2026-11-05')).toBeNull(); // no reminder set
    // 3 a week, Monday weeks, none done: Thu (4 days left) can wait; Fri (3 left) cannot.
    const weekly = habit({ remind: '20:00', perWeek: 3 });
    expect(stillDue(weekly, '2026-11-05', 1)).toBe(false);
    expect(stillDue(weekly, '2026-11-06', 1)).toBe(true);
    // 2 a week with one done by Saturday: Sat and Sun left, 1 needed → can still wait until Sunday.
    const half = habit({ perWeek: 2, checks: { '2026-11-02': true } });
    expect(stillDue(half, '2026-11-07', 1)).toBe(false);
    expect(stillDue(half, '2026-11-08', 1)).toBe(true);
    expect(stillDue({ ...half, checks: { ...half.checks, '2026-11-03': true } }, '2026-11-08', 1)).toBe(false); // target met
  });

  it('weekly habits show the current week; daily ones the last 7 days', () => {
    expect(stripDays(habit({ perWeek: 3 }), '2026-11-05', 1)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(stripDays(habit(), '2026-11-05', 1)[0]).toBe('2026-10-30');
    expect(stripDays(habit(), '2026-11-05', 1)[6]).toBe('2026-11-05');
  });

  it('counts on two devices merge per day', () => {
    const a = habit({ goal: 8, checks: { '2026-11-05': 4 }, fm: { 'checks.2026-11-05': 20 } });
    const b = habit({ goal: 8, checks: { '2026-11-05': 3, '2026-11-04': 8 }, fm: { 'checks.2026-11-05': 10, 'checks.2026-11-04': 5 } });
    expect(mergeEntity('habits', a, b).checks).toEqual({ '2026-11-05': 4, '2026-11-04': 8 });
  });
});

describe('habit stats', () => {
  const days = (...d: string[]) => Object.fromEntries(d.map(x => [x, true as const]));

  it('daily: total, rate since the first check-in, and an open today is not a miss', () => {
    // First check-in Mon 2 Nov; today Thu 5 Nov, not done. Due: 2, 3, 4 Nov. Done: 2, 4.
    const h = habit({ checks: days('2026-11-02', '2026-11-04') });
    const s = habitStats(h, '2026-11-05', 1);
    expect(s.total).toBe(2);
    expect(s.rate).toBeCloseTo(2 / 3);
    // Done today: today joins both sides.
    expect(habitStats({ ...h, checks: { ...h.checks, '2026-11-05': true } }, '2026-11-05', 1).rate).toBeCloseTo(3 / 4);
    // Below goal is not done; future days are ignored.
    const g = habit({ goal: 3, checks: { '2026-11-03': 3, '2026-11-04': 1, '2026-11-09': 3 } });
    expect(habitStats(g, '2026-11-05', 1)).toMatchObject({ total: 1, rate: 0.5 });
  });

  it('no check-ins: zeros and no rate', () => {
    expect(habitStats(habit(), '2026-11-05', 1)).toEqual({ total: 0, rate: null, current: 0, best: 0, unit: 'day', top: [] });
  });

  it('daily runs: best, current and the top list, longest first then newest', () => {
    const h = habit({ checks: days(
      '2026-10-01', '2026-10-02', // 2
      '2026-10-10', '2026-10-11', '2026-10-12', // 3
      '2026-10-20', '2026-10-21', // 2
      '2026-11-04', // 1, current (today 5 Nov open)
    ) });
    expect(runs(h, '2026-11-05', 1).map(r => r.n)).toEqual([2, 3, 2, 1]);
    const s = habitStats(h, '2026-11-05', 1);
    expect(s.best).toBe(3);
    expect(s.current).toBe(1);
    expect(s.top.map(r => [r.start, r.n])).toEqual([['2026-10-10', 3], ['2026-10-20', 2], ['2026-10-01', 2], ['2026-11-04', 1]]);
    expect(s.top[0]).toEqual({ start: '2026-10-10', end: '2026-10-12', n: 3 });
  });

  it('keeps only the 10 best runs', () => {
    const c: Record<string, true> = {};
    for (let i = 0; i < 12; i++) c[`2026-01-${String(1 + i * 2).padStart(2, '0')}`] = true; // 12 one-day runs
    expect(habitStats(habit({ checks: c }), '2026-11-05', 1).top).toHaveLength(10);
  });

  it('runs cross Feb 29 and a run that ended long ago still counts as best', () => {
    const h = habit({ checks: days('2028-02-28', '2028-02-29', '2028-03-01', '2028-11-01') });
    const s = habitStats(h, '2028-11-20', 1);
    expect(s.best).toBe(3);
    expect(s.current).toBe(0);
  });

  it('weekly: rate counts the target per week, extra days earn nothing, this week only counts once it is lost', () => {
    // 2/week, Monday weeks. Week of 19 Oct: 3 (capped 2). 26 Oct: 1. 2 Nov (Thu 5th): 0 so far, still reachable.
    const h = habit({ perWeek: 2, checks: days('2026-10-19', '2026-10-20', '2026-10-21', '2026-10-27') });
    const s = habitStats(h, '2026-11-05', 1);
    expect(s.total).toBe(4);
    expect(s.rate).toBeCloseTo(3 / 4);
    // Sunday 8 Nov with 0 done: only today is left, the target of 2 is lost: the week counts as due.
    expect(habitStats(h, '2026-11-08', 1).rate).toBeCloseTo(3 / 6);
    // A done day this week counts toward both sides while the week is open.
    expect(habitStats({ ...h, checks: { ...h.checks, '2026-11-03': true } }, '2026-11-05', 1).rate).toBeCloseTo(4 / 5);
  });

  it('weekly runs follow streakIn: weeks, or done days of met weeks', () => {
    const c = days('2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-04');
    const w = habitStats(habit({ perWeek: 3, checks: c }), '2026-11-05', 1);
    expect(w).toMatchObject({ unit: 'week', current: 2, best: 2 });
    expect(w.top[0]).toEqual({ start: '2026-10-19', end: '2026-11-01', n: 2 });
    // Days mode: this week (2 done, reachable) joins the run, as in streak().
    const d = habitStats(habit({ perWeek: 3, streakIn: 'days', checks: c }), '2026-11-05', 1);
    expect(d).toMatchObject({ unit: 'day', current: 9, best: 9 });
    expect(d.top[0]).toEqual({ start: '2026-10-19', end: '2026-11-08', n: 9 });
    // A fresh week with nothing done yet starts no run (no "0 days" streak).
    const fresh = habitStats(habit({ perWeek: 3, streakIn: 'days', checks: days('2026-10-19') }), '2026-11-02', 1);
    expect(fresh.top).toEqual([]);
    // Sunday weeks shift the grid: 1 Nov starts a week.
    expect(habitStats(habit({ perWeek: 3, checks: c }), '2026-11-05', 0).unit).toBe('week');
  });

  it('per month: done days per calendar month, oldest first, ending this month', () => {
    const h = habit({ goal: 2, checks: { '2026-09-30': 2, '2026-11-01': 2, '2026-11-03': true, '2026-11-04': 1, '2026-12-01': 2 } });
    expect(perMonth(h, '2026-11-05', 3)).toEqual([{ month: '2026-09', n: 1 }, { month: '2026-10', n: 0 }, { month: '2026-11', n: 2 }]);
    expect(perMonth(h, '2027-01-15', 14)).toHaveLength(14);
    expect(perMonth(h, '2027-01-15', 14)[0]!.month).toBe('2025-12');
  });
});

describe('habit year heatmap', () => {
  it('weeks of a year: whole weeks from the one holding 1 Jan to the one holding 31 Dec', () => {
    // 2026: 1 Jan is a Thursday, 31 Dec a Thursday.
    const mon = yearWeeks(2026, 1);
    expect(mon[0]![0]).toBe('2025-12-29');
    expect(mon.at(-1)![6]).toBe('2027-01-03');
    expect(mon).toHaveLength(53);
    expect(mon.every(w => w.length === 7)).toBe(true);
    // Sunday weeks start the grid on Sunday.
    expect(yearWeeks(2026, 0)[0]![0]).toBe('2025-12-28');
    // 2028 is a leap year and holds 29 Feb exactly once.
    expect(yearWeeks(2028, 1).flat().filter(d => d === '2028-02-29')).toHaveLength(1);
  });

  it('levels: none, partial below goal, done, over goal', () => {
    const h = habit({ goal: 3, checks: { '2026-11-01': 1, '2026-11-02': 3, '2026-11-03': 5, '2026-11-04': true } });
    expect(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map(d => dayLevel(h, d))).toEqual(['none', 'part', 'done', 'over', 'done']);
    expect(dayLevel(habit({ checks: { '2026-11-01': true } }), '2026-11-01')).toBe('done');
  });
});

describe('met week fill', () => {
  // 2/week, Monday weeks: Mon 2 and Wed 4 Nov done, Thu 5 partly (goal 2).
  const h = habit({ perWeek: 2, goal: 2, checks: { '2026-11-02': 2, '2026-11-04': true, '2026-11-05': 1 } });
  it('marks every empty day of a met week, before and after the done days', () => {
    expect(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-08'].map(d => metWeekFill(h, d, 1)))
      .toEqual([false, true, false, false, true, true]); // done days and the partly done day keep their own look
  });
  it('nothing in a week below target, in other weeks, or for every-day habits', () => {
    expect(metWeekFill({ ...h, perWeek: 3 }, '2026-11-03', 1)).toBe(false);
    expect(metWeekFill(h, '2026-11-09', 1)).toBe(false);
    expect(metWeekFill(habit({ checks: { '2026-11-02': true } }), '2026-11-03', 1)).toBe(false);
  });
  it('follows the week start: with Sunday weeks, Sun 1 Nov joins the met week', () => {
    expect(metWeekFill(h, '2026-11-01', 0)).toBe(true);
    expect(metWeekFill(h, '2026-11-01', 1)).toBe(false);
  });
});

describe('did you do these yesterday?', () => {
  const t0 = new Date(2026, 10, 1).getTime(); // created 1 Nov
  it("lists yesterday's habits that were still due and not done", () => {
    const hs = [
      habit({ id: 'a', created: t0 }), // daily, not done: listed
      habit({ id: 'b', created: t0, checks: { '2026-11-04': true } }), // done yesterday
      habit({ id: 'c', created: t0, goal: 3, checks: { '2026-11-04': 1 } }), // partly done: listed
      habit({ id: 'd', created: t0, removed: true }),
      habit({ id: 'e', created: new Date(2026, 10, 5, 9).getTime() }), // created today: did not exist yesterday
      habit({ id: 'f', created: new Date(2026, 10, 4, 22).getTime() }), // created yesterday evening: listed
    ];
    expect(missedYesterday(hs, '2026-11-05', 1).map(h => h.id)).toEqual(['a', 'c', 'f']);
  });
  it('weekly habits only when yesterday could not wait', () => {
    // 3 a week, none done, Monday weeks: Thu 5 Nov can wait (not listed), Fri 6 cannot (listed on Sat 7).
    const w = habit({ id: 'w', created: t0, perWeek: 3 });
    expect(missedYesterday([w], '2026-11-06', 1)).toEqual([]);
    expect(missedYesterday([w], '2026-11-07', 1).map(h => h.id)).toEqual(['w']);
  });
  it('keeps the habit order', () => {
    const hs = [habit({ id: 'x', order: 2, created: t0 }), habit({ id: 'y', order: 1, created: t0 })];
    expect(missedYesterday(hs, '2026-11-05', 1).map(h => h.id)).toEqual(['y', 'x']);
  });
});

describe('focus timer', () => {
  const s = { ...DEFAULT_FOCUS, longEvery: 2 };
  it('runs on timestamps: pause, resume, and a reload in between lose nothing', () => {
    let t = start(idleTimer(s), 0);
    expect(clockSecs(t, 60_000)).toBe(24 * 60);
    t = pause(t, 60_000);
    expect(clockSecs(t, 999_999)).toBe(24 * 60); // paused: frozen
    t = JSON.parse(JSON.stringify(start(t, 100_000))); // saved and reloaded
    expect(clockSecs(t, 160_000)).toBe(23 * 60);
    expect(focusedMins(t, s, 160_000)).toBe(2);
  });

  it('short break after focus, a long one every N sessions, then focus again', () => {
    let t = idleTimer(s);
    t = nextPhase(t, s, true); expect([t.phase, t.cycle, t.left]).toEqual(['short', 1, 5 * 60]);
    t = nextPhase(t, s, false); expect(t.phase).toBe('focus');
    t = nextPhase(t, s, true); expect([t.phase, t.cycle, t.left]).toEqual(['long', 0, 15 * 60]);
    expect(nextPhase(idleTimer(s), s, false).cycle).toBe(0); // a skipped focus does not count
  });

  it('the stopwatch counts up', () => {
    const t = start(idleTimer(s, { mode: 'sw' }), 0);
    expect(clockSecs(t, 90_000)).toBe(90);
  });
});

describe('kanban columns', () => {
  const task = (id: string, col?: string, done = false) => ({ id, col, done }) as Task;
  it('uses the list columns, or the defaults', () => {
    expect(columnsOf(undefined).map(c => c.name)).toEqual(['To do', 'In progress']);
    const l = { columns: [{ id: 'a', name: 'Ideas' }] } as List;
    expect(columnsOf(l)).toEqual([{ id: 'a', name: 'Ideas' }]);
  });

  it('puts tasks without a column, or in a deleted one, in the first column; skips done ones', () => {
    const cols = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const g = byColumn(cols, [task('1'), task('2', 'b'), task('3', 'gone'), task('4', 'b', true)]);
    expect(g.map(x => x.tasks.map(t => t.id))).toEqual([['1', '3'], ['2']]);
  });

  it('moves columns within bounds', () => {
    const cols = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    expect(moveColumn(cols, 'b', -1).map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(cols, 'c', 1)).toBe(cols);
  });
});
