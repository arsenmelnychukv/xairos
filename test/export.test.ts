import { describe, expect, it } from 'vitest';
import { csvCell, icsFold, rrule, tasksCsv, tasksIcs } from '../src/lib/export';
import type { List, Task } from '../src/types';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Call Ann', desc: '', listId: 'L', due: null, time: null, priority: 0, tags: [], items: [], done: false, doneAt: null,
  deleted: false, created: Date.UTC(2026, 10, 1), order: 1, repeat: null, reminders: [], snooze: null, assignee: null, createdBy: 'u1', ...o,
});
const lists: Record<string, List> = { L: { id: 'L', name: 'Work, home', color: '0,0,0', ownerId: 'u1', members: {}, order: 0 } };

describe('CSV export', () => {
  it('quotes, escapes and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
  });
  it('writes one row per live task, skipping Trash', () => {
    const csv = tasksCsv([
      task({ title: 'Pay rent', due: '2026-12-01', time: '09:00', priority: 5, tags: ['home'], items: [{ id: 'i', title: 'Bank', done: true }], repeat: { freq: 'monthly' } }),
      task({ id: 't2', title: 'Gone', deleted: true }),
    ], lists);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Title,List,Due date,Due time,Time zone,Priority,Tags,Status,Completed,Repeat,Checklist,Description,Created');
    expect(lines[1]).toMatch(/^Pay rent,"Work, home",2026-12-01,09:00,,High,home,Open,,[^,]+,\[x\] Bank,,2026-11-01T00:00:00.000Z$/);
    expect(csv).not.toContain('Gone');
  });
});

describe('ICS export', () => {
  it('folds long lines at 75 octets without breaking characters', () => {
    const line = 'SUMMARY:' + 'ж'.repeat(60);
    const parts = icsFold(line).split('\r\n');
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });
  it('maps repeat rules', () => {
    expect(rrule({ freq: 'weekly', interval: 2, byDay: [1, 3] })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(rrule({ freq: 'monthly', count: 5, done: 2 })).toBe('FREQ=MONTHLY;COUNT=3');
    expect(rrule({ freq: 'daily', until: '2026-12-31' })).toBe('FREQ=DAILY;UNTIL=20261231');
  });
  it('writes VTODOs with due dates in each form', () => {
    const ics = tasksIcs([
      task({ id: 'a', title: 'All day; ok', due: '2026-11-07' }),
      task({ id: 'b', due: '2026-11-07', time: '09:30', reminders: [0, 15] }),
      task({ id: 'c', due: '2026-07-01', time: '09:00', tz: 'Europe/Berlin', done: true, doneAt: Date.UTC(2026, 6, 1, 7) }),
    ], lists, Date.UTC(2026, 10, 7));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain(String.raw`SUMMARY:All day\; ok`);
    expect(ics).toContain('DUE;VALUE=DATE:20261107');
    expect(ics).toContain('DUE:20261107T093000\r\n');
    expect(ics).toContain('TRIGGER;RELATED=END:-PT15M');
    expect(ics).toContain('DUE:20260701T070000Z');
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('CATEGORIES:Work\\, home');
    expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(3);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('gives repeating tasks a DTSTART and an UNTIL of the same type', () => {
    const r = { freq: 'daily' as const, until: '2026-12-31' };
    const date = tasksIcs([task({ id: 'd', due: '2026-11-07', repeat: r })], lists);
    expect(date).toContain('DTSTART;VALUE=DATE:20261107\r\n');
    expect(date).toContain('RRULE:FREQ=DAILY;UNTIL=20261231\r\n');
    const floating = tasksIcs([task({ id: 'f', due: '2026-11-07', time: '09:00', repeat: r })], lists);
    expect(floating).toContain('DTSTART:20261107T090000\r\n');
    expect(floating).toContain('UNTIL=20261231T235959\r\n');
    const pinned = tasksIcs([task({ id: 'p', due: '2026-11-07', time: '09:00', tz: 'Europe/Berlin', repeat: r })], lists);
    expect(pinned).toContain('DTSTART:20261107T080000Z\r\n');
    expect(pinned).toContain('UNTIL=20261231T225900Z\r\n');
    expect(tasksIcs([task({ id: 'n', due: '2026-11-07' })], lists)).not.toContain('DTSTART');
  });
});
