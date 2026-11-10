#!/usr/bin/env bash
# First-time setup of xairos on a Debian/Ubuntu server, VM or container. Run as root from an
# unpacked release (see docs/deploy.md). Safe to run again: it keeps existing secrets,
# data and settings, and only fills in what is missing.
#
#   sudo ./deploy/install.sh --host xairos.example.com --email you@example.com --tz Europe/Berlin [--tls public]
#
# --tls internal (default): Caddy's own CA, for a private network (VPN or LAN).
# --tls public: a Let's Encrypt certificate; needs public DNS and ports 80/443 open.
#
# Testing: XAIROS_ROOT=/tmp/k XAIROS_DRY=1 writes every file under /tmp/k and only prints
# the commands that change the system (apt, useradd, chown, systemctl).
set -euo pipefail

ROOT="${XAIROS_ROOT:-}"
DRY="${XAIROS_DRY:-0}"
run() { if [[ "$DRY" == 1 ]]; then echo "+ $*"; else "$@"; fi; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { echo "install.sh: $*" >&2; exit 1; }

HOST="" EMAIL="" TZONE="" TLS="internal"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --tz) TZONE="$2"; shift 2 ;;
    --tls) TLS="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ -n "$HOST" ]] || die "--host is required (the name devices use to reach this server)"
[[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "--host must be a host name"
[[ -n "$EMAIL" ]] || die "--email is required (Web Push needs a contact address)"
[[ "$TLS" == internal || "$TLS" == public ]] || die "--tls must be internal or public"
[[ "$DRY" == 1 || $EUID -eq 0 ]] || die "run as root"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$SRC/VERSION" && -x "$SRC/bin/pocketbase" ]] || die "run this from an unpacked release (missing VERSION or bin/pocketbase)"
ETC="$ROOT/etc/xairos" VAR="$ROOT/var/lib/xairos"
TZONE="${TZONE:-$(cat "$ROOT/etc/timezone" 2>/dev/null || echo UTC)}"

say "1/6 Packages"
if [[ "$DRY" != 1 ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq caddy restic sqlite3 nodejs curl ca-certificates >/dev/null
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || die "Node.js 18 or newer is needed (found $(node --version))"
else echo "+ apt-get install caddy restic sqlite3 nodejs curl ca-certificates"; fi

say "2/6 User and folders"
id xairos >/dev/null 2>&1 || run useradd --system --home-dir /var/lib/xairos --shell /usr/sbin/nologin xairos
mkdir -p "$ETC" "$VAR/pb_data" "$VAR/notifier" "$VAR/restic" "$VAR/backup-staging" "$ROOT/opt/xairos/releases" "$ROOT/opt/xairos/ca"
run chown -R xairos:xairos "$VAR"
run chmod 750 "$VAR"
# Caddy serves the CA certificate from here (public, so outside the private data folder).
chmod 755 "$ROOT/opt/xairos/ca"
run chown root:xairos "$ETC"
chmod 750 "$ETC"

say "3/6 Settings and secrets ($ETC)"
ENV="$ETC/xairos.env"
if [[ ! -f "$ENV" ]]; then
  sed -e "s|^XAIROS_HOST=.*|XAIROS_HOST=$HOST|" -e "s|^XAIROS_PUBLIC_URL=.*|XAIROS_PUBLIC_URL=https://$HOST|" -e "s|^TZ=.*|TZ=$TZONE|" \
    "$SRC/deploy/xairos.env.example" > "$ENV"
  echo "made $ENV"
else echo "kept $ENV"; fi
# Adds only the keys that are missing (VAPID keys, worker secret).
node "$SRC/scripts/vapid.mjs" "$ENV" "mailto:$EMAIL"
run chown root:xairos "$ENV"
chmod 640 "$ENV"
# Caddy's TLS mode: "internal" (own CA) or the ACME contact email (Let's Encrypt).
grep -q '^XAIROS_TLS=' "$ENV" || { [[ "$TLS" == public ]] && echo "XAIROS_TLS=$EMAIL" || echo "XAIROS_TLS=internal"; } >> "$ENV"
printf 'XAIROS_HOST=%s\nXAIROS_TLS=%s\n' "$(sed -n 's/^XAIROS_HOST=//p' "$ENV")" "$(sed -n 's/^XAIROS_TLS=//p' "$ENV")" > "$ETC/caddy.env"
chmod 644 "$ETC/caddy.env"
PW="$ETC/restic-password"
NEW_PW=0
if [[ ! -f "$PW" ]]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40 > "$PW"; NEW_PW=1
fi
run chown root:xairos "$PW"
chmod 640 "$PW"

say "4/6 Services"
mkdir -p "$ROOT/etc/systemd/system/caddy.service.d" "$ROOT/etc/caddy"
cp "$SRC"/deploy/systemd/xairos-*.service "$SRC"/deploy/systemd/xairos-*.timer "$ROOT/etc/systemd/system/"
printf '[Service]\nEnvironmentFile=/etc/xairos/caddy.env\n' > "$ROOT/etc/systemd/system/caddy.service.d/xairos.conf"
CADDYFILE="$ROOT/etc/caddy/Caddyfile"
if [[ -f "$CADDYFILE" ]] && ! grep -q '^import /opt/xairos/current/deploy/Caddyfile' "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.before-xairos"; echo "saved the old Caddyfile as $CADDYFILE.before-xairos"
fi
printf '# xairos (managed by /opt/xairos/current/deploy/install.sh)\nimport /opt/xairos/current/deploy/Caddyfile\n' > "$CADDYFILE"

say "5/6 Release $(cat "$SRC/VERSION")"
XAIROS_ROOT="$ROOT" XAIROS_DRY="$DRY" XAIROS_SKIP_BACKUP=1 "$SRC/deploy/update.sh" "$SRC"
run systemctl daemon-reload
run systemctl enable --now xairos-pb.service xairos-worker.service xairos-backup.timer
run systemctl restart caddy

say "6/6 Certificate authority"
if grep -q '^XAIROS_TLS=internal$' "$ENV"; then
CA_SRC="$ROOT/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
for _ in $(seq 1 20); do [[ -f "$CA_SRC" || "$DRY" == 1 ]] && break; sleep 0.5; done
if [[ -f "$CA_SRC" ]]; then cp "$CA_SRC" "$ROOT/opt/xairos/ca/xairos-ca.crt"; chmod 644 "$ROOT/opt/xairos/ca/xairos-ca.crt"; echo "published at http://$HOST/xairos-ca.crt"
else echo "Caddy has not made its CA yet. Run again in a minute, or copy $CA_SRC by hand."; fi
else echo "public certificate from Let's Encrypt: nothing to publish"; fi

say "Done"
cat <<EOT
xairos: https://$HOST  (the first account you create becomes the only one; sign-up then closes)

Next:
  1. Make sure your devices reach $HOST on ports 80 and 443 (docs/deploy.md, step 2)
  2. Own CA only: on each device, install and trust http://$HOST/xairos-ca.crt (docs/deploy.md, step 5)
  3. Backups run nightly to: $(sed -n 's/^XAIROS_RESTIC_REPOS=//p' "$ENV" | tr -d '"')
     Add your off-site repository there (docs/deploy.md, step 6).
EOT
if [[ $NEW_PW == 1 ]]; then
  cat <<EOT

IMPORTANT: a new backup password was made in $PW.
Copy it into your password manager now. Without it, no backup can be restored.
EOT
fi
