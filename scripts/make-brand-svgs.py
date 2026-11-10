# Run: python3 -I scripts/make-brand-svgs.py node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2 assets   (needs fonttools)
"""Write the xairos wordmark, icon, maskable icon, favicon and notification badge SVGs.

Usage: python3 -I make_brand_svgs.py <onest-variable.woff2> <assets-dir>
"Airos" is outlined from Onest at weight 500 so the wordmark has no font dependency.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path, out = sys.argv[1], sys.argv[2]
f = instantiateVariableFont(TTFont(font_path), {"wght": 500})
gs, cmap = f.getGlyphSet(), f.getBestCmap()
upm = f["head"].unitsPerEm
scale = 100 / upm  # 100-unit em, baseline at y=0, y down

x = 57.0
paths = []
for ch in "airos":
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
    paths.append(pen.getCommands())
    x += gs[g].width * scale - 2  # -2 tracking, as approved
right = x + 2

CHI_A = "M2 -49 C7 -55 14 -53 18 -45 L41 12 C44 20 49 24 56 21"
CHI_B = "M46 -53 L7 19"
VB = f"-10 -82 {right + 16:.1f} 116"
airos = "".join(f'<path d="{p}"/>' for p in paths)


def wordmark(ink, dot, mono=False):
    # The dot's ground-coloured ring is a cut-out (mask), so the file works on any background.
    d = ink if mono else dot
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB}" role="img" aria-label="xairos">
  <defs><mask id="m"><rect x="-10" y="-90" width="400" height="130" fill="#fff"/><circle cx="28.1" cy="-19.6" r="9.2" fill="#000"/></mask></defs>
  <g fill="none" stroke="{ink}" stroke-linecap="round" mask="url(#m)"><path d="{CHI_A}" stroke-width="12.5"/><path d="{CHI_B}" stroke-width="5"/></g>
  <circle cx="28.1" cy="-19.6" r="7.6" fill="{d}"/>
  <g fill="{ink}">{airos}</g>
</svg>
'''


def mark(bg, rx):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="{rx}" fill="{bg}"/>
  <g transform="translate(140 320) scale(4)" fill="none" stroke="#D985B8" stroke-width="9.5" stroke-linecap="round"><path d="{CHI_A}"/><path d="{CHI_B}"/></g>
</svg>
'''


CHI16_A = "M3.4 3.4 C4.2 2.8 5 3.2 5.4 4 L10.2 12.4 C10.6 13.1 11.3 13.3 12.2 13"
CHI16_B = "M11.2 2.8 L4.4 13.4"
files = {
    "wordmark.svg": wordmark("#DCDDBD", "#D985B8"),
    "wordmark-light.svg": wordmark("#23271A", "#A0447E"),
    "wordmark-mono.svg": wordmark("currentColor", "", mono=True),
    "icon.svg": mark("#0C1517", 112),
    "icon-maskable.svg": mark("#0C1517", 0),
    # Simplified drawing for 16px, not a scaled-down icon.
    "favicon.svg": f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3.5" fill="#0C1517"/><g fill="none" stroke="#D985B8" stroke-width="2" stroke-linecap="round"><path d="{CHI16_A}"/><path d="{CHI16_B}"/></g></svg>\n',
    # Android notification badge: one colour, white on transparent.
    "badge.svg": f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"><path d="{CHI16_A}"/><path d="{CHI16_B}"/></g></svg>\n',
}
for name, svg in files.items():
    with open(f"{out}/{name}", "w") as fh:
        fh.write(svg)
    print(name, len(svg))
