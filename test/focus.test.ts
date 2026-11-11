import { describe, expect, it } from 'vitest';
import { CHIME_WINDOW_MS, fmtMins, shouldChime } from '../src/focus';

describe('fmtMins', () => {
  it('formats minutes, hours and both with no stray space', () => {
    expect(fmtMins(0)).toBe('0m');
    expect(fmtMins(45)).toBe('45m');
    expect(fmtMins(60)).toBe('1h');
    expect(fmtMins(90)).toBe('1h 30m');
    expect(fmtMins(125)).toBe('2h 5m');
  });
});

describe('shouldChime', () => {
  const now = 1_000_000_000;
  it('chimes for a phase that just ended', () => {
    expect(shouldChime(now - 500, now)).toBe(true);
    expect(shouldChime(now - CHIME_WINDOW_MS, now)).toBe(true);
  });
  it('stays quiet for a phase that ended while the tab slept', () => {
    expect(shouldChime(now - CHIME_WINDOW_MS - 1, now)).toBe(false);
    expect(shouldChime(now - 3 * 3600_000, now)).toBe(false);
  });
  it('stays quiet without an end time', () => { expect(shouldChime(null, now)).toBe(false); });
});
