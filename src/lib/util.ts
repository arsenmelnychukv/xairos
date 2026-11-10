/** Query one element. Typed as present; callers use `?.` where it may be missing. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Build one element from an HTML string. */
export const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild as HTMLElement;
};

export const randHex = (n: number): string =>
  [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
export const uid = (): string => randHex(8);
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const lsGet = <T = any>(k: string): T | null => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
};
export const lsSet = (k: string, v: unknown): void => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage failed', e); }
};
export const lsDel = (k: string): void => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
export const ssGet = <T = any>(k: string): T | null => {
  try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const apiErr = (status: number, msg: string) => new ApiError(status, msg);

export const isTyping = (el: Element | null = document.activeElement): boolean =>
  !!el && /INPUT|TEXTAREA|SELECT/.test(el.tagName);
