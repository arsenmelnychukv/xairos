/** Brand tokens keep their contrast (WCAG 2.2: text 4.5:1, marks 3:1). Reads src/ui/tokens.css. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
function block(selector: string): Record<string, string> {
  const i = css.indexOf('\n' + selector + '{');
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(i + selector.length + 2, css.indexOf('\n}', i));
  return Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}
const rgb = (v: string): number[] => {
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  if (h) { const n = parseInt(h[1]!, 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const m = /^(\d+),\s*(\d+),\s*(\d+)$/.exec(v);
  if (!m) throw new Error('not a colour: ' + v);
  return [+m[1]!, +m[2]!, +m[3]!];
};
const lum = (c: number[]) => {
  const [r, g, b] = c.map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return .2126 * r! + .7152 * g! + .0722 * b!;
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + .05) / (y! + .05); };

const light = block(':root');
describe.each([
  ['Light (chart paper)', light],
  ['Dark (abyss teal)', { ...light, ...block(':root[data-mode="dark"]') }],
])('%s', (_n, t) => {
  const ground = rgb(t.ground!);
  it('text, accent and red read against the ground', () => {
    for (const k of ['text', 'text-2', 'text-3', 'accent', 'danger-c', 'prio-high', 'prio-low', 'success', 'info'])
      expect(contrast(rgb(t[k]!), ground), k).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t['prio-med']!), ground), 'prio-med').toBeGreaterThanOrEqual(3);
  });
  it('text reads on surfaces and on the accent fill', () => {
    for (const s of ['surface', 'raised']) expect(contrast(rgb(t.text!), rgb(t[s]!)), s).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t['on-accent']!), rgb(t.accent!))).toBeGreaterThanOrEqual(4.5);
  });
  it('legacy aliases match the named tokens', () => {
    expect(rgb(t.primary!)).toEqual(rgb(t.accent!));
    expect(rgb(t.bg!)).toEqual(rgb(t.ground!));
    expect(rgb(t.danger!)).toEqual(rgb(t['danger-c']!));
  });
});
