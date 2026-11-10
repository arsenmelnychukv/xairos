/**
 * PocketBase backend. The routes live in server/pb_hooks; realtime "needSync"
 * comes from the user's row in the `signals` collection over SSE.
 */
import PocketBase, { BaseAuthStore, ClientResponseError } from 'pocketbase';
import type { Changes, PullResult, PushResult, Session, User } from '../types';
import type { ApiToken, ExtEvent, GoogleApi, GoogleStatus, PushApi, ServerAdapter, TokensApi } from './adapter';
import { ApiError } from '../lib/util';

/** The user id inside a PocketBase JWT. */
function tokenUserId(token: string): string | null {
  try {
    const b64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).id ?? null;
  } catch { return null; }
}

export class PocketBaseServer implements ServerAdapter {
  readonly pb: PocketBase;
  constructor(baseUrl: string) {
    // In-memory auth store: the SDK must not keep its own copy of the token in localStorage.
    this.pb = new PocketBase(baseUrl, new BaseAuthStore());
    this.pb.autoCancellation(false);
  }

  private async call<T>(path: string, opts: { method?: string; body?: unknown; token?: string; query?: Record<string, string | number> } = {}): Promise<T> {
    try {
      return await this.pb.send<T>('/api/xairos' + path, {
        method: opts.method || 'GET',
        body: opts.body,
        query: opts.query,
        headers: opts.token ? { Authorization: opts.token } : {},
      });
    } catch (e) {
      if (e instanceof ClientResponseError) {
        const msg = (e.response as { message?: string })?.message || (e.status ? e.message : 'Cannot reach the server.');
        throw new ApiError(e.status, msg);
      }
      throw e;
    }
  }

  signup(input: { name: string; email: string; password: string }) { return this.call<Session>('/signup', { method: 'POST', body: input }); }
  login(input: { email: string; password: string }) { return this.call<Session>('/login', { method: 'POST', body: input }); }
  /** Tokens are stateless JWTs; the client just forgets it. */
  async logout(_token: string) { this.pb.realtime.unsubscribe().catch(() => {}); }

  async findUser(token: string, email: string): Promise<User | null> {
    try { return await this.call<User>('/users', { token, query: { email } }); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }
  async leaveList(token: string, listId: string) { await this.call('/lists/' + encodeURIComponent(listId) + '/leave', { method: 'POST', token }); }
  async deleteAccount(token: string, password: string) { await this.call('/account/delete', { method: 'POST', token, body: { password } }); }
  pull(token: string, checkpoint: number) { return this.call<PullResult>('/sync', { token, query: { checkpoint } }); }
  push(token: string, changes: Partial<Changes>) { return this.call<PushResult>('/sync', { method: 'POST', token, body: changes }); }

  readonly webPush: PushApi = {
    key: async token => (await this.call<{ publicKey: string }>('/push/key', { token })).publicKey,
    subscribe: async (token, sub, tz, weekStart = 1) => { await this.call('/push/subscribe', { method: 'POST', token, body: { ...sub, tz, weekStart } }); },
    unsubscribe: async (token, endpoint) => { await this.call('/push/unsubscribe', { method: 'POST', token, body: { endpoint } }); },
  };

  readonly google: GoogleApi = {
    status: token => this.call<GoogleStatus>('/google', { token }),
    authUrl: (token, tz) => this.call<{ url: string; manual: boolean }>('/google/auth-url', { method: 'POST', token, body: { tz } }),
    finish: (token, code, state) => this.call<GoogleStatus>('/google/finish', { method: 'POST', token, body: { code, state } }),
    disconnect: async token => { await this.call('/google/disconnect', { method: 'POST', token }); },
    events: token => this.call<{ events: ExtEvent[]; eventsAt: number }>('/google/events', { token }),
  };

  readonly tokens: TokensApi = {
    list: token => this.call<ApiToken[]>('/tokens', { token }),
    create: (token, name) => this.call<ApiToken & { token: string }>('/tokens', { method: 'POST', token, body: { name } }),
    revoke: async (token, id) => { await this.call('/tokens/' + encodeURIComponent(id), { method: 'DELETE', token }); },
  };

  subscribe(token: string, on: { needSync(): void; sessionGone(): void }) {
    const me = tokenUserId(token);
    if (!me || typeof EventSource === 'undefined') return () => {};
    this.pb.authStore.save(token, null);
    let active = true;
    const unsubs: Promise<() => Promise<void>>[] = [
      this.pb.collection('signals').subscribe(me, () => { if (active) on.needSync(); }),
      // Fires on every (re)connect: catch up on anything missed while offline.
      this.pb.realtime.subscribe('PB_CONNECT', () => { if (active) on.needSync(); }),
    ];
    unsubs.forEach(p => p.catch(e => console.warn('realtime subscribe failed', e)));
    return () => {
      active = false;
      unsubs.forEach(p => p.then(u => u()).catch(() => {}));
      this.pb.authStore.clear();
    };
  }
}
