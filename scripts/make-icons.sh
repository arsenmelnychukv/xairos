#!/usr/bin/env bash
# Render the PWA icons in public/icons/ from assets/*.svg (needs rsvg-convert, from librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/icons
mkdir -p "$out"
rsvg-convert -w 192 -h 192 assets/icon.svg -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 assets/icon.svg -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 assets/icon-maskable.svg -o "$out/maskable-512.png"
# iOS rounds the corners itself and shows transparency as black: use the full-bleed art.
rsvg-convert -w 180 -h 180 assets/icon-maskable.svg -o "$out/apple-touch-icon.png"
cp assets/icon.svg "$out/icon.svg"
# Favicon: a separate 16px drawing, not the scaled-down icon.
cp assets/favicon.svg "$out/favicon.svg"
# Android notification badge: one colour on transparent, as a PNG.
rsvg-convert -w 96 -h 96 assets/badge.svg -o "$out/badge-96.png"
