#!/usr/bin/env bash
# Nightly backup: a consistent copy of the database, encrypted with restic to
# every repository in XAIROS_RESTIC_REPOS, kept for 30 days. Run by xairos-backup.timer as
# the xairos user; run it by hand with: sudo systemctl start xairos-backup
#
# The laptop pulls the local repository (deploy/laptop/); the off-site one is pushed here.
# One failing repository does not stop the others; the run fails if any failed.
set -euo pipefail

: "${RESTIC_PASSWORD_FILE:?set in /etc/xairos/xairos.env}"
REPOS="${XAIROS_RESTIC_REPOS:-/var/lib/xairos/restic}"
VAR="${XAIROS_VAR:-/var/lib/xairos}"
STAGE="$VAR/backup-staging"
export RESTIC_PASSWORD_FILE

# 1. A consistent snapshot of the live database (SQLite's online backup), then a check.
rm -rf "$STAGE"; mkdir -p "$STAGE/pb_data"
sqlite3 "$VAR/pb_data/data.db" ".backup '$STAGE/pb_data/data.db'"
[[ "$(sqlite3 "$STAGE/pb_data/data.db" 'PRAGMA integrity_check')" == ok ]] || { echo "backup: the database copy failed its integrity check" >&2; exit 1; }
[[ -d "$VAR/pb_data/storage" ]] && cp -a "$VAR/pb_data/storage" "$STAGE/pb_data/"
[[ -f "$VAR/notifier/state.json" ]] && mkdir -p "$STAGE/notifier" && cp "$VAR/notifier/state.json" "$STAGE/notifier/"
# The settings (secrets included: the repository is encrypted) make a restore complete.
[[ -r /etc/xairos/xairos.env ]] && mkdir -p "$STAGE/etc" && cp /etc/xairos/xairos.env "$STAGE/etc/"

failed=0
for repo in $REPOS; do
  echo "== $repo"
  if ! restic -r "$repo" cat config >/dev/null 2>&1; then
    restic -r "$repo" init || { echo "backup: cannot open or create $repo" >&2; failed=1; continue; }
  fi
  # --host keeps snapshots together even if the container is renamed.
  if restic -r "$repo" backup --host xairos --tag xairos "$STAGE" \
    && restic -r "$repo" forget --host xairos --tag xairos --keep-daily 30 --prune; then
    # Sundays: read back a sample of the data, so a broken repository is noticed early.
    [[ "$(date +%u)" == 7 ]] && { restic -r "$repo" check --read-data-subset=10% || failed=1; }
  else
    failed=1
  fi
done
rm -rf "$STAGE"
exit "$failed"
