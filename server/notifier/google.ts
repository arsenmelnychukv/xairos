/**
 * Google Calendar sync, run by the worker each round.
 *
 * Write: every timed task (or time block) a user should see goes to a
 * "xairos" calendar in their Google account; done, deleted and untimed tasks
 * are removed. Each event carries its task id and a hash of what was sent in
 * private extended properties, so the mapping lives in Google itself: a
 * restart rebuilds it by listing the calendar, and nothing is duplicated.
 *
 * Read: the user's other calendars are read every few minutes for a window
 * around today and handed to PocketBase, which serves them to the app.
 */
import { createHash } from 'node:crypto';
import type { Task } from '../../src/types';
import { zonedEpoch } from '../../src/lib/dates';
import { wallAt } from '../../src/lib/tz';
import { DEFAULT_DUR } from '../../src/calendar';
import type { Scheduler } from './scheduler';
import { OLD } from '../../src/lib/rename';

export interface GoogleLink { user: string; refresh: string; access: string; expires: number; calId: string; tz: string; error: string }
export interface GoogleConfig {
  clientId: string; secret: string;
  oauthBase?: string; apiBase?: string;
  /** PocketBase internal API: GET returns JSON, POST sends one. */
  api: <T>(path: string, body?: unknown) => Promise<T>;
  log?: (msg: string) => void;
}
/** An event from the user's calendars, as the app shows it. Timed: start/end in ms. All-day: `date`/`endDate` (end exclusive). */
export interface ExtEvent { id: string; cal: string; calName: string; color: string; title: string; start?: number; end?: number; date?: string; endDate?: string; link?: string; location?: string }

const READ_EVERY_MS = 5 * 60000;
const READ_BACK_DAYS = 30, READ_AHEAD_DAYS = 180;
const CAL_NAME = 'xairos';

/** The grant is gone (revoked, or the app removed in Google): the user must connect again. */
class AuthError extends Error {}
/** Google rejected the access token: refresh it and try once more. */
class ExpiredError extends Error {}

export class GoogleSync {
  private oauth: string; private apiBase: string; private log: (m: string) => void;
  /** user → (task id → { event id, hash }), rebuilt from Google once per process. */
  private maps = new Map<string, Map<string, { eventId: string; hash: string }>>();
  private lastRead = new Map<string, number>();
  private lastEvents = new Map<string, string>();

  constructor(private cfg: GoogleConfig) {
    this.oauth = (cfg.oauthBase || 'https://oauth2.googleapis.com').replace(/\/$/, '');
    this.apiBase = (cfg.apiBase || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
    this.log = cfg.log || (m => console.log(new Date().toISOString(), m));
  }

  async tick(sched: Scheduler, now = Date.now()) {
    const links = await this.cfg.api<GoogleLink[]>('/google/links');
    for (const link of links) {
      try {
        try { await this.syncUser(link, sched, now); }
        catch (e) { if (!(e instanceof ExpiredError)) throw e; link.expires = 0; await this.syncUser(link, sched, now); }
        if (link.error) await this.cfg.api('/google/update', { user: link.user, error: '' });
      } catch (e) {
        const msg = e instanceof AuthError || e instanceof ExpiredError ? 'Google disconnected xairos. Connect again.' : `Google sync failed: ${(e as Error).message}`.slice(0, 300);
        this.log(`google ${link.user}: ${(e as Error).message}`);
        if (msg !== link.error) await this.cfg.api('/google/update', { user: link.user, error: msg }).catch(() => {});
        if (e instanceof AuthError) this.maps.delete(link.user);
      }
    }
  }

  private async syncUser(link: GoogleLink, sched: Scheduler, now: number) {
    const token = await this.token(link, now);
    const calId = await this.ensureCalendar(link, token);
    await this.writeTasks(link, token, calId, sched);
    if (now - (this.lastRead.get(link.user) || 0) >= READ_EVERY_MS) {
      await this.readEvents(link, token, calId, now);
      this.lastRead.set(link.user, now);
    }
  }

  /** A valid access token, refreshed when it is about to expire. */
  private async token(link: GoogleLink, now: number): Promise<string> {
    if (link.access && link.expires > now + 60000) return link.access;
    const res = await fetch(this.oauth + '/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.secret, refresh_token: link.refresh, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
    if (j.error === 'invalid_grant') throw new AuthError('invalid_grant');
    if (!res.ok || !j.access_token) throw new Error(`token refresh: ${res.status} ${j.error || ''}`);
    link.access = j.access_token; link.expires = now + (j.expires_in || 3600) * 1000 - 60000;
    await this.cfg.api('/google/update', { user: link.user, access: link.access, expires: link.expires });
    return link.access;
  }

  private async g<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.apiBase + path, {
      method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) throw new ExpiredError('401');
    if (res.status === 204 || (method === 'DELETE' && (res.status === 404 || res.status === 410))) return undefined as T;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(`${method} ${path.split('?')[0]}: ${res.status} ${(j as { error?: { message?: string } }).error?.message || ''}`); (err as Error & { status?: number }).status = res.status; throw err; }
    return j as T;
  }

  /** The "xairos" calendar: reuse the stored one, or make it (again, if it was deleted in Google). */
  private async ensureCalendar(link: GoogleLink, token: string): Promise<string> {
    if (link.calId) {
      try { await this.g(token, 'GET', `/calendars/${encodeURIComponent(link.calId)}`); return link.calId; }
      catch (e) { if ((e as { status?: number }).status !== 404) throw e; this.maps.delete(link.user); }
    }
    const cal = await this.g<{ id: string }>(token, 'POST', '/calendars', { summary: CAL_NAME, description: 'Timed tasks from xairos. Changes made here are overwritten.', timeZone: link.tz || 'UTC' });
    link.calId = cal.id;
    this.maps.delete(link.user); // a new calendar starts empty
    await this.cfg.api('/google/update', { user: link.user, calId: cal.id });
    return cal.id;
  }

  /** What is in the xairos calendar now, by task id. Listed from Google once per process. */
  private async existing(link: GoogleLink, token: string, calId: string) {
    let map = this.maps.get(link.user);
    if (map) return map;
    map = new Map();
    let page = '';
    do {
      const r = await this.g<{ items?: GEvent[]; nextPageToken?: string }>(token, 'GET', `/calendars/${encodeURIComponent(calId)}/events?maxResults=2500&showDeleted=false${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      for (const ev of r.items || []) {
        const p = ev.extendedProperties?.private;
        // Events written before the rename carry the old property names. They are
        // matched by those, and an empty hash makes the next pass rewrite them.
        const task = p?.xairosTask || p?.[OLD + 'Task'];
        if (!task) continue;
        // A second copy of the same task (e.g. from a crash mid-write) is removed.
        if (map.has(task)) { await this.g(token, 'DELETE', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(ev.id)}`); continue; }
        map.set(task, { eventId: ev.id, hash: p?.xairosTask ? p.xairosHash || '' : '' });
      }
      page = r.nextPageToken || '';
    } while (page);
    this.maps.set(link.user, map);
    return map;
  }

  private async writeTasks(link: GoogleLink, token: string, calId: string, sched: Scheduler) {
    const map = await this.existing(link, token, calId);
    const want = new Map<string, NewEvent>();
    for (const t of sched.tasks.values()) {
      if (!t.due || !t.time || !sched.recipients(t).includes(link.user)) continue;
      want.set(t.id, eventFor(t, sched.lists.get(t.listId)?.name, link.tz));
    }
    const path = `/calendars/${encodeURIComponent(calId)}/events`;
    for (const [id, ev] of want) {
      const cur = map.get(id), hash = ev.extendedProperties!.private!.xairosHash!;
      if (cur?.hash === hash) continue;
      if (cur) {
        try { await this.g(token, 'PUT', `${path}/${encodeURIComponent(cur.eventId)}`, ev); map.set(id, { eventId: cur.eventId, hash }); continue; }
        catch (e) { if (![404, 410].includes((e as { status?: number }).status!)) throw e; } // deleted in Google: make it again
      }
      const made = await this.g<{ id: string }>(token, 'POST', path, ev);
      map.set(id, { eventId: made.id, hash });
    }
    for (const [id, cur] of map) {
      if (want.has(id)) continue;
      await this.g(token, 'DELETE', `${path}/${encodeURIComponent(cur.eventId)}`);
      map.delete(id);
    }
  }

  private async readEvents(link: GoogleLink, token: string, calId: string, now: number) {
    const cals = await this.g<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; selected?: boolean; hidden?: boolean }[] }>(token, 'GET', '/users/me/calendarList?minAccessRole=reader&maxResults=250');
    const min = new Date(now - READ_BACK_DAYS * 864e5).toISOString(), max = new Date(now + READ_AHEAD_DAYS * 864e5).toISOString();
    const out: ExtEvent[] = [];
    for (const c of cals.items || []) {
      if (c.id === calId || c.hidden || c.selected === false) continue;
      let page = '';
      do {
        const r = await this.g<{ items?: GEvent[]; nextPageToken?: string }>(token, 'GET',
          `/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
        for (const ev of r.items || []) {
          if (ev.status === 'cancelled' || ev.extendedProperties?.private?.xairosTask) continue;
          // Colour and link end up in the page's style and href: accept only what they should be.
          const color = /^#[0-9a-f]{3,8}$/i.test(c.backgroundColor || '') ? c.backgroundColor! : '#7986cb';
          const link = /^https:\/\//.test(ev.htmlLink || '') ? ev.htmlLink : undefined;
          const base = { id: ev.id, cal: c.id, calName: c.summaryOverride || c.summary || '', color, title: ev.summary || '(No title)', link, location: ev.location };
          if (ev.start?.date) out.push({ ...base, date: ev.start.date, endDate: ev.end?.date || ev.start.date });
          else if (ev.start?.dateTime) out.push({ ...base, start: Date.parse(ev.start.dateTime), end: Date.parse(ev.end?.dateTime || ev.start.dateTime) });
        }
        page = r.nextPageToken || '';
      } while (page && out.length < 20000);
    }
    const json = JSON.stringify(out);
    if (json === this.lastEvents.get(link.user)) return;
    this.lastEvents.set(link.user, json);
    await this.cfg.api('/google/update', { user: link.user, events: out });
  }
}

interface GEvent {
  id: string; status?: string; summary?: string; description?: string; location?: string; htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  reminders?: { useDefault: boolean; overrides: unknown[] };
}
type NewEvent = Omit<GEvent, 'id'>;

/**
 * The Google event for a timed task. Floating times use the user's zone (the
 * one their device reported when connecting); pinned ones their own zone.
 */
export function eventFor(t: Task, listName: string | undefined, userTz: string): NewEvent {
  const tz = (t.tz && t.time ? t.tz : '') || userTz || 'UTC';
  const [h, m] = t.time!.split(':').map(Number);
  const startMs = zonedEpoch(t.due!, h!, m!, tz), endMs = startMs + Math.max(15, t.dur || DEFAULT_DUR) * 60000;
  const end = wallAt(endMs, tz);
  const body: NewEvent = {
    summary: t.title || 'Untitled',
    description: `${listName ? listName + ' · ' : ''}From xairos. Edit it in xairos: changes here are overwritten.`,
    start: { dateTime: `${t.due}T${t.time}:00`, timeZone: tz },
    end: { dateTime: `${end.due}T${end.time}:00`, timeZone: tz },
    // xairos sends its own reminders.
    reminders: { useDefault: false, overrides: [] },
  };
  const hash = createHash('sha256').update(JSON.stringify([body.summary, body.description, body.start, body.end])).digest('base64url').slice(0, 16);
  return { ...body, extendedProperties: { private: { xairosTask: t.id, xairosHash: hash } } };
}
