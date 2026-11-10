# xairos roadmap

This file covers what is missing before xairos is a complete product, and ideas beyond that. Priorities: **P0** blocks real use, **P1** is expected of a good to-do app, **P2** differentiates it.

---

## 1. What's lacking (gaps in the current prototype)

### P0: make it real

1. **A real backend.** Done: PocketBase (`server/pb_hooks`); `LocalServer` stays as the demo mode. Replace `LocalServer` with an HTTP API that keeps the same contract (§3), so the client barely changes. Good fits for one person:
   - **PocketBase**: one Go binary with SQLite, auth and realtime.
   - **Supabase**: Postgres, auth, row-level security and realtime.
   - A small **Node or Go server with SQLite**.
2. **Realtime push.** Done: PocketBase realtime (SSE) on each user's `signals` row. Replace BroadcastChannel with a WebSocket or SSE that sends `needSync` to the user's devices.
3. **Proper auth.**
   - Done: per-IP rate limits on login, account deletion and notification buttons, and a per-account lockout (10 wrong passwords lock the email for 15 minutes). PocketBase's own password route is off. Hashing is PocketBase's bcrypt, which is fine; argon2id is not worth a custom auth stack.
   - Still open: httpOnly cookies instead of a token in localStorage; email verification and password reset (both need SMTP); optionally OAuth, passkeys and TOTP 2FA.
4. **Offline-first PWA.** Done (`src/sw.ts`, `src/persist/idb.ts`).
   - Service worker, web app manifest and installable app.
   - IndexedDB instead of localStorage, which has a ~5 MB cap and is synchronous.
   - A queued push that survives reloads. The dirty map already supports this.
5. **Background reminders.** A server-side scheduler plus Web Push (VAPID), so reminders fire when no tab is open. On the desktop, use native notifications from a wrapper (§2).
   - Done: the notifier sidecar (`server/notifier/`) sends task reminders in each device's time zone. Habit reminders are sent too. Notifications have buttons: Complete and Snooze 15 min on tasks, Done (or +1) on habits. They work with no tab open: each push carries a signed token (`server/notifier/actions.ts`), and repeating tasks move to their next date as in the app.
6. **Time zones.**
   - Store `due` and `time` together with a tz, or as "floating".
   - Today the date and time are local strings, which break when you travel or share across zones.
   - Daylight-saving changes need tests.
   - Done: floating by default, `tz` pins a task to a zone (`src/lib/tz.ts`), with DST tests. Week and day views with hours and time blocking came with it.
7. **Conflict resolution.** Done: per-field merge (`src/sync/fields.ts`).
   - Last-writer-wins per *entity* loses concurrent edits to different fields, such as a title and a checklist item.
   - Move to per-field `mtime` or a CRDT (Yjs or Automerge) for descriptions and checklists.
8. **Data safety.** Done.
   - Nightly restic backups on the server (§6). Trash keeps tasks 30 days, then deletes them for good (`src/lib/trash.ts`, a daily cron in PocketBase).
   - Export: full JSON backup (re-importable), tasks as CSV and as iCalendar VTODOs (`src/lib/export.ts`).
   - Account deletion (account menu): asks for the password and "DELETE", erases owned lists and their tasks, habits, focus history, push subscriptions, tokens and the Google link. Shared lists lose the user.

### P1: expected features

- **Recurrence completeness:**
  - Skip one occurrence, and "edit this / all future".
  - Nth weekday of the month ("2nd Tue"), last day or last weekday of the month.
  - End after N times (the field exists, but there's no UI for it).
  - Show the next 5 dates in the picker.
- **Reminders:**
  - Custom offsets and absolute reminder times.
  - Location reminders (mobile).
  - Daily digest ("Your day at 8:00").
  - Nag or repeat until acknowledged.
- **Sharing:**
  - Invite links and pending invites for people without an account, sent by email.
  - Share folders and filters, not only lists.
  - Comments and an activity log per task ("Bob completed …").
  - Notification center with @mentions.
  - An "edit" vs "comment-only" role.
- **Organisation:**
  - Folders (list groups), list reordering by drag.
  - Kanban with custom columns (sections) instead of date buckets.
  - Real nested subtasks (parent and child tasks, not just checklist items).
  - Tags with colours and nesting.
  - Smart filters ("priority ≥ medium AND #work AND due ≤ 7 days").
- **Views:**
  - Calendar week, day and 3-day views with time blocks; drag to set times and resize to set duration.
  - Timeline (Gantt) view.
  - ~~Year heatmap for habits.~~ Done (`src/views/habit-detail.ts`).
- **Task fields:** start date with duration, estimated Pomodoros, attachments (files and images), links with previews, Markdown description.
- **Search:** filters (list, tag, date range, completed), saved searches and a command palette (Ctrl+K).
- **Habits:**
  - ~~Goal per day (e.g. 8 glasses), weekly frequency ("3× per week") and reminders.~~ Done (`src/habits.ts`).
  - Notes per check-in. ~~Stats (completion rate, best streak).~~ Done (habit detail page).
- **Focus:**
  - ~~Link a session to a task, with time logged on the task.~~ Done.
  - ~~Configurable lengths, long breaks, auto-start the next session.~~ Done (`src/focus.ts`).
  - White noise, and stats by day, week and task.
- **Import:** tasks from CSV and ICS files. **Calendar subscriptions:** read-only ICS URLs, and Google or CalDAV later.
- **Undo history:** multi-step undo and redo, not only the last toast.

### P1: quality

- **Accessibility:**
  - Keyboard navigation in lists (↑/↓, Space to complete, Enter to open).
  - Focus trapping in popovers, ARIA roles for menus and the tree.
  - Screen-reader labels for icon-only buttons; contrast checks on the `--t3` greys.
- **Touch:** ~~touch drag-and-drop (pointer events with long-press)~~ done; swipe to complete or schedule, larger tap targets.
- **i18n:** strings live inline. Move them to a dictionary, add plural rules, and support a locale-aware week start (Monday vs Sunday).
- **Performance:** `render()` rebuilds the whole view. Fine at ~1k tasks; beyond that use keyed diffing (lit-html, Preact or Svelte) and virtualised lists.
- **Tests:**
  - Unit tests for `parseQuick`, `nextDue` (month ends, leap years, DST) and the sync merge.
  - Playwright end-to-end tests for two-tab sync and sharing.
- **Code structure:** split the single file into modules when moving to a build: `server/`, `sync/`, `views/`, `parser/`, `recurrence/`. Vite, no framework needed at first.

---

## 2. Bigger ideas (P2 / differentiators)

- **Natural-language everything:**
  - "move all #errands to saturday".
  - Smart quick-add suggestions from history ("Gym" usually goes in Personal at 18:00).
- **Daily planning ritual:**
  - A morning screen that pulls in overdue tasks and today's calendar, with "plan my day" time-blocking.
  - An evening review screen.
- **Time blocking + focus:** drag a task onto the calendar to block time; the focus timer starts automatically at block start.
- **Energy and context tags:** low, medium or high energy; @home, @computer. A "what can I do now?" view filtered by time available.
- **Weekly review wizard:** walks Inbox, then stale tasks, then next week; snooze or delete stale items in bulk.
- **Insights:** completion by weekday and hour, chronic postponers ("rescheduled 5×"), focus vs plan.
- **Optional AI assistant:**
  - Break a task into subtasks, and summarise a list.
  - Chat over your tasks through a tool interface: list, create, update or complete tasks.
  - An MCP server so AI agents can manage tasks with your API key.
- **Public API and webhooks:** personal API tokens and a REST API (the sync contract plus CRUD). Webhooks for automation, an iCal feed of tasks.
- **Integrations:**
  - Email-to-task address.
  - A Telegram bot.
  - Obsidian: tasks ↔ `- [ ]` lines in a vault.
- **Desktop app:**
  - Use **Tauri**, not Electron: small, with native Wayland.
  - Tray icon, global quick-add shortcut and native notifications.
  - A desktop launcher entry, and a global keybinding to pop up quick add.
- **Widgets:** a status bar widget showing the next task, and a CLI (`at add "…"`, `at today`).
- **Templates and checklists:** reusable project templates, recurring checklists (packing, weekly review).
- **Privacy:** optional end-to-end encryption of task content (a key derived from the password). This conflicts with server-side search, push previews and AI, so make it per-list.

---

## 3. Backend contract (what `LocalServer` implements today)

| Call | Request | Response |
|---|---|---|
| `POST /auth/signup` | `{name, email, password}` | `{token, user}`; also creates an `inbox-<uid>` list |
| `POST /auth/login` | `{email, password}` | `{token, user}` |
| `POST /auth/logout` | – | – |
| `GET /sync?checkpoint=N` | – | `{checkpoint, lists[], tasks[], habits[], focus[], users[], revoked[]}` |
| `POST /sync` | `{lists[], tasks[], habits[], focus[]}` (dirty entities) | `{checkpoint, id2error{id: NO_PERMISSION}}` |
| `GET /users?email=` | – | public `{id, name, email}` or 404 |
| `POST /lists/:id/leave` | – | – |
| WS `needSync` | `{users[]}` | the client calls `GET /sync` |

These are the server rules the client relies on.

- **Sync rules:**
  - A global monotonic `seq` is stamped on every write. A pull returns everything visible with `seq > checkpoint`.
  - Deletes are tombstones (`removed: true`).
  - Losing access to a list produces a `revoked` entry. Moving a task out of a list you can still see produces a tombstone.
- **Permissions:**
  - The list owner can do everything.
  - The `edit` role can change tasks and the list's name and colour.
  - The `view` role can only read.
  - Only the owner can change members or delete the list.
  - Habits and focus records are private to their owner.
- **Conflicts:** the server merges each pushed entity with its stored copy per field, using the `fm` stamps (`src/sync/fields.ts`). `STALE` is no longer returned.
- **Extra routes outside the contract:** the API-token routes for Shortcuts (`POST /api/xairos/quick-add`, `GET /api/xairos/habits`, `POST /api/xairos/habits/:id/check`) only add calls. A habit check-in is a server-stamped change to one `checks.<day>` path, merged like any push. `LocalServer` has the habit logic as `habitList`/`habitCheck` (session token, no API tokens), so `test/contract.test.ts` covers both backends.

---

## 4. Security rules for a desktop wrapper

- **Electron windows:** don't use `nodeIntegration: true` or `contextIsolation: false` in any window.
- **Untrusted code:** never `eval()` update metadata or any server JSON.
- **Tokens:** don't store auth tokens in plaintext JSON. Use httpOnly cookies, or the OS keychain in a desktop wrapper.
- **Electron fuses:** turn off `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`.
- **Keep the sync model:** checkpoint-plus-batch sync with id-based error lists, and a "needSync" push that carries no data. Both are simple and robust.

---

## 5. Suggested next steps

1. Pick the backend (PocketBase is the fastest path) and implement §3. Keep `LocalServer` as an offline and demo mode.
2. Make it a PWA: service worker, IndexedDB, manifest, Web Push.
3. Add tests for the parser, recurrence and sync before more features.
4. Do the time-zone model, then calendar week view with time blocking.
5. Build the Tauri desktop wrapper with a global quick-add shortcut.
