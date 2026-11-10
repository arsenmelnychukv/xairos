import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuick } from '../src/parser';

// Thursday 2026-11-05, 10:00 local time.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 10, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe('parseQuick', () => {
  it('plain title', () => {
    const p = parseQuick('Buy milk');
    expect(p).toMatchObject({ title: 'Buy milk', due: null, time: null, priority: null, tags: [], repeat: null });
  });

  it('priority, tags and list', () => {
    const p = parseQuick('Fix bug !high #dev #urgent ^Work');
    expect(p).toMatchObject({ title: 'Fix bug', priority: 5, tags: ['dev', 'urgent'], listName: 'Work' });
    expect(parseQuick('x !med').priority).toBe(3);
    expect(parseQuick('x !1').priority).toBe(1);
    expect(parseQuick('x !none').priority).toBe(0);
  });

  it('relative dates', () => {
    expect(parseQuick('a today').due).toBe('2026-11-05');
    expect(parseQuick('a tomorrow').due).toBe('2026-11-06');
    expect(parseQuick('a tmr').due).toBe('2026-11-06');
    expect(parseQuick('a next week').due).toBe('2026-11-09');
    expect(parseQuick('a in 3 days').due).toBe('2026-11-08');
    expect(parseQuick('a in 2 weeks').due).toBe('2026-11-19');
  });

  it('weekday names go to the next one, never today', () => {
    expect(parseQuick('a fri').due).toBe('2026-11-06');
    expect(parseQuick('a on monday').due).toBe('2026-11-09');
    expect(parseQuick('a thursday').due).toBe('2026-11-12');
  });

  it('month/day dates roll into next year when past', () => {
    expect(parseQuick('a 12/25').due).toBe('2026-12-25');
    expect(parseQuick('a 1/12').due).toBe('2027-01-12');
    expect(parseQuick('a nov 20').due).toBe('2026-11-20');
    expect(parseQuick('a march 3').due).toBe('2027-03-03');
    expect(parseQuick('a 13/40').due).toBeNull();
  });

  it('times, and time alone means today', () => {
    expect(parseQuick('a 9am')).toMatchObject({ time: '09:00', due: '2026-11-05', title: 'a' });
    expect(parseQuick('a 12pm').time).toBe('12:00');
    expect(parseQuick('a 12am').time).toBe('00:00');
    expect(parseQuick('a at 6:30pm').time).toBe('18:30');
    expect(parseQuick('a 14:05').time).toBe('14:05');
    expect(parseQuick('a at 7').time).toBe('07:00');
    expect(parseQuick('Read chapter 7').time).toBeNull();
  });

  it('every weekday 9:30', () => {
    const p = parseQuick('Standup every weekday 9:30');
    expect(p.title).toBe('Standup');
    expect(p.time).toBe('09:30');
    expect(p.due).toBe('2026-11-05');
    expect(p.repeat).toMatchObject({ freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], from: 'due', dom: 5 });
  });

  it('every mon and thu', () => {
    const p = parseQuick('Gym every mon and thu');
    expect(p.title).toBe('Gym');
    expect(p.repeat).toMatchObject({ freq: 'weekly', byDay: [1, 4] });
    expect(p.due).toBe('2026-11-05');
  });

  it('every 2 weeks keeps the due weekday', () => {
    const p = parseQuick('Review every 2 weeks');
    expect(p.repeat).toMatchObject({ freq: 'weekly', interval: 2, byDay: [4] });
  });

  it('monthly with a date sets dom', () => {
    const p = parseQuick('Pay rent every month on 1/12 9am !high #home');
    expect(p).toMatchObject({ title: 'Pay rent', due: '2027-01-12', time: '09:00', priority: 5, tags: ['home'] });
    expect(p.repeat).toMatchObject({ freq: 'monthly', interval: 1, dom: 12 });
  });

  it('daily and yearly', () => {
    expect(parseQuick('a daily').repeat).toMatchObject({ freq: 'daily', interval: 1 });
    expect(parseQuick('a every day').repeat).toMatchObject({ freq: 'daily' });
    expect(parseQuick('a annually').repeat).toMatchObject({ freq: 'yearly' });
  });

  it('builds chips', () => {
    const p = parseQuick('Pay rent monthly tomorrow 9am !high #home');
    expect(p.chips.map(c => c.txt)).toEqual(['Tomorrow, 9:00 AM', '↻ Monthly on day 6', 'High', '#home']);
  });
});

describe('"on" before a date', () => {
  it('is consumed, not left in the title', () => {
    expect(parseQuick('Call mom on 11/20')).toMatchObject({ title: 'Call mom', due: '2026-11-20' });
    expect(parseQuick('Trip on dec 3')).toMatchObject({ title: 'Trip', due: '2026-12-03' });
    expect(parseQuick('Turn on lights').title).toBe('Turn on lights');
  });
});
