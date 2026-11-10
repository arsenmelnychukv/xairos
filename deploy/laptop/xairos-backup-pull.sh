#!/usr/bin/env bash
# Laptop side of the backups: copy new snapshots from the container's local
# restic repository into one on this laptop. The laptop is not always on, so it pulls
# when it can instead of the server pushing at night. Run by the user timer in this folder.
#
# Needs: restic; SSH access to the server; the backup password in
# ~/.config/xairos/restic-password (the same one as the server's).
set -euo pipefail
FROM="${XAIROS_BACKUP_FROM:-sftp:root@xairos:/var/lib/xairos/restic}"
TO="${XAIROS_BACKUP_TO:-$HOME/Backups/xairos-restic}"
PW="${XAIROS_BACKUP_PASSWORD_FILE:-$HOME/.config/xairos/restic-password}"
[[ -r "$PW" ]] || { echo "xairos-backup-pull: put the backup password in $PW" >&2; exit 1; }
export RESTIC_PASSWORD_FILE="$PW" RESTIC_FROM_PASSWORD_FILE="$PW"
mkdir -p "$(dirname "$TO")"
# Same chunker parameters as the source, so copies stay small.
restic -r "$TO" cat config >/dev/null 2>&1 || restic -r "$TO" init --from-repo "$FROM" --copy-chunker-params
restic -r "$TO" copy --from-repo "$FROM" --host xairos --tag xairos
restic -r "$TO" forget --host xairos --tag xairos --keep-daily 30 --prune
