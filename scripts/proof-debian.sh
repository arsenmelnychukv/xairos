#!/usr/bin/env bash
# End-to-end proof of a release on Debian's own packages, without touching the host:
# runs in a throwaway debian:12 Docker container (no systemd, so the services are started
# by hand with the same commands and settings as the units).
#
#   docker run --rm -v /tmp/xairos-<ver>.tar.gz:/rel.tgz:ro -v "$PWD/scripts/proof-debian.sh:/proof.sh:ro" debian:12 bash /proof.sh
#
# Checks: packages and versions, Caddyfile validation, PocketBase start with the release's
# hooks and migrations, the app and API through Caddy over HTTPS (internal CA), realtime
# streaming, the CA download, sign-up closing after the first account, sync, API tokens
# and quick add, the worker starting on Node 18, and a real restic backup and restore.
set -euo pipefail
ok() { printf '  ok  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; for f in /tmp/*.log; do echo "--- $f"; tail -n 20 "$f"; done >&2; exit 1; }
HOST=localhost

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq caddy restic sqlite3 nodejs curl ca-certificates jq >/dev/null
echo "  node $(node --version), $(caddy version | cut -d' ' -f1), $(restic version | cut -d' ' -f2), sqlite $(sqlite3 --version | cut -d' ' -f1)"

echo "== release"
mkdir -p /opt/xairos/releases /opt/xairos/ca /var/lib/xairos/pb_data /var/lib/xairos/notifier /etc/xairos
tar -xzf /rel.tgz -C /tmp
src="$(find /tmp -maxdepth 1 -name 'xairos-*' -type d)"; ver="$(cat "$src/VERSION")"
cp -a "$src" "/opt/xairos/releases/$ver"; ln -sfn "releases/$ver" /opt/xairos/current
R=/opt/xairos/current
sed -e "s|^XAIROS_HOST=.*|XAIROS_HOST=$HOST|" -e "s|^XAIROS_PUBLIC_URL=.*|XAIROS_PUBLIC_URL=https://$HOST|" -e "s|^TZ=.*|TZ=Europe/Berlin|" \
  "$R/deploy/xairos.env.example" > /etc/xairos/xairos.env
node "$R/scripts/vapid.mjs" /etc/xairos/xairos.env mailto:proof@example.com >/dev/null
head -c 32 /dev/urandom | base64 > /etc/xairos/restic-password
set -a; . /etc/xairos/xairos.env; set +a
ok "release $ver unpacked; settings made with vapid.mjs on Node $(node --version)"

echo "== PocketBase"
"$R/bin/pocketbase" serve --http 127.0.0.1:8090 --dir /var/lib/xairos/pb_data \
  --hooksDir "$R/server/pb_hooks" --migrationsDir "$R/server/pb_migrations" --hooksWatch=false > /tmp/pb.log 2>&1 &
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:8090/api/health && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:8090/api/health || fail "PocketBase did not start"
ok "PocketBase answers with the release's hooks and migrations"

echo "== Caddy"
printf 'import /opt/xairos/current/deploy/Caddyfile\n' > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /tmp/caddy-validate.log 2>&1 || fail "caddy validate"
ok "the Caddyfile is valid for Caddy $(caddy version | cut -d' ' -f1)"
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile > /tmp/caddy.log 2>&1 &
CA=/root/.local/share/caddy/pki/authorities/local/root.crt
for _ in $(seq 1 30); do [[ -f "$CA" ]] && curl -fsS -o /dev/null --cacert "$CA" "https://$HOST/" && break; sleep 1; done
cp "$CA" /opt/xairos/ca/xairos-ca.crt; chmod 644 /opt/xairos/ca/xairos-ca.crt
C=(curl -fsS --cacert "$CA")
"${C[@]}" "https://$HOST/" | grep -q '<div id="app"\|<script' || fail "the app shell is not served"
"${C[@]}" -o /dev/null "https://$HOST/sw.js" || fail "no service worker"
"${C[@]}" -o /dev/null "https://$HOST/calendar/deep/link" || fail "the SPA fallback does not serve index.html"
[[ "$("${C[@]}" -I "https://$HOST/sw.js" | tr -d '\r' | grep -i '^cache-control:')" == *no-cache* ]] || fail "sw.js must not be cached"
asset="$("${C[@]}" "https://$HOST/" | grep -o '/assets/[^"]*\.js' | head -n1)"
"${C[@]}" -I "https://$HOST$asset" | tr -d '\r' | grep -qi '^cache-control:.*immutable' || fail "assets are not cached as immutable"
"${C[@]}" -o /dev/null "https://$HOST/api/health" || fail "the API is not proxied"
[[ "$(curl -s -o /dev/null -w '%{http_code}' --cacert "$CA" "https://$HOST/_/")" == 404 ]] || fail "the admin UI must not be public"
"${C[@]}" -I "https://$HOST/" | tr -d '\r' | grep -qi '^strict-transport-security' || fail "no HSTS"
curl -fsS "http://$HOST/xairos-ca.crt" | openssl x509 -noout -subject | grep -q 'Caddy Local Authority' || fail "the CA certificate is not served over HTTP"
[[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/x")" == "301 https://$HOST/x" ]] || fail "HTTP does not redirect to HTTPS"
ok "app, assets, SPA fallback, cache headers, API proxy, hidden admin UI, HSTS, CA download, HTTPS redirect"
first="$(timeout 3 curl -sN --cacert "$CA" "https://$HOST/api/realtime" | head -c 200 || true)"
[[ "$first" == *PB_CONNECT* ]] || fail "realtime events are buffered by the proxy: '$first'"
ok "realtime events stream through Caddy unbuffered"

echo "== API through Caddy"
api() { "${C[@]}" -H 'content-type: application/json' "$@"; }
pw="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
s="$(api -X POST "https://$HOST/api/xairos/signup" -d "{\"name\":\"Proof\",\"email\":\"proof@xairos.test\",\"password\":\"$pw\"}")"
tok="$(jq -r .token <<<"$s")"; uid="$(jq -r .user.id <<<"$s")"
[[ -n "$tok" && "$tok" != null ]] || fail "sign-up failed: $s"
code="$(curl -s -o /dev/null -w '%{http_code}' --cacert "$CA" -H 'content-type: application/json' -X POST "https://$HOST/api/xairos/signup" -d "{\"name\":\"X\",\"email\":\"x@xairos.test\",\"password\":\"$pw\"}")"
[[ "$code" =~ ^4 ]] || fail "a second sign-up was allowed ($code)"
api -X POST "https://$HOST/api/xairos/login" -d "{\"email\":\"proof@xairos.test\",\"password\":\"$pw\"}" | jq -e .token >/dev/null || fail "login"
ok "sign-up, closed sign-up for a second account, login"
pull="$(api -H "Authorization: $tok" "https://$HOST/api/xairos/sync?checkpoint=0")"
jq -e 'has("tasks") and has("checkpoint")' <<<"$pull" >/dev/null || fail "first pull: $(head -c 300 <<<"$pull")"
key="$(api -X POST -H "Authorization: $tok" "https://$HOST/api/xairos/tokens" -d '{"name":"iPhone"}' | jq -r .token)"
[[ "$key" == kai_* ]] || fail "API token"
q="$(api -X POST -H "Authorization: Bearer $key" "https://$HOST/api/xairos/quick-add" -d '{"text":"Proof task tomorrow 9am"}')"
pull2="$(api -H "Authorization: $tok" "https://$HOST/api/xairos/sync?checkpoint=0")"
jq -e '[.tasks[] | select(.title == "Proof task")] | length == 1' <<<"$pull2" >/dev/null || fail "quick add did not create the task: $q"
ok "sync pull, API token, quick add parsed and synced ($(jq -c '[.tasks[] | select(.title=="Proof task")][0] | {title, start: (.start // .due // .date)}' <<<"$pull2"))"
api -H "Authorization: $tok" "https://$HOST/api/xairos/push/key" | jq -e '.key // .publicKey // . | tostring | length > 20' >/dev/null || fail "push key"
ok "push key served"

echo "== worker (Node $(node --version))"
node "$R/dist-server/notifier.mjs" > /tmp/worker.log 2>&1 &
wpid=$!; sleep 6
kill -0 "$wpid" 2>/dev/null || fail "the worker exited"
grep -q 'polling' /tmp/worker.log || fail "the worker did not start polling"
grep -qiE 'error|unauthor|forbidden' /tmp/worker.log && fail "the worker logged an error"
ok "the worker runs and polls PocketBase without errors"

echo "== backup and restore (restic $(restic version | cut -d' ' -f2))"
export XAIROS_RESTIC_REPOS=/tmp/repo-a RESTIC_PASSWORD_FILE=/etc/xairos/restic-password
"$R/deploy/backup.sh" > /tmp/backup.log 2>&1 || fail "backup.sh"
restic -r /tmp/repo-a snapshots --host xairos --tag xairos --json | jq -e 'length == 1' >/dev/null || fail "no snapshot"
restic -r /tmp/repo-a restore latest --target /tmp/restored >/dev/null
db="$(find /tmp/restored -path '*/pb_data/data.db')"
[[ "$(sqlite3 "$db" 'PRAGMA integrity_check')" == ok ]] || fail "restored database is damaged"
[[ "$(sqlite3 "$db" "select count(*) from entities where data like '%Proof task%'")" -ge 1 ]] || fail "the restored database lacks the task"
mkdir -p /tmp/laptop && restic -r /tmp/laptop init --from-repo /tmp/repo-a --from-password-file "$RESTIC_PASSWORD_FILE" --copy-chunker-params >/dev/null 2>&1 \
  && restic -r /tmp/laptop copy --from-repo /tmp/repo-a --from-password-file "$RESTIC_PASSWORD_FILE" >/dev/null 2>&1 || fail "restic copy (the laptop pull)"
ok "real restic backup, snapshot, restore with the task inside, and the laptop's copy"

echo "all Debian 12 checks passed"
