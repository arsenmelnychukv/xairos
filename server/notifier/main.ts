/**
 * xairos notifier: sends reminder pushes while no tab is open.
 *
 * PocketBase's hook runtime has no ECDH/ECDSA, so Web Push runs here, next to
 * it. Every 30 s it pulls changed tasks, lists and push subscriptions from
 * PocketBase (`/api/xairos/internal/changes`, guarded by a shared secret),
 * works out which reminders are due and sends them. Sent keys live in a small
 * state file, so a restart does not send them twice.
 *
 * Env: XAIROS_NOTIFIER_SECRET, XAIROS_VAPID_PUBLIC, XAIROS_VAPID_PRIVATE,
 * XAIROS_VAPID_SUBJECT (mailto: or https: URL), XAIROS_PB_URL
 * (default http://127.0.0.1:8090), XAIROS_NOTIFIER_STATE (state file path).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Scheduler, type Changes, type SchedulerState } from './scheduler';
import { sendPush, type VapidKeys } from './webpush';
import { GoogleSync } from './google';
import { actToken } from './actions';

export interface NotifierConfig {
  pbUrl: string; secret: string; vapid: VapidKeys; stateFile: string | null; log?: (msg: string) => void;
  /** Google Calendar sync (step 10). Off when unset. */
  google?: { clientId: string; secret: string; oauthBase?: string; apiBase?: string } | null;
}

export class Notifier {
  sched: Scheduler;
  google: GoogleSync | null = null;
  private log: (msg: string) => void;
  constructor(private cfg: NotifierConfig) {
    this.log = cfg.log || (m => console.log(new Date().toISOString(), m));
    this.sched = new Scheduler(this.loadState());
    if (cfg.google) this.google = new GoogleSync({ ...cfg.google, api: (p, b) => this.api(p, b), log: this.log });
  }

  private loadState(): Partial<SchedulerState> | undefined {
    if (!this.cfg.stateFile) return undefined;
    try { return JSON.parse(readFileSync(this.cfg.stateFile, 'utf8')); } catch { return undefined; }
  }

  private saveState() {
    const f = this.cfg.stateFile;
    if (!f) return;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f + '.tmp', JSON.stringify(this.sched.state));
    renameSync(f + '.tmp', f);
  }

  async api<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.cfg.pbUrl + '/api/xairos/internal' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-xairos-Secret': this.cfg.secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? (undefined as T) : res.json() as Promise<T>;
  }

  /** One round: pull changes, send what is due. Returns how many pushes were sent. */
  async tick(now = Date.now()): Promise<number> {
    this.sched.apply(await this.api<Changes>('/changes?since=' + this.sched.checkpoint));
    const due = this.sched.due(now);
    const gone = new Set<string>();
    let sent = 0;
    for (const d of due) {
      if (gone.has(d.sub.endpoint)) continue;
      this.sched.mark(d.key, now);
      try {
        // A signed token lets the notification's buttons act without a xairos tab.
        const habit = !!d.payload.habitId;
        const act = actToken(this.cfg.secret, habit ? 'habit' : 'task', d.id, d.sub.user, now, habit ? undefined : this.sched.tasks.get(d.id)?.due ?? null);
        const r = await sendPush(d.sub, { ...d.payload, act }, this.cfg.vapid, { topic: d.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
        if (r.ok) { sent++; continue; }
        if (r.gone) gone.add(d.sub.endpoint);
        // Push service busy or down: try again next round.
        else if (r.status === 429 || r.status >= 500) this.sched.unmark(d.key);
        this.log(`push to ${new URL(d.sub.endpoint).host} failed: ${r.status} ${r.body}`);
      } catch (e) {
        this.sched.unmark(d.key);
        this.log(`push to ${new URL(d.sub.endpoint).host} failed: ${(e as Error).message}`);
      }
    }
    if (gone.size) await this.api('/push/gone', { endpoints: [...gone] });
    this.sched.prune(now);
    if (due.length) this.saveState();
    // Google problems are per user and reported to them; they never stop reminders.
    if (this.google) await this.google.tick(this.sched, now).catch(e => this.log('google: ' + (e as Error).message));
    return sent;
  }
}
