/**
 * Habit importers: pure parsers from common habit-tracker export files
 * (ZIP of CSVs, several JSON shapes, wide CSV) to habits, and a merge-by-name plan.
 *
 * Nothing here is stored as-is: the view turns a plan into normal `upd()` calls,
 * so imported habits sync like any other edit.
 */
import type { Habit, Ymd } from '../types';
import { checkValue, countOn } from '../habits';
import { isOwnBackup } from './rename';

/** A habit read from an export file, before it is matched against yours. */
export interface ImportedHabit {
  name: string;
  /** '#RRGGBB' when the source has one; the view picks the nearest xairos colour. */
  color: string | null;
  goal: number;
  unit: string | null;
  perWeek: number | null;
  checks: Record<Ymd, true | number>;
}

export interface ImportResult {
  /** The kind of file it came from, for the preview. */
  source: string;
  habits: ImportedHabit[];
  /** What has nowhere to go yet: skip days and notes (Next tier), and habits xairos cannot model ("Name (why)"). */
  dropped: { skips: number; notes: number; habits: string[] };
  /** Settings that changed on the way in, e.g. a monthly frequency that became every day. */
  warnings: string[];
}

const isYmd = (s: unknown): s is Ymd => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
const goalOf = (v: unknown) => { const n = Math.round(num(v)); return n >= 1 ? Math.min(999, n) : 1; };

/** Record `n` check-ins on `day` (the larger count wins if the day is already there). */
function put(h: ImportedHabit, day: string, n: number) {
  if (!isYmd(day) || !(n > 0)) return;
  n = Math.min(999, Math.max(1, Math.round(n)));
  const had = countOn(h, day);
  if (n > had) h.checks[day] = h.goal === 1 && n === 1 ? true : n;
}

function newResult(source: string): ImportResult {
  return { source, habits: [], dropped: { skips: 0, notes: 0, habits: [] }, warnings: [] };
}
const habit = (name: string, o: Partial<ImportedHabit> = {}): ImportedHabit =>
  ({ name, color: null, goal: 1, unit: null, perWeek: null, checks: {}, ...o });

// ---- Readers ----

/** CSV rows: quoted fields with doubled quotes, LF or CRLF, blank lines dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') { f += '"'; i++; }
      else q = false;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

async function inflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Files in a ZIP, by path. Reads the central directory; stored and deflated
 * entries only (what phones write). `want` picks which entries to unpack, so
 * a large archive costs only the files used.
 */
export async function unzip(buf: Uint8Array, want: (name: string) => boolean = () => true): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Not a ZIP file.');
  const count = dv.getUint16(end + 10, true), out = new Map<string, Uint8Array>();
  let p = dv.getUint32(end + 16, true);
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('This ZIP file is damaged.');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
    const at = dv.getUint32(p + 42, true), name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (name.endsWith('/') || !want(name)) continue;
    const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true), raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error('This ZIP uses a compression xairos cannot read.');
  }
  return out;
}

// ---- Formats ----

/**
 * CSV export in a ZIP: Habits.csv plus "NNN name/Checkmarks.csv" per habit.
 * Only days the user entered: YES_MANUAL, or a number (stored ×1000).
 * YES_AUTO, NO and UNKNOWN are derived values and are left out.
 */
function zipCsv(files: Map<string, string>): ImportResult {
  const r = newResult('ZIP export');
  const key = [...files.keys()].filter(k => /(^|\/)Habits\.csv$/.test(k)).sort((a, b) => a.length - b.length)[0]!;
  const dir = key.slice(0, key.length - 'Habits.csv'.length);
  const [head, ...rows] = parseCsv(files.get(key)!.replace(/^﻿/, ''));
  const col = (name: string) => head!.findIndex(h => h.trim() === name);
  const c = { pos: col('Position'), name: col('Name'), type: col('Type'), num: col('FrequencyNumerator'), den: col('FrequencyDenominator'), color: col('Color'), unit: col('Unit'), tt: col('Target Type'), tv: col('Target Value') };
  let rounded = false;
  for (const row of rows) {
    const name = str(row[c.name]); if (!name) continue;
    const numerical = row[c.type] === 'NUMERICAL';
    if (numerical && row[c.tt] === 'AT_MOST') { r.dropped.habits.push(`${name} (an "at most" habit)`); continue; }
    const n = num(row[c.num]), d = num(row[c.den]);
    let perWeek: number | null = null;
    if (d === 7 && n >= 1 && n < 7) perWeek = n;
    else if (!(n === d || (n === 1 && d === 1))) r.warnings.push(`${name}: “${n} times in ${d} days” became every day.`);
    const color = /^#[0-9a-f]{6}$/i.test(str(row[c.color])) ? str(row[c.color]) : null;
    const h = habit(name, { color, perWeek, goal: numerical ? goalOf(row[c.tv]) : 1, unit: numerical ? str(row[c.unit]) || null : null });
    const pos = str(row[c.pos]);
    const ck = [...files.keys()].find(k => k.startsWith(dir) && k.endsWith('/Checkmarks.csv') && k.slice(dir.length).startsWith(pos + ' '));
    for (const [day, value, note] of ck ? parseCsv(files.get(ck)!).slice(1) : []) {
      if (str(note)) r.dropped.notes++;
      if (value === 'SKIP') r.dropped.skips++;
      else if (!numerical) { if (value === 'YES_MANUAL') put(h, day!, 1); }
      else { const v = num(value); if (v > 0) { if (v % 1000) rounded = true; put(h, day!, v / 1000); } }
    }
    r.habits.push(h);
  }
  if (rounded) r.warnings.push('Amounts with decimals were rounded to whole numbers.');
  return r;
}

/** JSON export with epoch-day records: {habits: [{name, type, status, daily_goal, freq_type, freq_custom, records: [{record_date (epoch day), record_type, record_value}]}]}. */
function jsonEpochDays(list: Record<string, unknown>[]): ImportResult {
  const r = newResult('JSON export');
  for (const x of list) {
    const name = str(x.name); if (!name || x.status === 2) continue; // status 2: deleted
    if (x.type === 2) { r.dropped.habits.push(`${name} (a habit to quit)`); continue; }
    let args: number[] = [];
    try { const a = typeof x.freq_custom === 'string' ? JSON.parse(x.freq_custom) : x.freq_custom; if (Array.isArray(a)) args = a.map(Number); } catch { /* no args */ }
    let perWeek: number | null = null;
    if (x.freq_type === 1 && args[0]! >= 1 && args[0]! < 7) perWeek = args[0]!;
    else if (x.freq_type === 2 && args[0]! < 31) r.warnings.push(`${name}: “${args[0]} days a month” became every day.`);
    else if (x.freq_type === 3 && args[0] !== args[1]) r.warnings.push(`${name}: “${args[0]} times in ${args[1]} days” became every day.`);
    const h = habit(name, { goal: goalOf(x.daily_goal), unit: str(x.daily_goal_unit) || null, perWeek });
    for (const rec of Array.isArray(x.records) ? x.records as Record<string, unknown>[] : []) {
      if (rec.is_deleted && rec.is_deleted !== 0) continue;
      const day = Number.isFinite(num(rec.record_date)) ? new Date(num(rec.record_date) * 864e5).toISOString().slice(0, 10) : '';
      if (str(rec.reason)) r.dropped.notes++;
      if (rec.record_type === 2) r.dropped.skips++;
      else if (rec.record_type === 1) put(h, day, num(rec.record_value) > 0 ? num(rec.record_value) : h.goal);
    }
    r.habits.push(h);
  }
  return r;
}

/** JSON backup with day events: {habits: [{title, habitType, targetValue, unit, events: {"<day> 12:00:00.000Z": [dayType, comment, progress?]}}]}, or a bare array (old files). */
function jsonEvents(list: Record<string, unknown>[]): ImportResult {
  const r = newResult('JSON backup');
  for (const x of list) {
    const name = str(x.title); if (!name || x.deleted_at) continue;
    const numeric = x.habitType === 1;
    const h = habit(name, { goal: numeric ? goalOf(x.targetValue) : 1, unit: numeric ? str(x.unit) || null : null });
    for (const [key, ev] of Object.entries((x.events || {}) as Record<string, unknown>)) {
      if (!Array.isArray(ev)) continue;
      const day = key.slice(0, 10), type = String(ev[0] ?? '').split('.').pop()!.toLowerCase(), progress = num(ev[2]);
      if (str(ev[1])) r.dropped.notes++;
      if (type === 'check') put(h, day, numeric && progress > 0 ? progress : h.goal);
      else if (type === 'progress') put(h, day, progress);
      else if (type === 'skip') r.dropped.skips++;
    }
    r.habits.push(h);
  }
  return r;
}

/** JSON export with periods: {habits: [{name, status, period: {period_type, period_count, target_count}, records: [{day, done, text?}]}]}. */
function jsonPeriods(list: Record<string, unknown>[]): ImportResult {
  const r = newResult('JSON export');
  for (const x of list) {
    const name = str(x.name); if (!name || x.status === 'soft_delete') continue;
    const p = (x.period || null) as { period_type?: string; period_count?: number; target_count?: number } | null;
    let perWeek: number | null = null;
    if (p && p.period_type === 'W' && p.period_count === 1 && p.target_count! >= 1 && p.target_count! < 7) perWeek = p.target_count!;
    else if (p && !(p.period_type === 'D' && p.period_count === 1 && p.target_count === 1) && !(p.period_type === 'W' && p.target_count! >= 7 * (p.period_count || 1))) {
      r.warnings.push(`${name}: “${p.target_count} times every ${p.period_count} ${p.period_type}” became every day.`);
    }
    const h = habit(name, { perWeek });
    for (const rec of Array.isArray(x.records) ? x.records as Record<string, unknown>[] : []) {
      if (str(rec.text)) r.dropped.notes++;
      if (rec.done === true) put(h, String(rec.day), 1);
    }
    r.habits.push(h);
  }
  return r;
}

/** Wide CSV: "Date,<habit>,<habit>…", a cell above 0 means done. */
function wideCsv(rows: string[][]): ImportResult {
  const r = newResult('CSV');
  const names = rows[0]!.slice(1).map(str);
  const hs = names.map(n => (n ? habit(n) : null));
  for (const row of rows.slice(1)) row.slice(1).forEach((v, i) => { if (hs[i] && num(v) > 0) put(hs[i]!, str(row[0]), 1); });
  r.habits = hs.filter((h): h is ImportedHabit => !!h);
  return r;
}

/**
 * Task-history JSON (habits and dailies). Habits with a + button count their daily `scoredUp`;
 * dailies count `completed` days. History dates are UTC ms: the day is shifted
 * by the user's `timezoneOffset` (JS sign: minutes behind UTC) and `dayStart`.
 */
function jsonHistory(data: Record<string, any>): ImportResult {
  const r = newResult('JSON export');
  const off = num(data.preferences?.timezoneOffset) || 0, start = num(data.preferences?.dayStart) || 0;
  const dayOf = (d: unknown) => { const ms = typeof d === 'number' ? d : Date.parse(String(d)); return Number.isFinite(ms) ? new Date(ms - off * 6e4 - start * 36e5).toISOString().slice(0, 10) : ''; };
  let averaged = 0;
  for (const x of (data.tasks?.habits || []) as Record<string, any>[]) {
    const name = str(x.text); if (!name) continue;
    if (!x.up) { r.dropped.habits.push(`${name} (a negative habit)`); continue; }
    const h = habit(name);
    for (const e of Array.isArray(x.history) ? x.history : []) {
      if (typeof e?.scoredUp !== 'number') { averaged++; continue; }
      if (e.scoredUp > 0) { const day = dayOf(e.date); put(h, day, e.scoredUp + countOn(h, day)); }
    }
    r.habits.push(h);
  }
  for (const x of (data.tasks?.dailys || []) as Record<string, any>[]) {
    const name = str(x.text); if (!name) continue;
    if ((x.frequency && x.frequency !== 'daily') || num(x.everyX) > 1) r.warnings.push(`${name}: its repeat became every day.`);
    const h = habit(name);
    for (const e of Array.isArray(x.history) ? x.history : []) if (e?.completed === true) put(h, dayOf(e.date), 1);
    r.habits.push(h);
  }
  if (averaged) r.warnings.push(`${averaged} older ${averaged === 1 ? 'entry is a monthly average' : 'entries are monthly averages'} in the export and ${averaged === 1 ? 'was' : 'were'} left out.`);
  return r;
}

const UNKNOWN = 'This file was not recognised. xairos reads its own backups, and habit exports as a ZIP of CSVs, JSON or a CSV with a Date column.';

/**
 * Read a habit export file. Returns null for a xairos backup
 * (the caller restores that its own way); throws with a readable message for
 * anything else it cannot read.
 */
export async function readHabitFile(name: string, bytes: Uint8Array): Promise<ImportResult | null> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const raw = await unzip(bytes, n => /(^|\/)Habits\.csv$/.test(n) || /\/Checkmarks\.csv$/.test(n));
    if (![...raw.keys()].some(k => /(^|\/)Habits\.csv$/.test(k))) throw new Error('This ZIP is not a habit export xairos can read.');
    const files = new Map([...raw].map(([k, v]) => [k, new TextDecoder().decode(v)]));
    return zipCsv(files);
  }
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  if (/^\s*[[{]/.test(text)) {
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(UNKNOWN); }
    if (data && isOwnBackup(data.app)) return null;
    if (data?.tasks && (data.tasks.habits || data.tasks.dailys)) return jsonHistory(data);
    const list = Array.isArray(data) ? data : data?.habits;
    if (!Array.isArray(list)) throw new Error(UNKNOWN);
    const first = (list[0] || {}) as Record<string, any>;
    if (('title' in first && 'events' in first) || data.metadata) return jsonEvents(list);
    if ('freq_type' in first || 'daily_goal' in first || (Array.isArray(first.records) && 'record_date' in (first.records[0] || {}))) return jsonEpochDays(list);
    if ('records' in first || 'user_email' in data) return jsonPeriods(list);
    throw new Error(UNKNOWN);
  }
  const rows = parseCsv(text);
  if (rows.length && str(rows[0]![0]).toLowerCase() === 'date' && rows[0]!.length > 1) return wideCsv(rows);
  throw new Error(UNKNOWN);
}

// ---- Merge ----

/** The palette entry ('r,g,b') nearest to a '#RRGGBB' colour, or null. */
export function nearestColor(hex: string | null, palette: string[]): string | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x!, 16));
  let best: string | null = null, bd = Infinity;
  for (const p of palette) {
    const [pr, pg, pb] = p.split(',').map(Number), d = (pr! - r!) ** 2 + (pg! - g!) ** 2 + (pb! - b!) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export interface ImportPlan {
  /** New habits to add. */
  create: Habit[];
  /** Your habits with more check-ins (only those that gained some). */
  update: Habit[];
  /** One line per imported habit for the preview: merged into one of yours or new, and how many days it adds. */
  rows: { name: string; merge: boolean; days: number }[];
}

/**
 * Match imported habits to yours by name (trimmed, any case). A match gets the
 * imported days merged in: a day keeps the larger count, nothing is removed,
 * and the habit's own settings stay. Others become new habits.
 */
export function planImport(existing: Habit[], imported: ImportedHabit[], o: { now: number; palette: string[]; newId: () => string }): ImportPlan {
  const live = existing.filter(h => !h.removed);
  const byName = new Map(live.map(h => [h.name.trim().toLowerCase(), h]));
  const created = new Map<string, Habit>(), changed = new Map<string, Habit>(), rows = new Map<string, ImportPlan['rows'][number]>();
  let order = Math.max(0, ...existing.map(h => h.order || 0));
  for (const imp of imported) {
    const key = imp.name.trim().toLowerCase(); if (!key) continue;
    const target = created.get(key) || changed.get(key) || byName.get(key);
    if (!target) {
      const h: Habit = {
        id: o.newId(), name: imp.name.trim(), color: nearestColor(imp.color, o.palette) || o.palette[(live.length + created.size) % o.palette.length]!,
        checks: { ...imp.checks }, goal: imp.goal > 1 ? imp.goal : null, unit: imp.unit, perWeek: imp.perWeek, order: ++order, created: o.now,
      };
      created.set(key, h);
      rows.set(key, { name: h.name, merge: false, days: Object.keys(h.checks).length });
      continue;
    }
    const checks = { ...target.checks };
    let added = 0;
    for (const day of Object.keys(imp.checks)) {
      const n = countOn(imp, day);
      if (n > countOn({ checks, goal: target.goal }, day)) { checks[day] = checkValue(target, n)!; added++; }
    }
    const row = rows.get(key) || { name: target.name, merge: !created.has(key), days: 0 };
    row.days += added; rows.set(key, row);
    if (!added) continue;
    const next = { ...target, checks };
    if (created.has(key)) created.set(key, next); else changed.set(key, next);
  }
  return { create: [...created.values()], update: [...changed.values()], rows: [...rows.values()] };
}
