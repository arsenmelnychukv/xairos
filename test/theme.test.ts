/** Brand tokens keep their contrast (WCAG 2.2: text 4.5:1, marks 3:1). Reads src/ui/tokens.css. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  it('kept legacy danger alias matches the named token', () => {
    expect(rgb(t.danger!)).toEqual(rgb(t['danger-c']!));
  });
});

// Ticket brand-kit-finish#01: these aliases are gone from both theme blocks.
const REMOVED_ALIASES = ['primary', 'grey', 'bg', 'pop', 't1', 't2', 't3', 't4'];
describe.each([
  ['Light block (:root)', ':root'],
  ['Dark block (:root[data-mode="dark"])', ':root[data-mode="dark"]'],
])('%s', (_n, selector) => {
  it('defines no removed legacy alias', () => {
    const b = block(selector);
    for (const k of REMOVED_ALIASES) expect(b[k], '--' + k).toBeUndefined();
  });
});

// Every source file under src/ must use the named tokens, not the removed aliases.
function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    return e.isDirectory() ? sourceFiles(u) : [u];
  });
}
describe('no source file reads a removed legacy alias', () => {
  const files = sourceFiles(new URL('../src/', import.meta.url));
  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it('contains no var(--primary|grey|bg|pop|t1..t4)', () => {
    const bad = /var\(\s*--(primary|grey|bg|pop|t[1-4])(?![\w-])/;
    const hits = files.flatMap(f => {
      const lines = readFileSync(f, 'utf8').split('\n');
      return lines.flatMap((l, i) => (bad.test(l) ? [`${fileURLToPath(f)}:${i + 1}: ${l.trim()}`] : []));
    });
    expect(hits).toEqual([]);
  });
});

// Ticket brand-kit-finish#02: no raw colour outside tokens.css. The drift hook skips some lines
// (rgba(0,0,0,..., var(--..., emptyArt, safeColor) and never reads index.html, so this scans them too.
const RAW_COLOUR = [/#[0-9A-Fa-f]{3,8}(?![\w-])/, /rgba?\(\s*(\d|var\()/, /hsla?\(/, /color-mix\(in oklch/];
describe('no raw colour outside tokens.css', () => {
  const scope = [
    ...sourceFiles(new URL('../src/', import.meta.url)).filter(f => {
      const p = fileURLToPath(f);
      return /\/src\/style\.css$/.test(p) || /\/src\/(views|ui)\/[^/]+\.ts$/.test(p);
    }),
    new URL('../index.html', import.meta.url),
  ];
  // The one raw colour that stays: a meta attribute cannot read a CSS variable.
  const isThemeMeta = (l: string) => /<meta name="theme-color" content="#[0-9A-Fa-f]{6}">/.test(l);
  const hitsWhere = (keep: (l: string) => boolean) => scope.flatMap(f => {
    const lines = readFileSync(f, 'utf8').split('\n');
    return lines.flatMap((l, i) =>
      RAW_COLOUR.some(re => re.test(l)) && keep(l) ? [`${fileURLToPath(f)}:${i + 1}: ${l.trim()}`] : []);
  });
  it('finds files to scan', () => {
    expect(scope.length).toBeGreaterThan(2);
  });
  it('flags no raw colour except the theme-color meta', () => {
    expect(hitsWhere(l => !isThemeMeta(l))).toEqual([]);
  });
  it('allows exactly one theme-color meta, equal to the dark --ground', () => {
    expect(hitsWhere(isThemeMeta)).toHaveLength(1);
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const meta = /<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/.exec(html);
    expect(meta?.[1]?.toLowerCase()).toBe(block(':root[data-mode="dark"]').ground!.toLowerCase());
  });
  it('defines --scrim in the light root (dark inherits it)', () => {
    expect(block(':root').scrim, '--scrim').toBeDefined();
  });
});

// Ticket brand-kit-finish#03: rows match the approved Gate A board (38px desktop, 46px phone);
// exits use the exit easing and run faster than entrances; reduced motion stops the slide.
const style = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const ruleBodies = (sel: string): string[] =>
  [...style.matchAll(new RegExp('(?<![\\w.-])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'))].map(m => m[1]!);
describe('Gate A board: row height, exit motion and reduced motion', () => {
  it('rows are 38px on desktop and 46px on phone (--row)', () => {
    expect(block(':root').row).toBe('38px');
    expect(/@media \(max-width:760px\)\{:root\{[^}]*--row:46px/.test(css), 'phone --row 46px').toBe(true);
  });
  it('toast closes on --dur-1 and --ease-exit, and opens on --dur-2 and --ease-out', () => {
    const [closing] = ruleBodies('.toast');
    expect(closing, 'toast closing transition').toMatch(/transition:[^;]*var\(--dur-1\) var\(--ease-exit\)/);
    const opening = ruleBodies('.toast.on').find(b => b.includes('transition:'));
    expect(opening, 'toast opening transition').toMatch(/var\(--dur-2\) var\(--ease-out\)/);
  });
  it('phone drawer closes on --dur-1 and --ease-exit, and opens on --dur-2 and --ease-out', () => {
    const phone = ruleBodies('.side').find(b => b.includes('position:fixed'));
    expect(phone, 'phone .side rule').toBeDefined();
    expect(phone!, 'drawer closing transition').toMatch(/transition:transform var\(--dur-1\) var\(--ease-exit\)/);
    const open = ruleBodies('.side.open').find(b => b.includes('transition:transform'));
    expect(open, 'drawer opening transition').toMatch(/transition:transform var\(--dur-2\) var\(--ease-out\)/);
  });
  it('reduced motion holds the toast in place and stops the drawer sliding', () => {
    const toastRm = style.split('\n').find(l => l.includes('.toast,.toast.on{'));
    expect(toastRm, 'toast reduced-motion rule').toBeDefined();
    expect(toastRm!).toMatch(/transform:translateX\(-50%\)/);
    expect(toastRm!).not.toMatch(/translateY/);
    expect(style.split('\n').some(l => l.includes('.side,.side.open{transform:none'))).toBe(true);
  });
  it('Focus summary: only the duration span is mono', () => {
    expect(ruleBodies('.f-sum .mono').length, '.f-sum .mono rule').toBeGreaterThan(0);
  });
  it('phone .content hides its scrollbar and keeps the 16px gutter (phone block only)', () => {
    const phoneContent = ruleBodies('.content').find(b => b.includes('scrollbar-width:none'));
    expect(phoneContent, 'phone .content rule with scrollbar-width:none').toBeDefined();
    expect(phoneContent!).toMatch(/padding:0 16px 40px/);
    const mq = style.indexOf('@media (max-width:760px)');
    const at = style.search(/(?<=\n\s+)\.content\{[^}]*scrollbar-width:none/);
    expect(mq, 'phone media block').toBeGreaterThanOrEqual(0);
    expect(at, 'indented phone .content rule').toBeGreaterThan(mq);
  });
});

// Ticket brand-kit-finish#03, round 2: 44px tap targets live in the phone block only.
// The phone block is found by brace matching, so nested rules (reduced motion) stay inside it.
const PHONE_OPEN = '@media (max-width:760px){';
const phoneSpans = (): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  for (let i = style.indexOf(PHONE_OPEN); i >= 0; i = style.indexOf(PHONE_OPEN, i + 1)) {
    let depth = 1;
    let j = i + PHONE_OPEN.length;
    while (depth > 0 && j < style.length) {
      const c = style[j++];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    spans.push([i, j]);
  }
  return spans;
};
const spans = phoneSpans();
const phoneBlock = spans.map(([s, e]) => style.slice(s + PHONE_OPEN.length, e - 1)).find(b => b.includes('.rail-btn::after')) ?? '';
const outsidePhone = spans.reduce((text, [s, e]) => text.replace(style.slice(s, e), ''), style);
const bodiesIn = (text: string, sel: string): string[] =>
  [...text.matchAll(new RegExp('(?<![\\w.-])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'))].map(m => m[1]!);
describe('Gate A board, round 2: 44px tap targets in the phone block only', () => {
  it('phone block exists and holds the hit-area rules', () => {
    expect(spans.length, 'phone media blocks').toBeGreaterThan(0);
    expect(phoneBlock, 'phone block with .rail-btn::after').not.toBe('');
  });
  it('tab bar, icon buttons, task checkbox and weekday cells get 44px hit areas', () => {
    expect(bodiesIn(phoneBlock, '.rail-btn::after'), '.rail-btn::after').toContainEqual(expect.stringContaining('inset:-3px'));
    expect(bodiesIn(phoneBlock, '.icon-btn'), '.icon-btn box').toContain('width:44px;height:44px');
    expect(bodiesIn(phoneBlock, '.row>.cb::after'), '.row>.cb::after').toContainEqual(expect.stringContaining('inset:-15px -16px -15px -14px'));
    expect(bodiesIn(phoneBlock, '.wd button::after'), '.wd button::after').toContainEqual(expect.stringContaining('inset:-5px'));
    expect(bodiesIn(phoneBlock, '.wd button'), '.wd button drawn 34px').toContain('width:34px;height:34px');
  });
  it('no tap-target hit area rule lives outside the phone block', () => {
    const hitArea = /\.rail-btn::after|\.row>\.cb::after|\.wd button::after|\.icon-btn\{width:44px|\.h-open::after|#c-today::after|\.tg-dh::after|\.side-head button::after|\.d-tt \.cb::after|\.ck \.cb::after|\.topbar \.seg:not|\.auth \.tabs button::after|\.f-btns \.btn::after|\.rem-h \.icon-btn::after|\.kc-menu::after|\.cell \.d::after|\.kcol \.sec-h\{height:44px|\.kc-add,\.kc-new\{min-height:44px/;
    expect(hitArea.test(outsidePhone), 'hit-area rule outside @media (max-width:760px)').toBe(false);
  });
});

// Ticket brand-kit-finish#03, round 3: phone sizes for side heads, detail and subtask rows, popover
// options, the Today button, the week header, the Focus toggle and the sign-in tabs. All sit in the
// phone block that holds the rail rules (the second @media block; the sign-in rules are there too).
describe('Gate A board, round 3: 44px phone targets and drawn rules', () => {
  it('side heads, detail checkbox, property and subtask rows reach 44px', () => {
    expect(bodiesIn(phoneBlock, '.side-head'), '.side-head box').toContainEqual(expect.stringContaining('height:44px'));
    expect(bodiesIn(phoneBlock, '.side-head button::after'), '#add-list hit area').toContainEqual(expect.stringContaining('inset:-11px'));
    expect(bodiesIn(phoneBlock, '.d-tt .cb::after'), '.d-tt .cb::after').toContainEqual(expect.stringContaining('inset:-9px -13px -21px -17px'));
    expect(bodiesIn(phoneBlock, '.prop'), '.prop box').toContain('min-height:44px');
    expect(bodiesIn(phoneBlock, '.ck'), '.ck box').toContain('min-height:44px');
  });
  it('Today button, week header and Focus mode toggle get 44px hit areas', () => {
    expect(bodiesIn(phoneBlock, '#c-today::after'), '#c-today::after').toContainEqual(expect.stringContaining('inset:-9px 0'));
    expect(bodiesIn(phoneBlock, '.tg-dh::after'), '.tg-dh::after').toContainEqual(expect.stringContaining('width:max(100%,44px)'));
    expect(bodiesIn(phoneBlock, '.topbar .seg:not(.cal-seg) button::after'), 'Focus toggle hit area').toContainEqual(expect.stringContaining('inset:-10px 0'));
  });
  it('popover options, sign-in tabs and the sign-in track are phone rules', () => {
    expect(bodiesIn(phoneBlock, '.pop .opt'), '.pop .opt').toContain('min-height:44px');
    expect(bodiesIn(phoneBlock, '.auth .tabs button::after'), 'sign-in tab hit area').toContainEqual(expect.stringContaining('inset:-5px 0'));
    expect(bodiesIn(phoneBlock, '.auth'), '.auth track').toContain('grid-template-columns:minmax(0,1fr)');
  });
  it('kanban column header is 44px and the add and new-column buttons have a 44px min-height (phone block)', () => {
    expect(bodiesIn(phoneBlock, '.kcol .sec-h'), '.kcol .sec-h').toContainEqual(expect.stringContaining('height:44px'));
    expect(bodiesIn(phoneBlock, '.kc-add,.kc-new'), '.kc-add,.kc-new').toContainEqual(expect.stringContaining('min-height:44px'));
  });
});

// Ticket brand-kit-finish#03, round 3: contrast. Each rule is read from style.css and each token from
// tokens.css, so a change to either one shows here. Ratios use the WCAG formula already above.
const darkTokens = { ...light, ...block(':root[data-mode="dark"]') };
const declOf = (sel: string, prop: string): string => {
  const body = new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(style)?.[1] ?? '';
  const value = new RegExp('(?:^|;)' + prop + ':([^;]+)').exec(body)?.[1];
  if (value === undefined) throw new Error(`no ${prop} in ${sel}`);
  return value.trim();
};
// Colours are 0 to 255 per channel. color-mix(in oklab) is computed in OKLab, as the browser does;
// a translucent layer is composited over its backdrop in sRGB.
type Paint = { rgb: number[]; a: number };
const linear = (c: number) => { const x = c / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
const toOklab = (c: number[]): number[] => {
  const [r, g, b] = c.map(linear) as [number, number, number];
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [
    .2104542553 * l + .7936177850 * m - .0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .8086757660 * s,
  ];
};
const fromOklab = (v: number[]): number[] => {
  const [L, A, B] = v as [number, number, number];
  const l = (L + .3963377774 * A + .2158037573 * B) ** 3;
  const m = (L - .1055613458 * A - .0638541728 * B) ** 3;
  const s = (L - .0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s,
  ].map(x => {
    const y = Math.min(1, Math.max(0, x));
    return 255 * (y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055);
  });
};
// color-mix(in oklab, x p%, y). A transparent y leaves x's colour and scales its alpha.
const mix = (x: Paint, p: number, y: Paint): Paint => {
  if (y.a === 0) return { rgb: x.rgb, a: p * x.a };
  const [X, Y] = [toOklab(x.rgb), toOklab(y.rgb)] as [number[], number[]];
  return { rgb: fromOklab(X.map((v, i) => p * v + (1 - p) * Y[i]!)), a: p * x.a + (1 - p) * y.a };
};
const paint = (v: string, t: Record<string, string>): Paint => {
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) {
    const val = t[ref[1]!];
    if (val === undefined) throw new Error('no token --' + ref[1]);
    return paint(val, t);
  }
  if (v === 'transparent') return { rgb: [0, 0, 0], a: 0 };
  const cm = /^color-mix\(in oklab,(.+?) (\d+)%,(.+)\)$/.exec(v);
  if (cm) return mix(paint(cm[1]!, t), +cm[2]! / 100, paint(cm[3]!, t));
  return { rgb: rgb(v), a: 1 };
};
const over = (top: Paint, bottom: number[]): number[] => top.rgb.map((c, i) => c * top.a + bottom[i]! * (1 - top.a));

describe('Gate A board, round 3: danger text, toast and selected-nav rules', () => {
  it('--danger-text is a text-only mix of --danger-c and --text', () => {
    expect(block(':root')['danger-text']).toBe('color-mix(in oklab,var(--danger-c) 75%,var(--text))');
  });
  it('popover danger item and popover error text use --danger-text', () => {
    expect(declOf('.pop .mi.danger', 'color')).toBe('var(--danger-text)');
    expect(declOf('.pop .err', 'color')).toBe('var(--danger-text)');
  });
  it('toast Undo: light mix is 70% accent, dark rule is its own 50% mix', () => {
    expect(declOf('.toast button', 'color')).toBe('color-mix(in oklab,var(--accent) 70%,var(--ground))');
    expect(declOf(':root[data-mode="dark"] .toast button', 'color')).toBe('color-mix(in oklab,var(--accent) 50%,var(--ground))');
  });
  it('selected nav count uses --text-2', () => {
    expect(declOf('.nav-item.on .cnt', 'color')).toBe('var(--text-2)');
  });
});

const modes: Array<[string, Record<string, string>]> = [['light', light], ['dark', darkTokens]];
describe.each(modes)('Gate A board, round 3: WCAG ratios at least 4.5:1 (%s)', (mode, t) => {
  const undoSel = mode === 'dark' ? ':root[data-mode="dark"] .toast button' : '.toast button';
  const backdrop = paint(declOf('.side', 'background'), t).rgb;
  const navTint = over(paint(declOf('.nav-item.on', 'background'), t), backdrop);
  const pairs: Array<[string, number[], number[]]> = [
    ['toast Undo on the toast', paint(declOf(undoSel, 'color'), t).rgb, paint(declOf('.toast', 'background'), t).rgb],
    ['--danger-text on --raised', paint('var(--danger-text)', t).rgb, paint('var(--raised)', t).rgb],
    ['--text-2 on the selected nav tint', paint('var(--text-2)', t).rgb, navTint],
    ['calendar day digit on the selected nav tint', paint(declOf('.nav-item.on .ico text', 'fill'), t).rgb, navTint],
  ];
  for (const [name, fg, bg] of pairs) {
    it(`${name}: ${contrast(fg, bg).toFixed(2)}`, () => {
      expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// Ticket brand-kit-finish#04: the approved option C drawing (emptyArt) sits above the wordmark on the
// sign-in screen, decorative and hidden from assistive tech. The 72px icon mark is gone.
describe('sign-in art (brand-kit-finish#04)', () => {
  const auth = readFileSync(new URL('../src/views/auth.ts', import.meta.url), 'utf8');
  it('auth.ts imports emptyArt from ../ui/icons', () => {
    expect(auth).toMatch(/import \{[^}]*\bemptyArt\b[^}]*\} from '\.\.\/ui\/icons';/);
  });
  it('the .brand block holds the decorative art before the first wordmark', () => {
    const brandOpen = auth.indexOf('<div class="brand">');
    expect(brandOpen, '.brand block').toBeGreaterThanOrEqual(0);
    const artAt = auth.indexOf('<div class="art" aria-hidden="true">${emptyArt}</div>', brandOpen);
    const wmAt = auth.indexOf('class="wm', brandOpen);
    expect(artAt, 'art markup inside .brand').toBeGreaterThanOrEqual(0);
    expect(artAt, 'art before the first wordmark').toBeLessThan(wmAt);
  });
  it('auth.ts has no icon mark image', () => {
    expect(auth).not.toContain('class="mark"');
  });
  it('the demo-mode hint still reads demoUser()', () => {
    expect(auth).toContain('demoUser()');
  });
  it('.brand .art svg is 120x96 and .brand .mark has no rule', () => {
    expect(ruleBodies('.brand .art svg'), '.brand .art svg rule').toContainEqual(expect.stringMatching(/width:120px.*height:96px/));
    expect(ruleBodies('.brand .mark'), '.brand .mark rule').toEqual([]);
  });
});

// Ticket brand-kit-finish#07: reminder cards collapse while the detail pane is open, on phone only,
// so the detail footer (Tags, Delete) is reachable. The cards stay in the DOM and return on close.
describe('reminder cards hide while the detail pane is open (brand-kit-finish#07)', () => {
  const sel = 'body:has(#detail:not(.hidden)) .rem-stack';
  it('the phone block hides .rem-stack while #detail is open', () => {
    expect(bodiesIn(phoneBlock, sel), sel).toContainEqual(expect.stringContaining('display:none'));
  });
  it('the rule does not sit outside the phone block', () => {
    expect(outsidePhone, 'rule outside @media (max-width:760px)').not.toContain('#detail:not(.hidden)) .rem-stack');
  });
});
