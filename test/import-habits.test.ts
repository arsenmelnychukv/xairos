/** Habit importers (roadmap N6): one hand-written fixture per format, plus merge by name. */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { nearestColor, parseCsv, planImport, readHabitFile, unzip } from '../src/lib/import-habits';
import type { Habit } from '../src/types';

const enc = (s: string) => new TextEncoder().encode(s);
const json = (o: unknown) => enc(JSON.stringify(o));
const epochDay = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;

/** A minimal ZIP writer: `deflate` entries are compressed, the rest stored. CRCs are left 0 (the reader does not check them). */
function zip(files: Record<string, string>, deflate: string[] = []): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc(text), method = deflate.includes(name) ? 8 : 0, data = method ? new Uint8Array(deflateRawSync(raw)) : raw, n = enc(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, method, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, n.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, method, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, n.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), n, data); central.push(new Uint8Array(ch.buffer), n);
    off += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

describe('csv and zip readers', () => {
  it('reads quoted fields, doubled quotes, CRLF and a BOM-free last line without newline', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,,3')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '', '3']]);
  });
  it('unzips stored and deflated entries, and only the ones asked for', async () => {
    const z = zip({ 'a.txt': 'plain', 'dir/b.txt': 'squeezed squeezed squeezed', 'skip.bin': 'x' }, ['dir/b.txt']);
    const got = await unzip(z, n => n.endsWith('.txt'));
    expect([...got.keys()]).toEqual(['a.txt', 'dir/b.txt']);
    expect(new TextDecoder().decode(got.get('dir/b.txt'))).toBe('squeezed squeezed squeezed');
    await expect(unzip(enc('not a zip at all, no end record here'))).rejects.toThrow(/ZIP/);
  });
});

describe('importers', () => {
  it('ZIP of CSVs: manual days only, numbers ÷1000, skips and notes counted, AT_MOST left out', async () => {
    const z = zip({
      'Habits.csv': 'Position,Name,Type,Question,Description,FrequencyNumerator,FrequencyDenominator,Color,Unit,Target Type,Target Value,Archived?,Category\n'
        + '001,Meditate,YES_NO,Did you meditate?,,3,7,#E53935,,,,false,\n'
        + '002,"Run, outside",NUMERICAL,,,1,1,#43A047,km,AT_LEAST,5.0,false,\n'
        + '003,Sugar,NUMERICAL,,,1,1,#000000,g,AT_MOST,30.0,false,\n'
        + '004,Call mum,YES_NO,,,2,30,#1E88E5,,,,true,\n',
      'Scores.csv': 'Date,Meditate,\n',
      '001 Meditate/Checkmarks.csv': 'Date,Value,Notes\n2026-11-05,YES_MANUAL,\n2026-11-04,YES_AUTO,\n2026-11-03,SKIP,sick\n2026-11-02,NO,\n2026-11-01,YES_MANUAL,"felt good, calm"\n',
      '001 Meditate/Scores.csv': 'Date,Score\n2026-11-05,0.5\n',
      '002 Run outside/Checkmarks.csv': 'Date,Value,Notes\n2026-11-05,2000,\n2026-11-04,0,\n2026-11-03,5000,\n2026-11-02,-1,\n',
      '004 Call mum/Checkmarks.csv': 'Date,Value,Notes\n2026-11-01,YES_MANUAL,\n',
    }, ['001 Meditate/Checkmarks.csv']);
    const r = (await readHabitFile('habits-export-2026-11-06.zip', z))!;
    expect(r.source).toBe('ZIP export');
    expect(r.habits).toEqual([
      { name: 'Meditate', color: '#E53935', goal: 1, unit: null, perWeek: 3, checks: { '2026-11-05': true, '2026-11-01': true } },
      { name: 'Run, outside', color: '#43A047', goal: 5, unit: 'km', perWeek: null, checks: { '2026-11-05': 2, '2026-11-03': 5 } },
      { name: 'Call mum', color: '#1E88E5', goal: 1, unit: null, perWeek: null, checks: { '2026-11-01': true } },
    ]);
    expect(r.dropped).toEqual({ skips: 1, notes: 2, habits: ['Sugar (an "at most" habit)'] });
    expect(r.warnings.join(' ')).toMatch(/Call mum.*2 times in 30 days/);
  });

  it('JSON with epoch days, counts, skips and reasons; quit and deleted habits left out', async () => {
    const r = (await readHabitFile('export-habits-2026_11_06.json', json({
      habits: [
        { name: 'Read', type: 1, status: 1, daily_goal: 1, freq_type: 1, freq_custom: '[4]', records: [
          { record_date: epochDay('2026-11-05'), record_type: 1, record_value: 1, is_deleted: 0, reason: '' },
          { record_date: epochDay('2026-11-04'), record_type: 2, record_value: 0, is_deleted: 0, reason: 'travel' },
          { record_date: epochDay('2026-11-03'), record_type: 1, record_value: 1, is_deleted: 1, reason: '' },
        ] },
        { name: 'Water', type: 1, status: 3, daily_goal: 8, daily_goal_unit: 'cups', freq_type: 3, freq_custom: '[1,1]', records: [
          { record_date: epochDay('2026-11-05'), record_type: 1, record_value: 5, is_deleted: 0 },
          { record_date: epochDay('2026-11-04'), record_type: 1, record_value: 0, is_deleted: 0 },
        ] },
        { name: 'Smoke', type: 2, status: 1, records: [] },
        { name: 'Old', type: 1, status: 2, records: [] },
      ],
      groups: [],
    })))!;
    expect(r.source).toBe('JSON export');
    expect(r.habits).toEqual([
      { name: 'Read', color: null, goal: 1, unit: null, perWeek: 4, checks: { '2026-11-05': true } },
      { name: 'Water', color: null, goal: 8, unit: 'cups', perWeek: null, checks: { '2026-11-05': 5, '2026-11-04': 8 } },
    ]);
    expect(r.dropped).toEqual({ skips: 1, notes: 1, habits: ['Smoke (a habit to quit)'] });
  });

  it('JSON day events: day keys with and without Z, check / progress / skip, old capitalised types, deleted left out', async () => {
    const habits = [
      { id: 1, title: 'Stretch', position: 0, habitType: 0, deleted_at: null, events: {
        '2026-11-05 12:00:00.000Z': ['DayType.check', ''], '2026-11-04 00:00:00.000': ['DayType.skip', 'rest day'],
        '2026-11-03 12:00:00.000Z': ['DayType.fail', ''], '2026-11-02 12:00:00.000Z': ['DayType.Check', ''],
      } },
      { id: 2, title: 'Water', position: 1, habitType: 1, targetValue: 8, unit: 'glasses', events: {
        '2026-11-05 12:00:00.000Z': ['DayType.progress', '', 5], '2026-11-04 12:00:00.000Z': ['DayType.check', '', 8, 8],
      } },
      { id: 3, title: 'Gone', position: 2, deleted_at: '2026-01-01T00:00:00Z', events: { '2026-11-05 12:00:00.000Z': ['DayType.check', ''] } },
    ];
    const r = (await readHabitFile('habit_backup.json', json({ habits, events: {}, categories: [], metadata: { version: '1.0' } })))!;
    expect(r.source).toBe('JSON backup');
    expect(r.habits).toEqual([
      { name: 'Stretch', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-05': true, '2026-11-02': true } },
      { name: 'Water', color: null, goal: 8, unit: 'glasses', perWeek: null, checks: { '2026-11-05': 5, '2026-11-04': 8 } },
    ]);
    expect(r.dropped).toEqual({ skips: 1, notes: 1, habits: [] });
    // The old format: a bare array of habits.
    expect((await readHabitFile('old.json', json(habits)))!.habits).toHaveLength(2);
  });

  it('JSON with periods and wide CSV: done days, weekly target, soft-deleted left out', async () => {
    const r = (await readHabitFile('habits_2026_11_06.json', json({ user_email: 'x@xairos.test', exported_at: '2026-11-06 10:00:00', habits: [
      { id: 'a1b2c3', name: 'Walk', status: 'active', period: { period_type: 'W', period_count: 1, target_count: 2 }, records: [
        { day: '2026-11-05', done: true }, { day: '2026-11-04', done: false, text: 'rain' },
      ] },
      { id: 'd4e5f6', name: 'Bin', status: 'soft_delete', records: [{ day: '2026-11-05', done: true }] },
    ] })))!;
    expect(r.source).toBe('JSON export');
    expect(r.habits).toEqual([{ name: 'Walk', color: null, goal: 1, unit: null, perWeek: 2, checks: { '2026-11-05': true } }]);
    expect(r.dropped).toEqual({ skips: 0, notes: 1, habits: [] });

    const c = (await readHabitFile('habits.csv', enc('Date,Walk,Read,\n2026-11-05,1,0,\n2026-11-04,-1,2,\n')))!;
    expect(c.source).toBe('CSV');
    expect(c.habits.map(h => [h.name, h.checks])).toEqual([['Walk', { '2026-11-05': true }], ['Read', { '2026-11-04': true }]]);
  });

  it("Task-history JSON: up habits by scoredUp, dailies by completed, days shifted by the user's zone and day start", async () => {
    // UTC+2 (timezoneOffset -120), day starts at 04:00.
    const at = (iso: string) => Date.parse(iso);
    const r = (await readHabitFile('user-data.json', json({
      preferences: { timezoneOffset: -120, dayStart: 4 },
      tasks: {
        habits: [
          { text: 'Drink water', up: true, down: false, history: [
            { date: at('2026-11-05T10:00:00Z'), value: 1, scoredUp: 3, scoredDown: 0 },
            { date: at('2026-11-04T23:30:00Z'), value: 1, scoredUp: 1, scoredDown: 0 }, // 01:30 local, before 04:00: still 4 Nov
            { date: at('2026-09-01T00:00:00Z'), value: 0.4 }, // a monthly average: no scoredUp
          ] },
          { text: 'Junk food', up: false, down: true, history: [{ date: at('2026-11-05T10:00:00Z'), value: -1, scoredUp: 0, scoredDown: 2 }] },
        ],
        dailys: [{ text: 'Floss', frequency: 'weekly', everyX: 1, history: [
          { date: at('2026-11-05T19:00:00Z'), value: 1, completed: true }, { date: at('2026-11-04T19:00:00Z'), value: 0, completed: false },
        ] }],
        todos: [], rewards: [],
      },
    })))!;
    expect(r.source).toBe('JSON export');
    expect(r.habits).toEqual([
      { name: 'Drink water', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-05': 3, '2026-11-04': true } },
      { name: 'Floss', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-05': true } },
    ]);
    expect(r.dropped.habits).toEqual(['Junk food (a negative habit)']);
    expect(r.warnings.join(' ')).toMatch(/1 older entry/);
    expect(r.warnings.join(' ')).toMatch(/Floss/);
  });

  it('a xairos backup is not a habit import; unknown files are refused', async () => {
    expect(await readHabitFile('xairos-backup.json', json({ app: 'xairos', version: 1 }))).toBeNull();
    await expect(readHabitFile('x.json', json({ hello: 1 }))).rejects.toThrow(/recogni/);
    await expect(readHabitFile('x.txt', enc('just text'))).rejects.toThrow(/recogni/);
  });
});

describe('merge by name', () => {
  const PALETTE = ['71,114,250', '225,62,57', '52,178,107'];
  const ex = (o: Partial<Habit>): Habit => ({ id: 'e', name: 'X', color: PALETTE[0]!, checks: {}, order: 3, created: 1, ...o });
  let n = 0;
  const opts = { now: 99, palette: PALETTE, newId: () => 'new' + n++ };

  it('same name (any case) merges checks without replacing; new names become habits', () => {
    const walk = ex({ id: 'w', name: 'Walk', checks: { '2026-11-03': true } });
    const water = ex({ id: 'h2o', name: 'Water', goal: 8, checks: { '2026-11-05': 6, '2026-11-04': 2 } });
    const p = planImport([walk, water, ex({ id: 'gone', name: 'Read', removed: true })], [
      { name: ' walk ', color: null, goal: 1, unit: null, perWeek: 2, checks: { '2026-11-05': true, '2026-11-03': true } },
      { name: 'Water', color: null, goal: 8, unit: 'cups', perWeek: null, checks: { '2026-11-05': 5, '2026-11-04': 8 } },
      { name: 'Read', color: '#E53935', goal: 3, unit: null, perWeek: 4, checks: { '2026-11-05': 1 } },
    ], opts);
    expect(p.update.map(h => [h.id, h.checks])).toEqual([
      ['w', { '2026-11-03': true, '2026-11-05': true }],
      ['h2o', { '2026-11-05': 6, '2026-11-04': 8 }], // keeps the bigger count each day
    ]);
    expect(p.update[0]!.perWeek).toBeUndefined(); // the existing habit's settings stay
    expect(p.create).toEqual([{ id: 'new0', name: 'Read', color: '225,62,57', checks: { '2026-11-05': 1 }, goal: 3, unit: null, perWeek: 4, order: 4, created: 99 }]);
    expect(p.rows).toEqual([{ name: 'Walk', merge: true, days: 1 }, { name: 'Water', merge: true, days: 1 }, { name: 'Read', merge: false, days: 1 }]);
  });

  it('nothing new for an existing habit: no update; the same name twice in a file becomes one habit', () => {
    const p = planImport([ex({ name: 'Walk', checks: { '2026-11-05': true } })], [
      { name: 'Walk', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-05': true } },
      { name: 'Run', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-01': true } },
      { name: 'run', color: null, goal: 1, unit: null, perWeek: null, checks: { '2026-11-02': true } },
    ], opts);
    expect(p.update).toEqual([]);
    expect(p.create.map(h => [h.name, h.checks])).toEqual([['Run', { '2026-11-01': true, '2026-11-02': true }]]);
  });

  it('picks the nearest palette colour', () => {
    expect(nearestColor('#E53935', PALETTE)).toBe('225,62,57');
    expect(nearestColor('nonsense', PALETTE)).toBeNull();
  });
});
