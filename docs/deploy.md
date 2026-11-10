# Self-hosting xairos

xairos runs on one always-on Debian or Ubuntu machine: a small VPS, a VM, a container on a home server, or a spare mini PC. One install script sets up everything:

```
phone / laptop ──HTTPS──▶ your server
                            ├─ Caddy :443   serves the app, proxies /api
                            │        :80    redirects to HTTPS (and hands out the CA certificate in own-CA mode)
                            ├─ xairos-pb       PocketBase on 127.0.0.1:8090 (data: /var/lib/xairos/pb_data)
                            ├─ xairos-worker   reminder pushes, Google Calendar sync
                            └─ xairos-backup   nightly restic → local repo (+ off-site)
```

| Where | What |
|---|---|
| `/opt/xairos/current` → `releases/<version>` | The running release (the three latest are kept) |
| `/opt/xairos/ca/xairos-ca.crt` | Own-CA mode only: Caddy's CA certificate, served at `http://<host>/xairos-ca.crt` |
| `/var/lib/xairos/` | Data: `pb_data/`, `notifier/`, `restic/` (local backups). Only the `xairos` user can enter it |
| `/etc/xairos/xairos.env` | Settings and secrets (mode 0640 root:xairos) |
| `/etc/xairos/restic-password` | Backup password. **Keep a copy in your password manager** |

## 1. The server

Debian 12 or 13, or a current Ubuntu LTS. 1 CPU, 512 MB RAM and 4 GB disk is plenty. The distribution's own packages are enough (Node.js 18+, Caddy 2.6+, restic, sqlite3).

You need root (or a sudo user) on it and SSH access from the machine you build on.

**In an LXC container** (Proxmox, Incus/LXD): turn on nesting (Proxmox: *Options → Features → nesting*). The services use systemd sandboxing, which needs it. If you run a VPN client inside the container, it also needs the TUN device; on Proxmox add these two lines to `/etc/pve/lxc/<id>.conf` and restart the container:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Incus/LXD: `incus config device add <name> tun unix-char path=/dev/net/tun`.

## 2. Choose how devices reach it

xairos needs HTTPS (service worker, push, install to Home Screen). Pick one:

| Mode | When | `install.sh` flag |
|---|---|---|
| **Private network, own CA** (default) | Reachable only over a VPN (WireGuard, Tailscale, NetBird, ZeroTier…) or your LAN. Caddy issues certificates from its own CA; each device trusts it once. | `--tls internal` |
| **Public domain, Let's Encrypt** | A public DNS name pointing at the server, with ports 80 and 443 open to the internet. No device setup. | `--tls public` |

`--host` is the name your devices use: the VPN's DNS name for the server, a LAN name, or your domain. Make sure TCP 80 and 443 from your devices to the server are allowed (VPN access policy, firewall).

## 3. Build a release (your machine)

```bash
scripts/release.sh                       # → release/xairos-<version>.tar.gz
scp release/xairos-*.tar.gz root@<server>:/tmp/
```

`PB_ARCH=linux_arm64 scripts/release.sh` for an ARM server.

## 4. Install (server)

```bash
cd /tmp && tar -xzf xairos-*.tar.gz && cd xairos-*/
./deploy/install.sh --host xairos.example.com --email you@example.com --tz Europe/Berlin            # own CA
./deploy/install.sh --host xairos.example.com --email you@example.com --tz Europe/Berlin --tls public  # Let's Encrypt
```

It installs Caddy, restic, Node.js and SQLite from the distribution, creates the `xairos` user, writes `/etc/xairos/xairos.env` with fresh Web Push keys and secrets, sets up the services and the nightly backup, and (own-CA mode) publishes Caddy's CA certificate.

With a sudo user instead of root, prefix it with `sudo`.

**It prints a new backup password once. Store it in your password manager now.** Without it, no backup can be restored. Running `install.sh` again is safe: it keeps keys, password and settings.

## 5. Trust the certificate (own-CA mode only), then sign up

Each device must trust Caddy's CA once. Skip this with `--tls public`.

- **iPhone / iPad:** in Safari open `http://<host>/xairos-ca.crt` → *Allow* → *Settings → Profile Downloaded → Install*. Then *Settings → General → About → Certificate Trust Settings* → switch on full trust for "Caddy Local Authority".
- **Android:** download `http://<host>/xairos-ca.crt`, then *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*.
- **Linux:** `curl -O http://<host>/xairos-ca.crt`, then `sudo trust anchor --store xairos-ca.crt` (Arch, Fedora) or copy it to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates` (Debian, Ubuntu). Chromium-based browsers use the system store. Firefox needs *Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import*.
- **macOS:** open the file, add it to the System keychain, and set it to *Always Trust*. **Windows:** open the file → *Install Certificate* → *Local Machine* → *Trusted Root Certification Authorities*.

Open `https://<host>` and **create your account**. Sign-up closes after the first account (more people: start PocketBase once with `XAIROS_OPEN_SIGNUP=1`). On a phone: *Share → Add to Home Screen*, open it from there, then turn on *Account → Background reminders*.

## 6. Backups

Every night at about 03:30 the server copies the database (SQLite's online backup, integrity-checked) and pushes it, encrypted, to each repository in `XAIROS_RESTIC_REPOS`. Snapshots are kept for 30 days, and every Sunday it reads back a sample to catch damage early.

**Off-site** (any restic backend; two examples):

```bash
# SFTP: give the xairos user an SSH key the remote accepts
sudo -u xairos mkdir -p -m 700 /var/lib/xairos/.ssh
sudo -u xairos ssh-keygen -t ed25519 -N '' -f /var/lib/xairos/.ssh/id_ed25519
sudo -u xairos ssh backup@backup.example.com   # accept the host key once
# then in /etc/xairos/xairos.env:
XAIROS_RESTIC_REPOS="/var/lib/xairos/restic sftp:backup@backup.example.com:xairos"

# or Backblaze B2: XAIROS_RESTIC_REPOS="/var/lib/xairos/restic b2:my-bucket:xairos"
#                  B2_ACCOUNT_ID=…  B2_ACCOUNT_KEY=…
```

Run one now and read the result: `systemctl start xairos-backup && journalctl -u xairos-backup -n 30`.

**Copy to a laptop:** a laptop is not always on, so it pulls every few hours instead (systemd user timer).

```bash
# install restic with your package manager first
install -Dm755 deploy/laptop/xairos-backup-pull.sh ~/.local/bin/xairos-backup-pull
install -Dm600 /dev/stdin ~/.config/xairos/restic-password   # paste the backup password, then Ctrl-D
cp deploy/laptop/xairos-backup-pull.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now xairos-backup-pull.timer
```

It reads `sftp:root@xairos:/var/lib/xairos/restic` by default (needs SSH to the server as root, with `xairos` as a host name or SSH alias). Set `XAIROS_BACKUP_FROM` / `XAIROS_BACKUP_TO` in the service to change that.

**Restore** (server): `/opt/xairos/current/deploy/restore.sh --list`, then `restore.sh` (latest) or `restore.sh --repo <repo> --snapshot <id>`. The current data is moved aside, not deleted. Practise this once.

## 7. Updates

```bash
scripts/deploy.sh root@xairos.example.com
```

This builds a release and copies it over. The server takes a backup, switches to the new release, and checks that PocketBase answers. If it doesn't, it switches back. To go back by hand: `/opt/xairos/current/deploy/update.sh --rollback`. A rollback does not undo database migrations; restore the pre-update backup if an older release cannot read the data.

`scripts/test-deploy.sh` dry-runs release, install, update, rollback and backup against a temporary folder. Run it after changing anything in `deploy/`.

## 8. Optional features

- **Google Calendar:** README "Google Calendar". Put the client ID and secret in `/etc/xairos/xairos.env`, then `systemctl restart xairos-pb xairos-worker`.
- **Apple Shortcuts:** README "Apple Shortcuts quick add". `TZ` in `xairos.env` is the zone used when a Shortcut sends no date.

## Operations

| Task | Command |
|---|---|
| Logs | `journalctl -u xairos-pb -f`, `-u xairos-worker`, `-u xairos-backup`, `-u caddy` |
| Status | `systemctl status xairos-pb xairos-worker caddy; systemctl list-timers xairos-backup.timer` |
| PocketBase admin UI | `ssh -L 8090:127.0.0.1:8090 root@<host>`, then http://localhost:8090/_/ (create an admin with `sudo -u xairos /opt/xairos/current/bin/pocketbase superuser upsert <email> <password> --dir /var/lib/xairos/pb_data`) |
| Change settings | edit `/etc/xairos/xairos.env`, then `systemctl restart xairos-pb xairos-worker` |
| Switch TLS mode | set `XAIROS_TLS` in `xairos.env` (`internal`, or your email for Let's Encrypt), then rerun `install.sh` |

## Troubleshooting

- **`status=226/NAMESPACE`** when a service starts: the container lacks nesting. Turn it on (step 1), or delete the four hardening lines in the unit.
- **The phone says the connection is not private** (own CA): the CA is installed but not trusted. Do the trust step for your platform.
- **Let's Encrypt fails** (`journalctl -u caddy`): the DNS name must point at the server, and ports 80 and 443 must be open from the internet.
- **Nothing loads on the phone:** the phone cannot reach the server. Check the VPN is on (if you use one) and that the host name resolves.
- **The page times out, but `ssh` works:** a firewall or VPN access policy allows only SSH. It must also allow TCP 80 and 443 from your devices. Check with `timeout 5 bash -c '</dev/tcp/<host>/443' && echo open`.
- **Reminders arrive only with the app open:** check `journalctl -u xairos-worker`. Push needs the Home Screen app on iPhone (iOS 16.4+) and *Background reminders* on.
- **The CA certificate is missing at `/xairos-ca.crt`** (own CA): run `install.sh` again after Caddy has started once.
