import { describe, expect, it } from 'vitest';
import { PLANS, TICK, soundOn } from '../src/ui/sounds';

describe('sounds', () => {
  it('are off unless a setting is true', () => {
    for (const n of ['focusEnd', 'breakEnd', 'taskDone'] as const) {
      expect(soundOn(undefined, n)).toBe(false);
      expect(soundOn({}, n)).toBe(false);
      expect(soundOn({ [n]: false }, n)).toBe(false);
      expect(soundOn({ [n]: true }, n)).toBe(true);
    }
  });
  it('turning one on leaves the others off', () => {
    expect(soundOn({ focusEnd: true }, 'breakEnd')).toBe(false);
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
