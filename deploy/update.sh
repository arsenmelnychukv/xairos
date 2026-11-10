#!/usr/bin/env bash
# Install a xairos release and switch to it, keeping the previous ones for rollback.
# Run as root on the container (scripts/deploy.sh does this for you from the laptop):
#
#   sudo /opt/xairos/current/deploy/update.sh /tmp/xairos-<version>.tar.gz
#   sudo /opt/xairos/current/deploy/update.sh --rollback
#
# Before switching it takes a backup to the local repository. After switching it waits
# for PocketBase to answer; if it does not, it switches back and restarts the old one.
# Note: PocketBase applies new database migrations on start, and a rollback does not undo
# them. Restore the pre-update backup if an old release cannot read the new schema.
set -euo pipefail

ROOT="${XAIROS_ROOT:-}"
DRY="${XAIROS_DRY:-0}"
run() { if [[ "$DRY" == 1 ]]; then echo "+ $*"; else "$@"; fi; }
die() { echo "update.sh: $*" >&2; exit 1; }
[[ "$DRY" == 1 || $EUID -eq 0 ]] || die "run as root"

OPT="$ROOT/opt/xairos"
REL="$OPT/releases"
mkdir -p "$REL"

health() {
  [[ "$DRY" == 1 ]] && return 0
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:8090/api/health && return 0
    sleep 1
  done
  return 1
}
# Releases in the order they went live, newest last (folder times come from the tarball,
# so they cannot tell which is newer).
HIST="$OPT/history"
switch_to() {  # atomic: a new symlink renamed over the old one
  ln -sfn "releases/$1" "$OPT/current.new"
  mv -T "$OPT/current.new" "$OPT/current"
  { grep -vx "$1" "$HIST" 2>/dev/null || true; echo "$1"; } > "$HIST.new" && mv "$HIST.new" "$HIST"
}
restart() {
  run systemctl restart xairos-pb.service
  health || return 1
  run systemctl restart xairos-worker.service
  run systemctl reload caddy || run systemctl restart caddy
}

if [[ "${1:-}" == "--rollback" ]]; then
  cur="$(basename "$(readlink "$OPT/current")")"
  prev="$(tac "$HIST" 2>/dev/null | grep -vx "$cur" | while read -r v; do [[ -d "$REL/$v" ]] && { echo "$v"; break; }; done || true)"
  [[ -n "$prev" ]] || die "no earlier release to go back to"
  echo "rolling back: $cur -> $prev"
  switch_to "$prev"; restart || die "the previous release does not start either; see journalctl -u xairos-pb"
  echo "now on $prev"; exit 0
fi

src="${1:-}"
[[ -n "$src" ]] || die "usage: update.sh <release.tar.gz | unpacked release dir> | --rollback"
tmp=""
if [[ -f "$src" ]]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  tar -xzf "$src" -C "$tmp"
  src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n1)"
fi
[[ -f "$src/VERSION" && -x "$src/bin/pocketbase" && -f "$src/dist/index.html" ]] || die "$src is not a xairos release"
ver="$(cat "$src/VERSION")"
[[ "$ver" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad VERSION: $ver"

if [[ "$(cd "$src" && pwd)" != "$(cd "$REL" && pwd)/$ver" ]]; then
  rm -rf "$REL/$ver.new"
  cp -a "$src" "$REL/$ver.new"
  rm -rf "$REL/$ver"
  mv "$REL/$ver.new" "$REL/$ver"
fi
run chown -R root:root "$REL/$ver"
chmod -R a+rX,go-w "$REL/$ver"

prev=""
[[ -L "$OPT/current" ]] && prev="$(basename "$(readlink "$OPT/current")")"
if [[ -n "$prev" && "${XAIROS_SKIP_BACKUP:-0}" != 1 ]]; then
  echo "backup before update"
  run systemctl start xairos-backup.service || echo "warning: the pre-update backup failed (journalctl -u xairos-backup); continuing"
fi

switch_to "$ver"
echo "switched to $ver"
if [[ -n "$prev" && "$prev" != "$ver" ]] && ! restart; then
  echo "xairos $ver did not start: going back to $prev" >&2
  switch_to "$prev"; restart || true
  die "update failed; see journalctl -u xairos-pb"
fi

# Keep the current release and the two before it.
keep="$(tac "$HIST" | head -n 3)"
for d in "$REL"/*; do
  v="$(basename "$d")"
  grep -qx -- "$v" <<<"$keep" || rm -rf "${REL:?}/$v"
done
echo "xairos $ver is live"
