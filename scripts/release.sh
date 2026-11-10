#!/usr/bin/env bash
# Build a release tarball for the server: release/xairos-<version>.tar.gz
# It holds everything the container runs: the built app (dist/), the worker
# (dist-server/), the PocketBase hooks and migrations, PocketBase itself for the target
# platform (PB_ARCH, default linux_amd64) and the deploy scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${PB_ARCH:-linux_amd64}"
ver="$(git describe --tags --always --dirty 2>/dev/null || date +%Y%m%d%H%M)"
[[ "$ver" == *-dirty ]] && echo "note: uncommitted changes are included ($ver)"

npm run build >/dev/null
npm run build:notifier >/dev/null

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
stage="$work/xairos-$ver"
mkdir -p "$stage/server" "$stage/scripts"
cp -r dist dist-server deploy "$stage/"
cp -r server/pb_hooks server/pb_migrations "$stage/server/"
cp scripts/vapid.mjs "$stage/scripts/"
PB_ARCH="$ARCH" PB_DEST="$stage/bin" scripts/get-pocketbase.sh >/dev/null
echo "$ver" > "$stage/VERSION"
mkdir -p release
tar -czf "release/xairos-$ver.tar.gz" -C "$work" "xairos-$ver"
echo "release/xairos-$ver.tar.gz ($(du -h "release/xairos-$ver.tar.gz" | cut -f1))"
