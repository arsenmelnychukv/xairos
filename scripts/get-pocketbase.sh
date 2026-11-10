#!/usr/bin/env bash
# Download the pinned PocketBase release into bin/ (or PB_DEST), verified against the
# release checksums. PB_ARCH picks another platform (e.g. linux_arm64 for a release).
set -euo pipefail
VERSION="${PB_VERSION:-0.40.6}"
ARCH="${PB_ARCH:-linux_amd64}"
cd "$(dirname "$0")/.."
DEST="${PB_DEST:-bin}"
mkdir -p "$DEST"
if [[ -x "$DEST/pocketbase" ]] && "$DEST/pocketbase" --version 2>/dev/null | grep -q "$VERSION"; then
  echo "pocketbase $VERSION already in $DEST/"; exit 0
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
base="https://github.com/pocketbase/pocketbase/releases/download/v$VERSION"
zip="pocketbase_${VERSION}_${ARCH}.zip"
curl -fsSL -o "$tmp/$zip" "$base/$zip"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
(cd "$tmp" && grep " $zip\$" checksums.txt | sha256sum -c -)
python -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extract('pocketbase', sys.argv[2])" "$tmp/$zip" "$DEST"
chmod +x "$DEST/pocketbase"
"$DEST/pocketbase" --version 2>/dev/null || echo "pocketbase $VERSION ($ARCH) in $DEST/"
