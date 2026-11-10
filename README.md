# xairos

xairos, said KAI-ros (χ as in Bach).

A to-do, calendar, focus and habit app. Vite + TypeScript, no UI framework.

## Run

```bash
npm install
npm run pb:get     # download the pinned PocketBase into bin/ (checksum-verified)
npm run vapid      # once: create server/.env with Web Push keys and the notifier secret
npm run pb         # PocketBase on 127.0.0.1:8090, data in server/pb_data/ (reads server/.env)
npm run notifier   # build and run the reminder notifier (reads server/.env)
npm run dev        # app on http://127.0.0.1:5179, /api proxied to PocketBase
npm test           # unit tests + backend contract tests (starts its own PocketBase)
npm run build      # typecheck + production build into dist/ (with the service worker)
npm run preview    # serve dist/ on http://127.0.0.1:5180, to test install and offline
```

`npm run dev:local` runs the app against the in-browser mock server instead, with no PocketBase needed.

Sign-up is closed: `/api/xairos/signup` only works while there are no accounts, or when PocketBase runs with `XAIROS_OPEN_SIGNUP=1` (handy for testing sharing with a second account).

**Self-hosting** on any Debian or Ubuntu server, VM or container, on a private network or a public domain (Caddy for HTTPS, systemd services, restic backups): [docs/deploy.md](docs/deploy.md). In short: `scripts/release.sh`, `deploy/install.sh` once on the server, then `scripts/deploy.sh root@<host>` for updates.

## Server

PocketBase 0.40.6 with JavaScript hooks. The app never touches PocketBase collections directly; it calls the §3 contract in `ROADMAP.md`:

| Route | Does |
|---|---|
| `POST /api/xairos/signup`, `/login` | Returns `{token, user}`. Passwords use PocketBase's bcrypt. Tokens last 90 days. 10 wrong passwords lock the email for 15 minutes (429). |
| `POST /api/xairos/account/delete` | Body `{password}`. Erases the account: owned lists and their tasks, habits, focus, push, tokens, Google link. Shared lists lose the user. |
| `GET /api/xairos/sync?checkpoint=N` | Pull everything visible with `seq > N` |
| `POST /api/xairos/sync` | Push dirty entities; returns `{checkpoint, id2error}` |
| `GET /api/xairos/users?email=` | Look up a user to share with |
| `POST /api/xairos/lists/:id/leave` | Leave a shared list |
| `GET /api/xairos/push/key` | The VAPID public key, or `''` when push is not set up |
| `POST /api/xairos/push/subscribe`, `/unsubscribe` | Store or drop this browser's push subscription and its time zone |
| `GET /api/xairos/google`, `POST …/google/auth-url`, `GET …/google/callback`, `POST …/google/finish`, `POST …/google/disconnect`, `GET …/google/events` | Google Calendar: status, start sign-in, Google's return, pasted-address fallback, disconnect, events for the app |
| `GET/POST /api/xairos/tokens`, `DELETE …/tokens/:id` | List, create (shown once) and revoke API tokens |
| `POST /api/xairos/quick-add` | Add a task from text with an API token (Apple Shortcuts) |
| `GET /api/xairos/habits` | Your habits as `[{id, name}]` for a Shortcuts picker (API token) |
| `POST /api/xairos/habits/:id/check` | Check in a habit with an API token. Body `{action, today?}`: `done` (up to the goal), `+1` or `undo`; `today` is the phone's `YYYY-MM-DD`. Returns `{id, name, day, count, goal, done, message}` |
| `POST /api/xairos/push/action` | A button on a reminder notification: `{token, action, today}`, where `token` is the signed one in the push (no session), `action` is `complete`, `snooze` (15 min) or `done` (habit) |
| `GET /api/xairos/internal/changes?since=N`, `POST …/internal/push/gone`, `POST …/internal/purge-trash` | Notifier only (`X-xairos-Secret` header): changed lists and tasks plus all subscriptions; drop expired ones; empty old Trash now (a daily cron does it at 04:17) |
| realtime `signals/<userId>` | Bumped on every change that affects the user; the client then pulls (`needSync`) |

- `server/pb_migrations/` creates the collections: `entities` (every list, task, habit and focus record, with the client object in `data`), `revoked`, `counters` (the global `seq`), `signals`, `push_subs`, `google_links` and `api_tokens`. All but `signals` are locked to the hooks.
- `server/pb_hooks/xairos_lib.js` holds the logic and mirrors `src/server/local.ts`. `test/contract.test.ts` runs the same cases against both.
- **Background reminders** come from the notifier, a small Node process next to PocketBase (`server/notifier/`). PocketBase's hook runtime has no ECDH or ECDSA, so it cannot encrypt or sign Web Push itself. Every 30 s the notifier pulls changes from the internal route, works out which reminders are due in each device's time zone, and sends them with `node:crypto` (RFC 8291 encryption, RFC 8292 VAPID; no dependencies). Sent reminders are kept in `server/notifier_data/state.json`, so a restart does not resend them. Pushes only go to the known push services (Google, Mozilla, Apple, Microsoft).
- **Env** (`server/.env`, made by `npm run vapid`, never committed): `XAIROS_VAPID_PUBLIC`, `XAIROS_VAPID_PRIVATE`, `XAIROS_VAPID_SUBJECT` (set it to a real `mailto:`; Apple rejects bad ones), `XAIROS_NOTIFIER_SECRET`. PocketBase needs the public key and the secret; the notifier needs all four. Never regenerate the VAPID keys on a live server: every device would have to turn background reminders on again.
- Brute force: PocketBase rate-limits `/login` (30/min), `/account/delete` (5/min) and `/push/action` (60/min) per client IP, read from Caddy's `X-Forwarded-For` (migration `1794268800`). PocketBase's own `auth-with-password` route is off.
- Trash: tasks in Trash for 30 days are deleted for good (cron in `xairos.pb.js`, rule in `src/lib/trash.ts`).
- Known gap: the token is still kept in localStorage (not an httpOnly cookie).

## Google Calendar

One sign-in covers both directions:

- **To Google:** timed tasks and time blocks you would get reminders for go to a calendar called "xairos" in your Google account. Edits, moves and length changes follow within a minute; completed, deleted and untimed tasks are removed. Floating times use the zone your device had when you connected; pinned ones keep their zone. Repeating tasks show only their next occurrence.
- **From Google:** your other calendars (the ones ticked in Google Calendar) are read every 5 minutes, 30 days back and 180 ahead, and shown read-only in month, week and day views. Click one for details and a link to Google. They are cached on the device, so they show offline too.

How it is split: PocketBase does the sign-in and keeps the tokens (`google_links`). Google's return lands on a callback with no session, so it only passes the code to the app, which finishes the sign-in with its own session; a sign-in someone else started cannot attach your Google account to their xairos account. Then the worker in `server/notifier/google.ts` does the syncing. Each event in the xairos calendar carries its task id, so the worker finds its events again after a restart instead of making copies. Changes made to those events in Google are overwritten.

**Setup** (once, in the [Google Cloud console](https://console.cloud.google.com/)):

1. Create a project, enable the **Google Calendar API**, and configure the OAuth consent screen (External; add yourself as a test user while setting up).
2. Create an **OAuth client ID** of type *Web application*. Authorised redirect URI: `<XAIROS_PUBLIC_URL>/api/xairos/google/callback`.
3. Put the client in `server/.env` (both PocketBase and the worker read it): `XAIROS_GOOGLE_CLIENT_ID`, `XAIROS_GOOGLE_CLIENT_SECRET`, and `XAIROS_PUBLIC_URL` (the address you open xairos at, e.g. `https://xairos.example.com`).
4. Publish the app **In production** without verification. In *Testing*, Google ends the connection every 7 days. You see an "unverified app" warning once when connecting.
5. In xairos: account menu → Google Calendar → Connect.

**If Google refuses the server's address as a redirect URI** (it wants a public domain): register `http://127.0.0.1:1/` instead and set `XAIROS_GOOGLE_REDIRECT=http://127.0.0.1:1/`. After you allow access, Google opens a page that does not load; copy its address into the box xairos shows. The sign-in code works once and only for the account that started it.

Scopes: `calendar.app.created` (make the xairos calendar and manage only its events) and `calendar.readonly` (read your calendars), plus your email address. The refresh token is stored unencrypted in PocketBase's database, which never leaves the server; disconnecting revokes it.

## Apple Shortcuts quick add

Account menu → Apple Shortcuts: make a token, then follow the steps shown to build an **Add to xairos** Shortcut ("Hey Siri, add to xairos"). The Shortcut posts what you said to `POST /api/xairos/quick-add` with `Authorization: Bearer kai_…` and a JSON body `{"text": "Call mum tomorrow 6pm !high #family ^Personal", "date": "YYYY-MM-DD"}`, and shows the reply's `message`.

- The text is parsed exactly like quick add in the app: PocketBase runs the same parser, bundled from `src/parser.ts` (with `advanceRepeat` for notification buttons, entry `src/server/hooks-entry.ts`) into `server/pb_hooks/xairos_parse.js` (generated by `npm run build:hooks`, also part of `npm run build` and the tests; commit it after parser changes).
- `date` is the phone's today, so "tomorrow" is right even if the server's clock is in another zone. Without it the server's date is used (set `TZ` for PocketBase to your zone).
- `^List` adds to one of your lists you can edit; otherwise the task goes to the Inbox.
- A token can only add tasks. Only its SHA-256 is stored; it is shown once. Revoke it in the same panel. Up to 20 per account.

```bash
curl -X POST "$XAIROS/api/xairos/quick-add" -H "Authorization: Bearer kai_…" -H 'content-type: application/json' -d '{"text":"Buy milk tomorrow 9am"}'
```

## Layout

| Path | What it holds |
|---|---|
| `src/types.ts` | Domain types: tasks, lists, habits, focus records, sync payloads |
| `src/parser.ts` | Quick-add parser (`parseQuick`) |
| `src/recurrence.ts` | Repeat rules: `nextDue`, `occurrences`, `advanceRepeat` |
| `src/lib/tz.ts` | Time-zone model: floating vs pinned times, conversion (`when`, `setLocalWhen`) |
| `src/habits.ts`, `src/focus.ts`, `src/kanban.ts` | Habit goals, streaks and reminders; focus timer and breaks; kanban columns (all pure) |
| `src/calendar.ts` | Calendar logic (pure): tasks per local day, week start, overlap layout |
| `src/reminders.ts` | When each reminder fires (pure), in the device's or a given time zone |
| `src/push.ts` | This browser's Web Push subscription: turn on, off, refresh on start |
| `src/sync/fields.ts` | Per-field stamps and merge (copied in `server/pb_hooks/xairos_lib.js`) |
| `src/sync/merge.ts` | Pure sync bookkeeping: dirty tracking with field stamps, pull merge |
| `src/sync/engine.ts` | Push/pull loop, offline retry with backoff, realtime subscription |
| `src/persist/idb.ts` | Per-account IndexedDB store; the dirty map in it is the offline push queue |
| `src/sw.ts` | Service worker: precached app shell, never caches `/api` |
| `src/server/adapter.ts` | The backend contract (`ServerAdapter`, ROADMAP.md §3) |
| `src/server/local.ts` | `LocalServer`: the mock backend in localStorage, kept for demo and offline use |
| `src/server/pocketbase.ts` | `PocketBaseServer`: the real backend adapter, realtime over SSE |
| `server/` | PocketBase migrations and hooks |
| `server/notifier/` | The worker: reminder scheduler, Web Push sender, Google Calendar sync (`google.ts`), entry point (`cli.ts`) |
| `src/google.ts` | Google Calendar in the app: connect, disconnect, cached events |
| `scripts/vapid.mjs`, `scripts/with-env.mjs` | Make `server/.env`; run a command with it loaded |
| `scripts/get-pocketbase.sh` | Fetches the pinned PocketBase release |
| `deploy/` | Server install, update, backup and restore scripts, Caddyfile, systemd units, laptop backup pull ([docs/deploy.md](docs/deploy.md)) |
| `scripts/release.sh`, `scripts/deploy.sh`, `scripts/test-deploy.sh` | Build a release tarball, ship it, dry-run the deploy kit |
| `assets/`, `scripts/make-icons.sh` | Icon sources; `npm run icons` renders `public/icons/` |
| `src/store.ts` | Session, local db, prefs, UI state and read helpers |
| `src/app.ts` | Render root, routing, keyboard shortcuts |
| `src/views/` | One module per screen: auth, rail, sidebar, tasks, detail, calendar, matrix, focus, habits, search, reminders |
| `src/ui/` | Icons, popovers, toast, themes (`theme.ts`; tokens at the top of `style.css`), drag and drop |
| `test/` | Tests for the parser, recurrence and sync merge, plus the backend contract run against both servers |
| `prototypes/single-file/` | The original one-file prototype, for reference |

## What works

- **Accounts.** Email and password, checked by PocketBase (the mock server uses PBKDF2). Each tab has its own session, so two accounts can run side by side. The account menu has "Use another account in this tab".
- **Sync.**
  - Changes are tracked as dirty entities and pushed in batches. Pulls are incremental from a server checkpoint.
  - Conflicts merge per field (`src/sync/fields.ts`): each field keeps the copy that changed it last, so a title edited on the laptop and a checklist ticked on the phone both survive. A description is one field (newest whole text wins). Habit check-ins merge per day. The checklist is one field.
  - The client, the mock server and the PocketBase hooks run the same merge; pushes are never rejected as stale.
  - A change on another device triggers a pull over PocketBase realtime (SSE). In `dev:local` mode, BroadcastChannel does this between tabs.
  - The rail shows sync status. Backups can be exported and imported as JSON.
- **Sharing.**
  - Right-click a list, or use the people icon, to share by email.
  - Roles are *Can edit* and *Can view*. The server enforces them.
  - Owners can change roles or remove members. Members can leave a list.
  - Tasks in shared lists can be assigned to a member. There is also an "Assigned to Me" view.
- **Reminders.**
  - Options: on time, 5 or 30 minutes early, 1 hour early, 1 day early. Tasks without a time remind at 9:00.
  - A reminder shows a system notification, a beep and an in-app card with Complete, Snooze and Open.
  - Snoozes sync across devices. On shared tasks, only the assignee gets the reminder.
  - **Background reminders** (account menu → Background reminders): the server sends them as push notifications, so they arrive with no tab open. Clicking one opens the task. On iPhone this needs the Home Screen app (iOS 16.4+). One subscription per browser: the account that turned it on last gets the pushes. Signing out turns it off.
- **Calendar: month, week and day.**
  - Week and day show hours. A timed task is a block as long as its length (30 min unless set; the date picker has a Length field). Overlapping blocks share the width.
  - Time blocking: drag on empty hours to create a block, drag a block to move it (15-minute steps, any day of the week), drag its bottom edge to resize, or double-click an hour for a one-hour task. Untimed tasks sit in the all-day row; drag them onto an hour to give them a time, or drag a block up to the all-day row to drop its time.
  - On touch, press and hold a block (or an empty hour) to start dragging; a plain swipe scrolls.
  - Weeks start on Monday; switch to Sunday in the account menu. Keys in the calendar: `m`, `w`, `d` switch views, `t` jumps to today. Clicking a date opens that day.
- **Time zones.** Times float by default: 9:00 stays 9:00 wherever you are. In the date picker, Zone pins a task to a time zone, and it then shows at the matching local time on every device, with the pinned time next to it ("Sat, 9:00 PM (15:00 New York)") and a globe in the task list. Lists, the calendar, reminders and pushes all use the local time.
- **Habits.** A daily goal with a unit ("8 glasses": each tap adds one and keeps counting past the goal, a ring shows progress; right-click or long-press a day for −1 or Clear day). "N days a week" shows the current week and counts weekly streaks. A reminder time fires while the habit still needs doing: every day for daily habits, and for weekly ones only once the target can no longer wait (3 a week with none done reminds from Friday). In the app and as a push, using the device's week start. Check-ins from two devices merge per day.
- **Focus.** Pomo with short and long breaks (lengths, "long break after N", and auto-start in the settings menu), or a stopwatch. Pick a task to focus on: the record links to it and the task shows "Focused 1h 5m". "Start focus" is also in a task's menu. The timer runs on timestamps and is saved per account, so a reload or closed tab does not lose it; a session that ended while closed is recorded on the next open.
- **Kanban columns.** A list's board view uses its own columns (To do and In progress until you change them): add, rename, reorder and delete (with undo) columns, add a task straight into a column, drag tasks between them. Columns sync to everyone on a shared list. Board or list view is remembered per list. Smart lists (Today, Next 7 Days, tags) keep date groups.
- **Themes.** Classic or Quiet Sails, each light and dark, following the system setting unless you pick one (theme button at the bottom of the rail). Quiet Sails uses the brand palette (flour, slate, rye, grit, moss), Libre Caslon Display for headings and IBM Plex Mono for dates and counts; task text stays sans. Priorities there are rye, ochre and moss, and overdue stays red. Preset list and habit colours show as muted versions. Fonts are bundled, so they work offline. `test/theme.test.ts` checks the Quiet Sails contrast.
- **Repeating tasks.**
  - Daily, weekdays, weekly on chosen days, monthly (clamped to the end of the month), yearly, or custom intervals.
  - Can repeat from the completion date, and can end on a date.
  - Quick add understands phrases like "every weekday 9:30", "every mon and thu", "every 2 weeks" and "monthly".
  - Completing a repeating task logs a completed copy and moves the task to its next date.
  - Upcoming occurrences show as outlines in the calendar.
- **Drag and drop**, with a mouse or by touch: press and hold a task, then drag it (holding without moving opens its menu).
  - Reorder rows, or move tasks between date sections and kanban columns.
  - Drop onto a sidebar list, Today, Tomorrow, a tag or Trash.
  - Drop onto a calendar day, or onto a matrix quadrant to change priority.

- **Offline and installable.**
  - Install from the browser, or on iPhone with Share → Add to Home Screen. The app opens offline from the service worker cache.
  - Data lives in IndexedDB per account. Edits made offline are queued there, survive reloads, and are pushed when the server is reachable again. The sync icon shows "Offline" and how many changes are waiting.
  - A new version shows a "Reload" prompt instead of switching under you.
  - Signing out deletes the account's data from the device. An expired session keeps it, so signing in again pushes what was queued.

## Current limits

- **Background reminders arrive up to 30 s late** (the notifier's poll interval), and only in builds: push needs the service worker.
- **Notification buttons** (Complete, Snooze) exist only on the in-app card. A push notification just opens the task.
- **Merge uses device clocks.** A device whose clock runs ahead wins ties it should lose. Fine for one person's devices; revisit for sharing at scale.
- **Checklist items are not merged one by one.** Ticking items on two devices at once keeps the newer whole checklist.
- **The service worker only runs in builds** (`npm run build && npm run preview`), not in `npm run dev`.

See [ROADMAP.md](ROADMAP.md) for what's missing and what to build next.

## Docs

- [docs/deploy.md](docs/deploy.md): self-hosting, backups and updates.
- [prototypes/single-file/](prototypes/single-file/): the single-file xairos prototype this build was split from.

## License

Copyright (C) 2026 Arsenii Melnychuk. xairos is free software under the GNU Affero General Public License v3.0 or later ([LICENSE](LICENSE)). If you run a modified xairos for other people over a network, you must offer them its source.
