/**
 * Focus timer rules, pure: Pomodoro lengths, short and long breaks,
 * and a timer that survives reloads because it runs on timestamps.
 */
export interface FocusSettings {
  /** Minutes. */
  focus: number; short: number; long: number;
  /** A long break after every this many focus sessions. */
  longEvery: number;
  /** Start the break (and the next focus after it) without a tap. */
  autoStart: boolean;
}
export const DEFAULT_FOCUS: FocusSettings = { focus: 25, short: 5, long: 15, longEvery: 4, autoStart: false };

export type Phase = 'focus' | 'short' | 'long';

/**
 * Timer state. Running: `endAt` (Pomo) or `swFrom` (stopwatch) is set.
 * Paused or idle: `left` (Pomo seconds) and `swAcc` (stopwatch seconds) hold it.
 */
export interface Timer {
  mode: 'pomo' | 'sw';
  phase: Phase;
  endAt: number | null;
  left: number;
  swFrom: number | null;
  swAcc: number;
  /** When the current focus session first started (for the record). */
  startedAt: number | null;
  /** Focus sessions finished since the last long break. */
  cycle: number;
  task: string;
  taskId: string | null;
}

export const phaseSecs = (p: Phase, s: FocusSettings) => 60 * (p === 'focus' ? s.focus : p === 'short' ? s.short : s.long);

export const idleTimer = (s: FocusSettings, keep?: Partial<Timer>): Timer => ({
  mode: 'pomo', phase: 'focus', endAt: null, left: phaseSecs('focus', s), swFrom: null, swAcc: 0, startedAt: null, cycle: 0, task: '', taskId: null, ...keep,
});

export const running = (t: Timer) => (t.mode === 'pomo' ? t.endAt !== null : t.swFrom !== null);

/** Seconds left (Pomo) or elapsed (stopwatch) at `now`. */
export function clockSecs(t: Timer, now = Date.now()): number {
  if (t.mode === 'sw') return t.swAcc + (t.swFrom !== null ? (now - t.swFrom) / 1000 : 0);
  return t.endAt !== null ? Math.max(0, (t.endAt - now) / 1000) : t.left;
}

export function start(t: Timer, now = Date.now()): Timer {
  if (running(t)) return t;
  if (t.mode === 'sw') return { ...t, swFrom: now, startedAt: t.startedAt ?? now };
  return { ...t, endAt: now + t.left * 1000, startedAt: t.phase === 'focus' ? t.startedAt ?? now : t.startedAt };
}

export function pause(t: Timer, now = Date.now()): Timer {
  if (t.mode === 'sw') return { ...t, swAcc: clockSecs(t, now), swFrom: null };
  return { ...t, left: clockSecs(t, now), endAt: null };
}

/** Minutes of focus done so far in this session. */
export function focusedMins(t: Timer, s: FocusSettings, now = Date.now()): number {
  if (t.mode === 'sw') return Math.round(clockSecs(t, now) / 60);
  if (t.phase !== 'focus') return 0;
  return Math.round((phaseSecs('focus', s) - clockSecs(t, now)) / 60);
}

/**
 * What follows a finished (or skipped) phase. After focus: a short break, or
 * a long one every `longEvery` sessions. After a break: focus.
 */
export function nextPhase(t: Timer, s: FocusSettings, finishedFocus: boolean): Timer {
  if (t.phase === 'focus') {
    const cycle = finishedFocus ? t.cycle + 1 : t.cycle;
    const phase: Phase = finishedFocus && cycle >= s.longEvery ? 'long' : 'short';
    return { ...t, phase, cycle: phase === 'long' ? 0 : cycle, endAt: null, left: phaseSecs(phase, s), startedAt: null };
  }
  return { ...t, phase: 'focus', endAt: null, left: phaseSecs('focus', s), startedAt: null };
}
