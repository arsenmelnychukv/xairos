import type { Changes, PullResult, PushResult, Session, User } from '../types';

/**
 * The backend contract (ROADMAP.md §3). `LocalServer` implements it in
 * localStorage for demo and offline use; `PocketBaseServer` is the real one.
 */
export interface ServerAdapter {
  signup(input: { name: string; email: string; password: string }): Promise<Session>;
  login(input: { email: string; password: string }): Promise<Session>;
  logout(token: string): Promise<void>;
  findUser(token: string, email: string): Promise<User | null>;
  leaveList(token: string, listId: string): Promise<void>;
  /**
   * Delete the account for good (asks for the password again). Owned lists and
   * their tasks are erased, shared lists lose the user, private data goes.
   */
  deleteAccount(token: string, password: string): Promise<void>;
  /** Everything visible to this user with `seq > checkpoint`. */
  pull(token: string, checkpoint: number): Promise<PullResult>;
  push(token: string, changes: Partial<Changes>): Promise<PushResult>;
  /**
   * Realtime hooks. `needSync` carries no data: the client pulls.
   * `sessionGone` fires when another tab or device ended this session.
   */
  subscribe(token: string, on: { needSync(): void; sessionGone(): void }): () => void;
  /** Web Push for background reminders. Absent when the backend cannot send pushes. */
  webPush?: PushApi;
  /** Google Calendar connection (step 10). Absent when the backend has none. */
  google?: GoogleApi;
  /** Personal API tokens for quick add from Apple Shortcuts (step 11). */
  tokens?: TokensApi;
}

export interface ApiToken { id: string; name: string; prefix: string; created: number; lastUsed: number }
export interface TokensApi {
  list(token: string): Promise<ApiToken[]>;
  /** The full token is in the result once, never again. */
  create(token: string, name: string): Promise<ApiToken & { token: string }>;
  revoke(token: string, id: string): Promise<void>;
}

export interface GoogleStatus { configured: boolean; manual: boolean; connected: boolean; email: string; error: string; eventsAt: number }
/** An event read from the user's Google calendars. Timed: start/end ms. All-day: date/endDate (end exclusive). */
export interface ExtEvent { id: string; cal: string; calName: string; color: string; title: string; start?: number; end?: number; date?: string; endDate?: string; link?: string; location?: string }
export interface GoogleApi {
  status(token: string): Promise<GoogleStatus>;
  /** Start connecting. `manual`: Google returns to a dead loopback page, and the user pastes its address. */
  authUrl(token: string, tz: string): Promise<{ url: string; manual: boolean }>;
  finish(token: string, code: string, state: string): Promise<GoogleStatus>;
  disconnect(token: string): Promise<void>;
  events(token: string): Promise<{ events: ExtEvent[]; eventsAt: number }>;
}

export interface PushApi {
  /** The server's VAPID public key (base64url), or '' when push is not set up. */
  key(token: string): Promise<string>;
  /** Store or refresh this device's subscription. `tz` is the device's IANA zone. */
  subscribe(token: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, tz: string, weekStart?: number): Promise<void>;
  unsubscribe(token: string, endpoint: string): Promise<void>;
}
