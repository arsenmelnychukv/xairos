/**
 * Sounds (M7, M12): synthesised with Web Audio, all off by default, each with its own setting.
 * They play only after the user has touched the page, so a browser never blocks or surprises.
 */
export type SoundName = 'focusEnd' | 'breakEnd' | 'taskDone';
export type SoundPrefs = Partial<Record<SoundName, boolean>>;

/** One note: oscillator type, Hz, start (s), length (s), peak gain. */
export interface Note { type: OscillatorType; hz: number; at: number; dur: number; gain: number }

/** What each sound is made of. The tick is a noise click, so it has no notes. */
export const PLANS: Record<'focusEnd' | 'breakEnd', Note[]> = {
  // Bell: 880 + 1320 Hz sine, 1.4 s decay.
  focusEnd: [{ type: 'sine', hz: 880, at: 0, dur: 1.4, gain: .14 }, { type: 'sine', hz: 1320, at: 0, dur: 1.4, gain: .07 }],
  // Two-tone: 660 then 990 Hz triangle.
  breakEnd: [{ type: 'triangle', hz: 660, at: 0, dur: .22, gain: .14 }, { type: 'triangle', hz: 990, at: .2, dur: .3, gain: .14 }],
};
/** The tick: 30 ms of noise through a band-pass filter. */
export const TICK = { ms: 30, hz: 2400, q: 1.2, gain: .25 };

/** Is this sound switched on? Off unless the setting is true. */
export const soundOn = (p: SoundPrefs | undefined, name: SoundName) => p?.[name] === true;

let ctx: AudioContext | null = null, unlocked = false;
const GESTURES = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'];

/**
 * iOS keeps an AudioContext suspended unless it is made and resumed inside a user gesture. So the first
 * gesture creates it, resumes it and plays one silent sample; later sounds (from timers) reuse it.
 */
function unlock() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx || new AC();
    const c = ctx;
    void c.resume().then(() => { if (c.state === 'running') done(); }).catch(() => { /* try again on the next gesture */ });
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination); src.start();
    if (c.state === 'running') done();
  } catch { /* no audio */ }
}
function done() {
  unlocked = true;
  for (const ev of GESTURES) window.removeEventListener(ev, unlock, true);
}
if (typeof window !== 'undefined') for (const ev of GESTURES) window.addEventListener(ev, unlock, { capture: true, passive: true });

/** The unlocked context, or null before the user has touched the page. */
function audio(): AudioContext | null {
  if (!unlocked || !ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(c: AudioContext, n: Note) {
  const t0 = c.currentTime + n.at, o = c.createOscillator(), g = c.createGain();
  o.type = n.type; o.frequency.value = n.hz;
  g.gain.setValueAtTime(.0001, t0);
  g.gain.exponentialRampToValueAtTime(n.gain, t0 + .015);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + n.dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + n.dur + .05);
}

function tick(c: AudioContext) {
  const len = Math.max(1, Math.round(c.sampleRate * TICK.ms / 1000)), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = TICK.hz; f.Q.value = TICK.q; g.gain.value = TICK.gain;
  src.connect(f).connect(g).connect(c.destination); src.start();
}

/** Play a sound if its setting is on and the user has interacted with the page. */
export function playSound(name: SoundName, p: SoundPrefs | undefined) {
  if (!soundOn(p, name)) return;
  const c = audio(); if (!c) return;
  try { if (name === 'taskDone') tick(c); else PLANS[name].forEach(n => tone(c, n)); } catch { /* no audio */ }
}
