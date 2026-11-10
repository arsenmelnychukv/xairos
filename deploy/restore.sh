#!/usr/bin/env bash
# Restore xairos data from a restic backup. Run as root on the container:
#
#   sudo /opt/xairos/current/deploy/restore.sh                 # latest snapshot, first repository
#   sudo /opt/xairos/current/deploy/restore.sh --list          # show snapshots
#   sudo /opt/xairos/current/deploy/restore.sh --repo b2:bucket:xairos --snapshot 4f2a9c1e
#
# The current data is moved aside (pb_data.before-restore-<time>), never deleted.
# Devices keep their local copies: after a restore they push anything newer when they sync.
set -euo pipefail
die() { echo "restore.sh: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"

set -a; . /etc/xairos/xairos.env; set +a
REPO="${XAIROS_RESTIC_REPOS%% *}" SNAP=latest LIST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --snapshot) SNAP="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
export RESTIC_PASSWORD_FILE
r() { runuser -u xairos -- env RESTIC_PASSWORD_FILE="$RESTIC_PASSWORD_FILE" restic -r "$REPO" "$@"; }

if [[ $LIST == 1 ]]; then r snapshots --host xairos --tag xairos; exit 0; fi

VAR=/var/lib/xairos
tmp="$(mktemp -d -p "$VAR")"; chown xairos:xairos "$tmp"; trap 'rm -rf "$tmp"' EXIT
echo "restoring $SNAP from $REPO"
r restore "$SNAP" --host xairos --tag xairos --target "$tmp"
got="$(find "$tmp" -path '*/backup-staging/pb_data/data.db' | head -n1)"
[[ -n "$got" ]] || die "that snapshot has no database"
[[ "$(sqlite3 "$got" 'PRAGMA integrity_check')" == ok ]] || die "the restored database failed its integrity check"
stage="$(dirname "$(dirname "$got")")"

systemctl stop xairos-worker.service xairos-pb.service
aside="$VAR/pb_data.before-restore-$(date +%Y%m%d-%H%M%S)"
mv "$VAR/pb_data" "$aside"
mkdir -p "$VAR/pb_data"
cp -a "$stage/pb_data/." "$VAR/pb_data/"
[[ -f "$stage/notifier/state.json" ]] && cp "$stage/notifier/state.json" "$VAR/notifier/state.json"
chown -R xairos:xairos "$VAR/pb_data" "$VAR/notifier"
systemctl start xairos-pb.service xairos-worker.service
if [[ -f "$stage/etc/xairos.env" ]]; then
  cp "$stage/etc/xairos.env" "$aside/xairos.env.from-backup"; chmod 600 "$aside/xairos.env.from-backup"
  echo "The backup's settings file is in $aside/xairos.env.from-backup (not applied; compare by hand if needed)."
fi
echo "restored. The previous data is in $aside (delete it once all is well)."
