# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

1. **The maintainer.** Uses it every day as their single planning tool, on a Linux laptop browser and an iPhone home-screen PWA about equally.
2. **A few friends.** They share lists with the maintainer.
3. **Open-source self-hosters** who find the repo. They are welcome, but they never drive design decisions. The app explains itself lightly and stays close to a personal project.

The job: capture what needs doing, decide when to do it, protect time to do it, and keep daily habits going. Do all of it in one place, at the right moment ("kairos", the opportune moment).

## Product Purpose

xairos is a to-do, calendar, focus and habit app. It exists so that one self-hosted tool replaces a to-do app, a habit tracker and a focus timer, without handing personal data to a vendor cloud. It succeeds when the maintainer opens nothing else to plan a day.

## Positioning

- **Self-hosted; you own your data.** It runs on your own server: PocketBase with JS hooks, Caddy and systemd, with restic backups. No vendor account.
- **Tasks, calendar, focus and habits in one tool**, with two-way Google Calendar sync. Neighbouring apps split these across several products or put them behind a subscription.

## Operating Context

- Quick capture throughout the day: a natural-language quick-add parser, keyboard shortcuts, Apple Shortcuts, and a desktop hotkey.
- Planning views: lists, calendar, Eisenhower matrix, kanban, search.
- Focus sessions with a timer. Habit check-ins, with stats and a heatmap.
- Web Push reminders with action buttons, sent by a notifier service.
- Offline-capable PWA with a service worker. A sync engine pushes and pulls changes, with per-field merge.

## Capabilities and Constraints

- Stack: Vite + TypeScript, no UI framework. `render()` rebuilds views. All styling is in `src/style.css` with CSS custom-property tokens.
- Backend contract: the `/api/xairos/*` routes (see README). The app never touches PocketBase collections directly.
- Sign-up is closed after the first account unless `XAIROS_OPEN_SIGNUP=1`.
- Licence: AGPL-3.0-or-later.
- Terminology: lists, tasks, habits, checks, focus, quick add, shared list, Inbox.
- Open: whether a desktop wrapper (Tauri) ships; landing page or docs site; how far self-hoster onboarding goes.

## Brand Commitments

- Name: **xairos**, always lowercase, said "KAI-ros (χ as in Bach)". It blends kairos (the opportune moment) with χαῖρε (rejoice, hello).
- Metaphor: a starship log that every crewmate can read and steer.
- Expressiveness: 2–3 out of 5. A tool first, with some character. One mood across tasks and habits.
- Fixed brand for now: no user themes or accent picker. Habit colours are user-chosen from a set outside the brand palette.
- Admired references, recorded as given: Anthropic's Claude, the Zen and Helium browsers, TickTick lists. Brand decisions and votes live in `dev-notes/brand/` and the brand brief doc. They are not in this file.

## Evidence on Hand

- The working app and its README feature list ("What works", "Current limits").
- No users beyond the maintainer and friends. No testimonials, metrics, press or pricing. Never invent any.

## Product Principles

1. **One tool, one place.** A new feature earns its place by removing the need for another app.
2. **The data is yours.** Self-hosting, export and account deletion are first-class, never afterthoughts.
3. **Capture must be instant.** Every surface keeps quick add within one keystroke or tap.
4. **The right moment over more tasks.** The app should help decide *when* to act, not grow an endless list.
5. **Personal first.** Polish for daily use beats configurability for strangers.

## Accessibility & Inclusion

WCAG 2.2 AA as the floor: 4.5:1 contrast for body text and full keyboard operation. Phone and laptop are both primary, so touch targets and keyboard paths both matter. Respect `prefers-reduced-motion`.
