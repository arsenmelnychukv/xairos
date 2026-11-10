#!/usr/bin/env bash
# Build a release and put it live on the server over SSH:
#
#   scripts/deploy.sh root@xairos.example.com
#   scripts/deploy.sh myserver           # an SSH alias; a non-root user needs sudo
#
# The first time, run deploy/install.sh on the server instead (docs/deploy.md).
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:?usage: scripts/deploy.sh user@host}"
out="$(scripts/release.sh | tail -n1)"
tarball="${out%% *}"
name="$(basename "$tarball")"
scp -q "$tarball" "$target:/tmp/$name"
# shellcheck disable=SC2029  # $name is meant to expand here
ssh "$target" "S=; [ \"\$(id -u)\" = 0 ] || S=sudo; \$S /opt/xairos/current/deploy/update.sh /tmp/$name && rm -f /tmp/$name"
