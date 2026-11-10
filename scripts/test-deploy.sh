#!/usr/bin/env bash
# Dry run of the deploy kit against a temporary root (no root rights, nothing installed):
# release → install → install again (keeps secrets) → update → rollback → backup.
# apt, useradd, chown and systemctl are only printed. restic is a stand-in that records
# its calls, so the backup's flow and its database copy are checked, not restic itself.
set -euo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export XAIROS_ROOT="$T/root" XAIROS_DRY=1
ok() { printf '  ok  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }

echo "== release"
tarball="$(scripts/release.sh | tail -n1 | cut -d' ' -f1)"
tar -xzf "$tarball" -C "$T"
rel="$(find "$T" -mindepth 1 -maxdepth 1 -name 'xairos-*' -type d)"
for f in VERSION bin/pocketbase dist/index.html dist/sw.js dist-server/notifier.mjs server/pb_hooks/xairos.pb.js server/pb_hooks/xairos_parse.js server/pb_migrations deploy/install.sh scripts/vapid.mjs; do
  [[ -e "$rel/$f" ]] || fail "release lacks $f"
done
ok "release has app, worker, hooks, migrations, PocketBase and scripts"

echo "== install"
"$rel/deploy/install.sh" --host xairos.test.example.com --email ops@example.com --tz Europe/Berlin > "$T/install1.log" 2>&1 || { cat "$T/install1.log"; fail "install failed"; }
env="$XAIROS_ROOT/etc/xairos/xairos.env"
grep -q '^XAIROS_HOST=xairos.test.example.com$' "$env" || fail "host not set"
grep -q '^XAIROS_PUBLIC_URL=https://xairos.test.example.com$' "$env" || fail "public URL not set"
grep -q '^TZ=Europe/Berlin$' "$env" || fail "time zone not set"
for k in XAIROS_VAPID_PUBLIC XAIROS_VAPID_PRIVATE XAIROS_NOTIFIER_SECRET; do grep -q "^$k=." "$env" || fail "$k missing"; done
grep -q '^XAIROS_VAPID_SUBJECT=mailto:ops@example.com$' "$env" || fail "VAPID subject"
[[ "$(stat -c %a "$env")" == 640 ]] || fail "env file mode"
[[ -s "$XAIROS_ROOT/etc/xairos/restic-password" ]] || fail "no backup password"
grep -q 'IMPORTANT: a new backup password' "$T/install1.log" || fail "no password warning"
grep -qx 'XAIROS_HOST=xairos.test.example.com' "$XAIROS_ROOT/etc/xairos/caddy.env" || fail "caddy.env"
grep -qx 'XAIROS_TLS=internal' "$XAIROS_ROOT/etc/xairos/caddy.env" || fail "default TLS mode is not internal"
pub="$T/root-public"
XAIROS_ROOT="$pub" "$rel/deploy/install.sh" --host xairos.example.com --email ops@example.com --tls public > "$T/install-public.log" 2>&1 || { cat "$T/install-public.log"; fail "public install failed"; }
grep -qx 'XAIROS_TLS=ops@example.com' "$pub/etc/xairos/caddy.env" || fail "public TLS mode not set"
grep -q 'nothing to publish' "$T/install-public.log" || fail "public install tried to publish a CA"
"$rel/deploy/install.sh" --host x.example.com --email ops@example.com --tls bogus >/dev/null 2>&1 && fail "install accepted a bad --tls"
[[ -d "$XAIROS_ROOT/opt/xairos/ca" && "$(stat -c %a "$XAIROS_ROOT/opt/xairos/ca")" == 755 ]] || fail "CA folder must be readable by Caddy"
grep -q '^import /opt/xairos/current/deploy/Caddyfile' "$XAIROS_ROOT/etc/caddy/Caddyfile" || fail "Caddyfile import"
for u in xairos-pb.service xairos-worker.service xairos-backup.service xairos-backup.timer caddy.service.d/xairos.conf; do
  [[ -f "$XAIROS_ROOT/etc/systemd/system/$u" ]] || fail "unit $u"
done
ver="$(cat "$rel/VERSION")"
[[ "$(readlink "$XAIROS_ROOT/opt/xairos/current")" == "releases/$ver" ]] || fail "current symlink"
grep -q '+ systemctl enable --now xairos-pb.service xairos-worker.service xairos-backup.timer' "$T/install1.log" || fail "services not enabled"
ok "install writes settings, secrets, units, Caddy config and goes live"

pub1="$(grep '^XAIROS_VAPID_PUBLIC=' "$env")" pw1="$(cat "$XAIROS_ROOT/etc/xairos/restic-password")"
echo "XAIROS_GOOGLE_CLIENT_ID=mine" >> "$env"
"$rel/deploy/install.sh" --host other.name --email x@y.z > "$T/install2.log"
[[ "$(grep '^XAIROS_VAPID_PUBLIC=' "$env")" == "$pub1" ]] || fail "second install changed the VAPID keys"
[[ "$(cat "$XAIROS_ROOT/etc/xairos/restic-password")" == "$pw1" ]] || fail "second install changed the backup password"
grep -q '^XAIROS_GOOGLE_CLIENT_ID=mine$' "$env" || fail "second install lost a setting"
grep -q '^XAIROS_HOST=xairos.test.example.com$' "$env" || fail "second install changed the host"
grep -q 'IMPORTANT' "$T/install2.log" && fail "second install warned about a new password"
ok "a second install keeps keys, password and settings"

echo "== update and rollback"
for n in 2 3 4; do
  cp -a "$rel" "$T/xairos-v$n"; echo "v$n" > "$T/xairos-v$n/VERSION"
  tar -czf "$T/xairos-v$n.tar.gz" -C "$T" "xairos-v$n"
  "$rel/deploy/update.sh" "$T/xairos-v$n.tar.gz" > "$T/update$n.log"
done
[[ "$(readlink "$XAIROS_ROOT/opt/xairos/current")" == releases/v4 ]] || fail "update did not switch"
grep -q '+ systemctl start xairos-backup.service' "$T/update4.log" || fail "no backup before update"
[[ "$(ls "$XAIROS_ROOT/opt/xairos/releases" | wc -l)" == 3 ]] || fail "old releases not pruned: $(ls "$XAIROS_ROOT/opt/xairos/releases")"
ok "updates switch atomically, back up first, keep three releases"
"$rel/deploy/update.sh" --rollback > "$T/rollback.log"
[[ "$(readlink "$XAIROS_ROOT/opt/xairos/current")" == releases/v3 ]] || fail "rollback went to $(readlink "$XAIROS_ROOT/opt/xairos/current")"
ok "rollback returns to the previous release"
"$rel/deploy/update.sh" "$T/not-there.tar.gz" 2>/dev/null && fail "update accepted a missing file"
ok "update refuses something that is not a release"

echo "== backup"
var="$T/var"; mkdir -p "$var/pb_data" "$var/notifier"
"$rel/bin/pocketbase" migrate up --dir "$var/pb_data" --migrationsDir "$rel/server/pb_migrations" >/dev/null
echo '{"fired":{}}' > "$var/notifier/state.json"
mkdir -p "$T/bin"
cat > "$T/bin/restic" <<'SHIM'
#!/usr/bin/env bash
echo "restic $*" >> "$RESTIC_LOG"
case " $* " in
  *" cat config "*) [[ -f "$RESTIC_STATE/$2.init" ]] ;;
  *" init"*) touch "$RESTIC_STATE/$2.init" ;;
  *" backup "*) src="${*: -1}"; [[ -f "$src/pb_data/data.db" ]] && cp "$src/pb_data/data.db" "$RESTIC_STATE/last.db" ;;
  *) exit 0 ;;
esac
SHIM
chmod +x "$T/bin/restic"
mkdir -p "$T/restic-state"
PATH="$T/bin:$PATH" RESTIC_LOG="$T/restic.log" RESTIC_STATE="$T/restic-state" XAIROS_VAR="$var" \
  RESTIC_PASSWORD_FILE="$XAIROS_ROOT/etc/xairos/restic-password" XAIROS_RESTIC_REPOS="local offsite" \
  "$rel/deploy/backup.sh" > "$T/backup.log"
[[ "$(grep -c ' init' "$T/restic.log")" == 2 ]] || fail "repositories not created"
grep -q 'restic -r offsite forget --host xairos --tag xairos --keep-daily 30 --prune' "$T/restic.log" || fail "no 30-day retention"
[[ "$(sqlite3 "$T/restic-state/last.db" "select count(*) from _collections where name='entities'")" == 1 ]] || fail "backed-up database is not a xairos database"
[[ ! -e "$var/backup-staging" ]] || fail "staging left behind"
ok "backup copies a consistent database to every repository, keeps 30 days, cleans up"

echo "all deploy checks passed"
