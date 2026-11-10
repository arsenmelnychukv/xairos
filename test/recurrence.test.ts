import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonthsClamp, advanceRepeat, firstOccurrence, nextDue, occurrences, repeatLabel } from '../src/recurrence';
import type { RepeatRule } from '../src/types';

const daily: RepeatRule = { freq: 'daily', interval: 1 };
const weekdays: RepeatRule = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] };

describe('nextDue', () => {
  it('daily, every n days', () => {
    expect(nextDue(daily, '2026-11-05')).toBe('2026-11-06');
    expect(nextDue({ freq: 'daily', interval: 3 }, '2026-11-30')).toBe('2026-12-03');
  });

  it('weekdays: Friday goes to Monday', () => {
    expect(nextDue(weekdays, '2026-11-06')).toBe('2026-11-09'); // Fri -> Mon
    expect(nextDue(weekdays, '2026-11-09')).toBe('2026-11-10'); // Mon -> Tue
  });

  it('weekly without byDay keeps the weekday', () => {
    expect(nextDue({ freq: 'weekly', interval: 1 }, '2026-11-05')).toBe('2026-11-12');
  });

  it('every 2 weeks on Mon and Thu', () => {
    const r: RepeatRule = { freq: 'weekly', interval: 2, byDay: [1, 4] };
    expect(nextDue(r, '2026-11-02')).toBe('2026-11-05'); // Mon -> Thu, same week
    expect(nextDue(r, '2026-11-05')).toBe('2026-11-16'); // Thu -> Mon two weeks on
  });

  it('every 2 weeks, single day', () => {
    expect(nextDue({ freq: 'weekly', interval: 2, byDay: [4] }, '2026-11-05')).toBe('2026-11-19');
  });

  it('monthly clamps to the month end and keeps dom', () => {
    const r: RepeatRule = { freq: 'monthly', interval: 1, dom: 31 };
    expect(nextDue(r, '2026-01-31')).toBe('2026-02-28');
    expect(nextDue(r, '2026-02-28')).toBe('2026-03-31');
    expect(nextDue(r, '2026-03-31')).toBe('2026-04-30');
  });

  it('monthly in a leap year', () => {
    expect(nextDue({ freq: 'monthly', interval: 1, dom: 31 }, '2028-01-31')).toBe('2028-02-29');
  });

  it('yearly from Feb 29 clamps, then returns to Feb 29', () => {
    const r: RepeatRule = { freq: 'yearly', interval: 1, dom: 29 };
    expect(nextDue(r, '2028-02-29')).toBe('2029-02-28');
    expect(nextDue({ ...r, interval: 4 }, '2028-02-29')).toBe('2032-02-29');
  });

  it('crosses a year boundary', () => {
    expect(nextDue({ freq: 'monthly', interval: 1, dom: 15 }, '2026-12-15')).toBe('2027-01-15');
  });

  it('is not shifted by a DST change', () => {
    // EU clocks change on 2026-10-25 and US on 2026-11-01; date math must stay on calendar days.
    expect(nextDue(daily, '2026-10-24')).toBe('2026-10-25');
    expect(nextDue(daily, '2026-10-25')).toBe('2026-10-26');
    expect(nextDue(daily, '2026-03-29')).toBe('2026-03-30');
  });
});

describe('with a fixed today', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 10, 0)); }); // Thu 2026-11-05
  afterEach(() => { vi.useRealTimers(); });

  it('firstOccurrence picks the next matching weekday', () => {
    expect(firstOccurrence(weekdays)).toBe('2026-11-05');
    expect(firstOccurrence({ freq: 'weekly', byDay: [6] })).toBe('2026-11-07');
    expect(firstOccurrence(daily)).toBe('2026-11-05');
  });

  it('advanceRepeat skips missed occurrences', () => {
    expect(advanceRepeat(daily, '2026-11-01', '2026-11-05')).toEqual({ next: '2026-11-05', finished: false });
  });

  it('advanceRepeat from completion counts from today', () => {
    const r: RepeatRule = { freq: 'daily', interval: 3, from: 'completion' };
    expect(advanceRepeat(r, '2026-10-01', '2026-11-05').next).toBe('2026-11-08');
  });

  it('advanceRepeat ends at until and count', () => {
    expect(advanceRepeat({ ...daily, until: '2026-11-05' }, '2026-11-05', '2026-11-05').finished).toBe(true);
    expect(advanceRepeat({ ...daily, count: 3, done: 2 }, '2026-11-05', '2026-11-05').finished).toBe(true);
    expect(advanceRepeat({ ...daily, count: 3, done: 1 }, '2026-11-05', '2026-11-05').finished).toBe(false);
  });

  it('repeatLabel', () => {
    expect(repeatLabel(weekdays)).toBe('Weekdays');
    expect(repeatLabel({ freq: 'weekly', interval: 2, byDay: [1, 4] })).toBe('Every 2 weeks on Mon, Thu');
    expect(repeatLabel({ freq: 'monthly', interval: 1, dom: 1 })).toBe('Monthly on day 1');
    expect(repeatLabel({ freq: 'daily', interval: 3, from: 'completion' })).toBe('Every 3 days (after completion)');
    expect(repeatLabel({ ...daily, until: '2026-11-20' })).toBe('Daily, until Nov 20');
  });
});

describe('occurrences', () => {
  it('lists upcoming dates in range, after the due date', () => {
    const t = { repeat: { freq: 'weekly', interval: 1, byDay: [1] } as RepeatRule, due: '2026-11-02', done: false };
    expect(occurrences(t, '2026-11-01', '2026-11-30')).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });

  it('respects until and count, and skips completion-based rules', () => {
    const base = { due: '2026-11-01', done: false };
    expect(occurrences({ ...base, repeat: { ...daily, until: '2026-11-03' } }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-03']);
    expect(occurrences({ ...base, repeat: { ...daily, count: 3 } }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-03']); // due + 2 more
    expect(occurrences({ ...base, repeat: { ...daily, from: 'completion' } }, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});

describe('addMonthsClamp', () => {
  it('clamps Jan 31 + 1', () => {
    const d = addMonthsClamp(new Date(2026, 0, 31), 1);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 28]);
  });
});
