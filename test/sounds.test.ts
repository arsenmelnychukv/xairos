import { describe, expect, it } from 'vitest';
import { PLANS, TICK, soundOn } from '../src/ui/sounds';

describe('sounds', () => {
  it('the focus end bell is on unless it is explicitly turned off', () => {
    expect(soundOn(undefined, 'focusEnd')).toBe(true);
    expect(soundOn({}, 'focusEnd')).toBe(true);
    expect(soundOn({ focusEnd: true }, 'focusEnd')).toBe(true);
    expect(soundOn({ focusEnd: false }, 'focusEnd')).toBe(false);
  });
  it('the two-tone and the tick are off unless turned on', () => {
    for (const n of ['breakEnd', 'taskDone'] as const) {
      expect(soundOn(undefined, n)).toBe(false);
      expect(soundOn({}, n)).toBe(false);
      expect(soundOn({ [n]: false }, n)).toBe(false);
      expect(soundOn({ [n]: true }, n)).toBe(true);
    }
  });
  it('turning one on leaves the others at their defaults', () => {
    expect(soundOn({ breakEnd: true }, 'taskDone')).toBe(false);
    expect(soundOn({ breakEnd: true }, 'focusEnd')).toBe(true);
  });
  it('bell is 880 + 1320 Hz sine with a 1.4 s decay', () => {
    expect(PLANS.focusEnd.map(n => [n.type, n.hz, n.dur])).toEqual([['sine', 880, 1.4], ['sine', 1320, 1.4]]);
  });
  it('two-tone is 660 then 990 Hz triangle', () => {
    const [a, b] = PLANS.breakEnd;
    expect([a!.type, a!.hz, b!.type, b!.hz]).toEqual(['triangle', 660, 'triangle', 990]);
    expect(b!.at).toBeGreaterThan(a!.at);
  });
  it('tick is a 30 ms click', () => { expect(TICK.ms).toBe(30); });
});
