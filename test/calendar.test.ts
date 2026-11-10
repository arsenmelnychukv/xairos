import { describe, expect, it } from 'vitest';
import { convertWall, pinnedTz, setLocalWhen, wallAt, when } from '../src/lib/tz';
import { itemsInRange, layoutDay, weekOrder, weekStartOf } from '../src/calendar';
import { reminderTimes } from '../src/reminders';
import type { Task } from '../src/types';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't', title: 'T', desc: '', listId: 'L', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: 1, order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u', ...o,
});

describe('time zones: floating and pinned', () => {
  it('a floating time is the same wall time in every zone', () => {
    const t = task({ due: '2026-11-05', time: '09:00' });
    expect(when(t, 'America/New_York')).toEqual({ due: '2026-11-05', time: '09:00' });
    expect(when(t, 'Asia/Tokyo')).toEqual({ due: '2026-11-05', time: '09:00' });
  });

  it('a pinned time converts, across the date line too', () => {
    const t = task({ due: '2026-11-05', time: '15:00', tz: 'Europe/Berlin' });
    expect(when(t, 'Europe/Berlin')).toEqual({ due: '2026-11-05', time: '15:00' });
    expect(when(t, 'America/New_York')).toEqual({ due: '2026-11-05', time: '09:00' });
    expect(when(t, 'Asia/Tokyo')).toEqual({ due: '2026-11-05', time: '23:00' });
    expect(when({ ...t, time: '23:30' }, 'Asia/Tokyo')).toEqual({ due: '2026-11-06', time: '07:30' });
  });

  it('a pin needs a date and a time', () => {
    expect(pinnedTz(task({ due: '2026-11-05', tz: 'Europe/Berlin' }))).toBeNull();
    expect(when(task({ due: '2026-11-05', tz: 'Europe/Berlin' }), 'Asia/Tokyo')).toEqual({ due: '2026-11-05', time: null });
  });

  it('converts both ways and handles DST on one side only', () => {
    // 30 Mar 2026: Berlin is on summer time (UTC+2), New York too (UTC-4) → 6 h apart.
    expect(convertWall('2026-03-30', '15:00', 'Europe/Berlin', 'America/New_York')).toEqual({ due: '2026-03-30', time: '09:00' });
    // 10 Mar 2026: New York already on summer time, Berlin not yet → 5 h apart.
    expect(convertWall('2026-03-10', '15:00', 'Europe/Berlin', 'America/New_York')).toEqual({ due: '2026-03-10', time: '10:00' });
    expect(wallAt(Date.parse('2026-11-05T23:00:00Z'), 'Europe/Berlin')).toEqual({ due: '2026-11-06', time: '00:00' });
  });

  it('setLocalWhen keeps a pinned task in its zone', () => {
    const t = task({ due: '2026-11-05', time: '15:00', tz: 'UTC' });
    setLocalWhen(t, '2026-11-06', '10:00');
    expect(when(t)).toEqual({ due: '2026-11-06', time: '10:00' }); // what the user sees here
    expect(t.tz).toBe('UTC');
    const f = task({ due: '2026-11-05', time: '15:00' });
    setLocalWhen(f, '2026-11-07', null);
    expect(f).toMatchObject({ due: '2026-11-07', time: null });
  });

  it('a pinned reminder fires at the pinned time whatever the device zone', () => {
    const t = task({ id: 'p', due: '2026-11-05', time: '15:00', tz: 'Europe/Berlin', reminders: [0] });
    const [ny] = reminderTimes(t, 'America/New_York'), [tk] = reminderTimes(t, 'Asia/Tokyo');
    expect(new Date(ny!.at).toISOString()).toBe('2026-11-05T14:00:00.000Z');
    expect(tk!.at).toBe(ny!.at);
    expect(ny!.key).toContain('@Europe/Berlin');
  });
});

describe('calendar', () => {
  it('weeks start on Monday by default, Sunday as a setting', () => {
    const thu = new Date(2026, 10, 5);
    expect(weekStartOf(thu, 1).getDate()).toBe(2); // Mon 2 Nov
    expect(weekStartOf(thu, 0).getDate()).toBe(1); // Sun 1 Nov
    expect(weekStartOf(new Date(2026, 10, 1), 1).getDate()).toBe(26); // a Sunday belongs to the week before
    expect(weekOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('places pinned tasks and repeats on the viewer’s local day', () => {
    const pinned = task({ id: 'p', due: '2026-11-05', time: '23:30', tz: 'Europe/Berlin' });
    const daily = task({ id: 'd', due: '2026-11-04', time: '09:00', repeat: { freq: 'daily' } });
    const items = itemsInRange([pinned, daily], '2026-11-05', '2026-11-06', 'Asia/Tokyo');
    expect(items.find(i => i.t.id === 'p')).toMatchObject({ due: '2026-11-06', time: '07:30', ghost: false });
    expect(items.filter(i => i.t.id === 'd').map(i => [i.due, i.ghost])).toEqual([['2026-11-05', true], ['2026-11-06', true]]);
  });

  it('overlapping blocks share the width; separate groups get the full width', () => {
    const p = layoutDay([
      { key: 'a', start: 540, end: 600 },  // 9:00–10:00
      { key: 'b', start: 570, end: 630 },  // 9:30–10:30
      { key: 'c', start: 600, end: 660 },  // 10:00–11:00: column of a is free again
      { key: 'd', start: 720, end: 750 },  // 12:00: alone
    ]);
    const by = Object.fromEntries(p.map(x => [x.key, x]));
    expect(by.a).toEqual({ key: 'a', col: 0, cols: 2 });
    expect(by.b).toEqual({ key: 'b', col: 1, cols: 2 });
    expect(by.c).toEqual({ key: 'c', col: 0, cols: 2 });
    expect(by.d).toEqual({ key: 'd', col: 0, cols: 1 });
  });
});
