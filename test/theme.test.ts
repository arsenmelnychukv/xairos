/** Quiet Sails colours keep their contrast (WCAG: text 4.5:1, icons and marks 3:1). Reads src/style.css. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector + '{');
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(i + selector.length + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}
const rgb = (v: string): number[] => {
  const m = /^(?:rgb\()?(\d+),\s*(\d+),\s*(\d+)\)?$/.exec(v) || (v === '#fff' ? [, '255', '255', '255'] : null);
  if (!m) throw new Error('not a colour: ' + v);
  return [+m[1]!, +m[2]!, +m[3]!];
};
const lum = (c: number[]) => {
  const [r, g, b] = c.map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return .2126 * r! + .7152 * g! + .0722 * b!;
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + .05) / (y! + .05); };

describe.each([
  ['Quiet Sails Light', ':root[data-family="sails"]', {}],
  ['Quiet Sails Dark', ':root[data-family="sails"][data-mode="dark"]', block(':root[data-family="sails"]')],
])('%s', (_n, sel, base) => {
  const t = { ...base, ...block(sel) } as Record<string, string>;
  const bg = rgb(t.bg!);
  it('text and accents read against the background', () => {
    for (const k of ['grey', 'primary', 'danger', 'p-high', 'p-low']) expect(contrast(rgb(t[k]!), bg), k).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t['p-med']!), bg), 'p-med').toBeGreaterThanOrEqual(3);
  });
  it('text on a primary fill reads', () => {
    expect(contrast(rgb(t['on-primary']!), rgb(t.primary!))).toBeGreaterThanOrEqual(4.5);
  });
});
