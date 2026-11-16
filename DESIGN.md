---
name: xairos
description: A self-hosted to-do, calendar, focus and habit app that looks like chart paper and a starship log, with one orchid accent.
colors:
  ground: "#EEF2EA"
  ground-dark: "#0C1517"
  surface: "#FAFCF7"
  surface-dark: "#122022"
  raised: "#E2E8DC"
  raised-dark: "#1A2B2D"
  line: "#CBD5C4"
  line-dark: "#26393B"
  rail: "#E1E7DB"
  rail-dark: "#091113"
  side: "#E7ECE2"
  side-dark: "#0F1B1D"
  text: "#23271A"
  text-dark: "#DCDDBD"
  text-2: "#50553E"
  text-2-dark: "#A9AC8A"
  text-3: "#5E634C"
  text-3-dark: "#7E8168"
  accent: "#A0447E"
  accent-dark: "#D985B8"
  on-accent: "#FFFFFF"
  on-accent-dark: "#1F0A18"
  accent-line: "#DFACCA"
  accent-line-dark: "#9D5682"
  on-hue: "#FFFFFF"
  on-hue-dark: "#0C1517"
  prio-high: "#C9372C"
  prio-high-dark: "#FF6A5C"
  prio-med: "#8A6100"
  prio-med-dark: "#F2C14E"
  prio-low: "#3B5FD9"
  prio-low-dark: "#7C9CFF"
  success: "#2F7A3A"
  success-dark: "#8CCB7E"
  info: "#2D6AA6"
  info-dark: "#86B8E8"
  warning: "#8A6100"
  warning-dark: "#F2C14E"
  danger: "#C9372C"
  danger-dark: "#FF6A5C"
  danger-text: "color-mix(in oklab,var(--danger-c) 75%,var(--text))"
  habit-rose: "oklch(.52 .05 15)"
  habit-rose-dark: "oklch(.74 .045 15)"
  scrim: "rgba(0,0,0,.25)"
typography:
  headline:
    fontFamily: "\"Onest Variable\", \"Onest\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-.02em"
  title:
    fontFamily: "\"Onest Variable\", \"Onest\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.01em"
  body:
    fontFamily: "\"Onest Variable\", \"Onest\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "\"Onest Variable\", \"Onest\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: ".02em"
  data:
    fontFamily: "\"Martian Mono Variable\", \"Martian Mono\", ui-monospace, \"SFMono-Regular\", Menlo, monospace"
    fontSize: "calc(var(--text-size) * var(--mono-scale))"
    fontWeight: 400
    lineHeight: 1.45
  clock:
    fontFamily: "\"Martian Mono Variable\", \"Martian Mono\", ui-monospace, \"SFMono-Regular\", Menlo, monospace"
    fontSize: "clamp(64px,11vw,104px)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-.03em"
rounded:
  sm: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  row-height: "38px"
  row-height-phone: "46px"
  row-gap: "6px"
  content-gutter: "24px"
  content-gutter-phone: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 14px"
  task-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    height: "{spacing.row-height}"
    padding: "0 12px"
  quick-add:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 10px 0 12px"
  popover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px"
  chip:
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "1px 9px"
  toast:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ground}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
---

# Design System: xairos

## Overview

**Creative North Star: "The Chart-Paper Log"**

xairos is a planning tool first, with some character. The surfaces are quiet chart paper (a pale green-grey in light mode, a deep teal in dark mode), the ink is olive, and one orchid accent marks the single thing that matters on a screen. It reads like a starship log that every crewmate can read and steer: dense enough to plan a day without opening anything else, calm enough to use all day. Expressiveness is 2 to 3 out of 5, and the same mood runs across tasks, calendar, focus and habits.

Dark is the default look. Light is the same system on paper. The mode is set by `data-mode="dark"` on the root element, written before first paint. Depth comes from tonal layering and hairlines, not shadows. Movement is short and quiet. Under `prefers-reduced-motion` the toast, the phone drawer and the carets lose their movement and keep fades (see Motion).

The brand kit was approved at Gate A on 2026-11-10. The brand brief and the approved board are internal, not published. This file describes what the shipped code does.

Not browser-checked for this file: the dark-theme side panel, the kanban with more than one column in dark theme, and the Shortcuts panel (PocketBase mode only).

**Key Characteristics:**
- Chart-paper neutrals tinted green in light mode and teal in dark mode.
- One accent, orchid, used as a small solid fill or as an OKLab tint.
- Onest for everything. Martian Mono only for real, short data.
- Flat surfaces with 1px hairlines. One shadow, for floating things only.
- Lucide-style line icons, inlined as SVG.
- A calligraphic chi (the name is said "KAI-ros", chi as in Bach) with a single orchid moment dot.

## Colors

A green-grey paper palette with olive ink and one orchid accent. Every value below is copied from `src/ui/tokens.css`; the frontmatter is the normative copy. Light values come from `:root`, dark values from `:root[data-mode="dark"]` and carry the `-dark` suffix.

### Primary
- **Orchid** (`--accent`: light #A0447E, dark #D985B8): the one accent. A solid fill on one small thing: a primary button, a checked checkbox, the active icon, the today pill, the moment dot. Also a tint mixed in OKLab at 9% (selected row, drop target, preview block) or 13% (active nav, active rail icon, chip, popover item hover).
- **Orchid line** (`--accent-line`: light #DFACCA, dark #9D5682): the border that pairs with the 9% tint on a selected row, and the focus border on inputs.
- **On orchid** (`--on-accent`: light #FFFFFF, dark #1F0A18): text and icons on an orchid fill.

### Neutral
- **Ground** (`--ground`: light #EEF2EA, dark #0C1517): the page and main column. Also the colour of text on the inverted toast and tooltip.
- **Surface** (`--surface`: light #FAFCF7, dark #122022): task rows, habit cards, stat cards, the focus task row.
- **Raised** (`--raised`: light #E2E8DC, dark #1A2B2D): popovers, reminder cards, inputs, the quick-add bar, unfilled progress and heatmap cells.
- **Hairline** (`--line-c`: light #CBD5C4, dark #26393B): every border, divider, calendar grid and hour line.
- **Rail** (`--rail-c`: light #E1E7DB, dark #091113) and **Side** (`--side-c`: light #E7ECE2, dark #0F1B1D): the icon rail and the list sidebar.
- **Ink** (`--text`: light #23271A, dark #DCDDBD): primary text.
- **Ink 2** (`--text-2`: light #50553E, dark #A9AC8A): secondary text, labels, hover icons.
- **Ink 3** (`--text-3`: light #5E634C, dark #7E8168): muted text, icons, borders of unchecked boxes, done rows.
- **On hue** (`--on-hue`: light #FFFFFF, dark #0C1517): text on a habit or list hue fill, and on a danger button.

### Semantic
- **High, medium, low priority** (`--prio-high` #C9372C / #FF6A5C, `--prio-med` #8A6100 / #F2C14E, `--prio-low` #3B5FD9 / #7C9CFF): the priority dot. High is filled, medium is half filled, low is an outline. Muted to `--text-3` once a task is done.
- **Success** (#2F7A3A / #8CCB7E), **Info** (#2D6AA6 / #86B8E8), **Warning** (#8A6100 / #F2C14E, the same amber as medium priority), **Danger** (`--danger-c` #C9372C / #FF6A5C). Danger red is the same red as high priority in every mode. Warning and danger always carry an icon or a shape as well as colour.
- **Danger text** (`--danger-text`: `color-mix(in oklab,var(--danger-c) 75%,var(--text))`): a text-only mix, not a hex. It resolves per mode from `--danger-c` and `--text`, so there is one definition (in the light block of `tokens.css`) and no `-dark` key. Use it for danger text on raised or selected backgrounds. Use `--danger-c` itself for fills and icons.

### Habit and list hues
Habit, list and calendar colours are `oklch(var(--hab-l) var(--hab-c) <hue>)`. The nine hues are 25, 55, 85, 120, 150, 185, 215, 250 and 290. A tenth, rose-grey, is `--hab-rose`. Lightness and chroma change with the mode: light uses L .52 and C .14, dark uses L .76 and C .13. Rose-grey is `oklch(.52 .05 15)` in light and `oklch(.74 .045 15)` in dark. Google Calendar colours snap to the nearest of the nine hues (`safeColor` in `src/views/calendar.ts`). These hues sit outside the brand palette on purpose: the user picks them.

### Text contrast rules
A scan of computed colours flagged 5 pairs under 4.5:1. Four were real and are fixed, using existing tokens only; the fifth, the dark avatar "T" at 3.13, was a false positive. All ratios below are computed from the CSS values (OKLab mixes, sRGB compositing for translucent backgrounds). Five sets were also confirmed by a browser capture: toast Undo, the selected nav count, the Today nav digit, `.pop .mi.danger` danger text (5.51:1 and 6.32:1), and the dark kanban `.sec-h .n` and `.kc-add` (7.58:1). Every other ratio, including each "up from" figure, is computed from CSS, not captured. These are the rules:
- **Toast "Undo".** The toast background is `--text`, so the toast is light in dark mode and the button needs a mix per mode: 70% orchid over `--ground` in light (4.59:1), 50% in dark (5.43:1, up from 3.49).
- **Selected nav count.** On the selected (orchid-tinted) nav item the count uses `--text-2`: 5.42:1 in light (up from 4.37), 6.16:1 in dark.
- **Selected calendar icon digit.** The day digit inside the Today nav icon, when selected, is a mix of 80% orchid with `--text`: 4.99:1 in light (up from 4.06), 6.31:1 in dark, where the fill is a slightly lighter orchid than the accent.
- **Danger text.** Light `--danger-c` is 4.13:1 on `--raised`, 4.40:1 on a selected row and about 4.3:1 on `--side-c` (computed from CSS, not captured). Danger text on those backgrounds uses `--danger-text`. `.pop .mi.danger` on `--raised` reaches 5.51:1 in light and 6.32:1 in dark. `.row .meta .late` and `.pop .err` use `--danger-text` too. The popover item icon follows `currentColor`, so it is a little darker than `--danger-c`.
- `--danger-c` still passes as text on `--ground` and `--surface` (computed from CSS, not captured: 4.56:1 and 5.0:1 in light), so `.sec[data-sec="over"]>.sec-h`, `.prop .v.late` and `.auth .err` keep it. The margin is narrow in light.
- Not checked: hover or transient backgrounds beyond the popover item hover (computed from CSS, not captured: 4.64:1 light, 5.15:1 dark).
- **Kanban column counts and Add task.** `.sec-h .n` and `.kc-add` use `--text-2` in dark mode: 7.58:1 measured on the column at 375px (at 1024px the computed colour is the same `--text-2`; the old 4.38 to 4.42 was measured at both widths), up from 4.38 to 4.42 (browser capture). `.sec-h .n` is not scoped to the kanban, so the Today and list section counts are lighter in dark mode too; their contrast only rises.
### Named Rules
**The One Small Thing Rule.** Orchid is a solid fill on one small thing per area, or a tint. It is never a large fill and never a text colour on body copy.

**The OKLab Rule.** Mix every tint with `color-mix(in oklab, ...)`. Never mix orchid in OKLCH: the hue path from orchid (343 degrees) to the teal ground (213 degrees) runs through blue.

**The Never-Beside Rule.** Never place an orchid badge directly beside a high-priority dot. They have the same lightness.

**The Tokens-Only Rule.** New code reads named tokens. It does not write a raw hex, `rgb()` or `hsl()` in `src/style.css` or `src/views/*`. The one deliberate exception is the `theme-color` meta tag and the web manifest, which stay a raw #0C1517 because they are read before any stylesheet loads.

## Typography

**Sans Font:** Onest Variable (with Onest, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Mono Font:** Martian Mono Variable (with Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace)

**Character:** Onest is a friendly, even grotesque used for every word. Martian Mono is a wide, precise monospace that gives times, counts and the focus clock a log-book feel. Tabular figures are on for the whole body.

### Hierarchy
- **Headline** (600, 24px, -.02em): the view title in the top bar.
- **Title** (600, 19px, 1.3, -.01em): the task title in the detail pane. Section headers inside popovers are 14px at 600, and quadrant headers are 15px at 600.
- **Body** (400, 15px on wide layouts, 16px on phone, 1.45): rows, inputs and prose. `--text-size` is 15px and becomes 16px at 760px and below, because iOS zooms into inputs under 16px.
- **Label** (400, 12.5px, .02em): property labels, tags, hints. Smaller 11px and 12px sizes appear in hour gutters, counts and keyboard hints.
- **Data** (Martian Mono, 400, body size times `--mono-scale`): times, dates, counts, durations. 15px body gives 13.2px mono. Several places subtract 1px or 1.5px for small data (hour gutters, counts, the created date).
- **Clock** (Martian Mono, 400, `clamp(64px,11vw,104px)`, line height 1, -.03em): the focus timer.

Weights in use are 400, 500 and 600. Body weight is 400 or more. 300 is reserved for big numbers and is not used today.

### Named Rules
**The Real Data Rule.** Martian Mono is only for real data (times, dates, the timer, counts, durations) and short strings. The size is the text size times `--mono-scale` (.88). Long dates go in Onest with tabular figures.

**The Documented Mono Exception.** Mono is kept for strings longer than 8 characters on four surfaces, as a deliberate decision: `.f-phase` (the focus phase label), `.d-created` (the created date in the detail pane), `.logl` (the milestone line) and the calendar block subtitle `.blk .bs`. Do not copy this to new surfaces.

## Layout

A three-part shell: a 60px icon rail, a 236px list sidebar, a flexible main column, and an optional 380px detail pane on the right. The top bar is 56px. Content has 24px side padding and 16px on phone.

Rows are separate cards with a 6px gap. The row height is `--row`: 38px on wide layouts and 46px on phone. This is as drawn on the approved board, and it is a deliberate decision, not a missed 44px target. Habit week buttons are 26px in CSS on wide layouts and drawn 34px on phone.

**Phone tap targets.** At 760px and below, controls reach a 44px hit area. There are three techniques. Where the drawn size is on the approved board, it stays and an invisible `::after` pseudo-element supplies the hit area. Hit areas now reach at least 44 on: the tab bar buttons (drawn 38px), the reminder-card menu button `.rem-h .icon-btn` (drawn 24px; measured at 375px dark: box 24 by 24, hit 44 by 44 before the phone hit-area fixes and 45 by 45 after), the kanban column menu button `.kc-menu` (a real 44 by 44 box on phone, measured; 24 by 24 only on wide layouts), the task checkbox `.cb` (18px in CSS, hit 46 by 46; kanban cards are plain rows, so the same rule covers them), the calendar Today button `#c-today` (46 tall), weekday cells (drawn 34px), the due popover weekday buttons (on phone the due popover is widened to `calc(100vw - 16px)`; measured, dark and light: 375px popover 359, button 43 by 44, hit 47 by 45; 360px popover 344, button 41 by 44, hit 44 to 45 by 45, at the limit; the desktop popover stays 320; the test pane showed an 8px scrollbar that takes 8px from the row; 320px not measured), the habit title button, the add-list plus button (drawn 22px, hit 44 by 44), the detail checkbox (18px in CSS, hit 46 by 46), the subtask checkbox (drawn 16px, hit 46 by 44), Focus Start and Pause (117 by 45), Continue and Skip (47 to 49 tall), the Focus mode toggle (46 tall, drawn 26px), and the sign-in tabs (hit 45 tall, drawn 34). The detail title field gets its 44px tap area from padding with a matching negative margin, so the layout height does not change. Where there is no resting background to protect, or where neighbours are tight, the box is real and the layout grows on phone: `.icon-btn` is 44 by 44 (the 18px icon is unchanged); `.side-head` (the Lists and Tags heads) is 44 tall; the kanban column header `.kcol .sec-h` is 44 tall, so the whole 44 box of `.kc-menu` takes taps, and `.kc-add` and `.kc-new` have `min-height:44px` (the columns are taller on phone); `.prop` rows (Due, Priority, List, Reminder) have `min-height:44px`, about 12px taller each; subtask rows `.ck` are 44 tall with a 44 tall input; popover options `.pop .opt` are 44 tall; and sidebar items, quick add, the search box, popover items (`offsetHeight` 44, not re-measured in a foreground browser), the Focus task input, the pomodoro and popover number inputs and the quick-add and search inputs are 44 tall. The detail title row `.d-tt` has a 6px bottom margin so the checkbox hit area does not overlap Due. Inputs stay at 16px. All of this lives inside the `max-width:760px` blocks, so wide layouts are unchanged.

The sign-in side gutter is 16px at phone width. By arithmetic from the CSS, it had been about 3.5px each side. The cause was an auto grid track that grew to the 380px card width, because a percentage `max-width` does not shrink an auto track. At phone width `.auth` now has one `minmax(0,1fr)` column, and the card is as wide as the track (343px at 375). By arithmetic (not captured), from 412px up to 760px the card stays 380px wide, centred: 412 is the 380px card plus 32px of side padding.

How these were established. Measured by capture in a browser (parent session, 375px width, and 360px for sign-in) and passing: the task checkbox `.cb` (46 by 46 on rows and kanban cards, rows 46 tall), `.side-head` (44), the add-list button (22 by 22 drawn, hit 44 by 44), side drawer nav items (44), `#c-today` (hit 68 by 46), the detail pane (checkbox 46 by 46, `.prop` rows 44, subtask input 44, `.d-title` 45, `.ck` 44, subtask checkbox hit 46 by 44, header and footer icon buttons 44 by 44), tab bar buttons (drawn 38, hit 45 by 45), `.h-open` (hit 46), `.icon-btn` outside the detail pane (44 by 44), the quick-add and search inputs (44), Focus (mode toggle 46 tall, Continue and Skip 47 to 49, Start and Pause 117 by 45, task input 44, settings option rows 44, number inputs 44 to 45), sign-in (inputs 343 wide from 16 to 359, 16 to 344 at 360px; button 46; tabs drawn 34, hit 45; no horizontal scroll), the reminders card (measured at 375px dark: `.rem-b .btn` Complete, Snooze and Open box 32, hit 45 to 47 tall; Dismiss `.rem-h .icon-btn` box 24 by 24, hit 45 by 45), the share dialog (measured at 375px dark: email input and role select 44 by `offsetHeight`; Invite box 32, hit 47), the due popover (measured at 375px dark: date, time, zone, length, repeat and until fields 44, `.opt` rows 44; Cancel and OK box 32, hit 45 and 47), the tags prompt (measured at 375px dark: input 44; Save box 32, hit 47), the priority and list popover rows (44, measured at 375px dark), and the kanban at 375px (column headers 44, `.kc-menu` 44 by 44 and takes taps, `.kc-add` 254 by 44, `.kc-new` 200 by 44, card `.cb` 46 by 46; wide-layout kanban unchanged). Set in CSS, not measured: the popover option rows `.pop .opt` anpm run buildnd the text and number inputs in every popover except the Focus settings, due, priority, list and share popovers and the tags prompt (measured, see above; dark text in the share dialog, reminder card, detail pane and those popovers was also measured in a browser at 4.6:1 or higher, none under 4.5; Focus: option rows 44, number inputs 44 to 45). Known gap, kept on purpose, with no time-column change: the week header buttons `.tg-dh`. The seven cells tile 42.7px each beside the 44px time column (the 60 in 60 to 359 is the x offset: 16px gutter plus 44px) and are not clipped, so the hit area is about 42 to 45 wide. Not measured: the dark-theme side panel, the kanban with more than one column in dark theme, and the Shortcuts panel (PocketBase mode only). The text contrast ratios are computed from the CSS values; only the five sets named under Text contrast rules were also confirmed by a browser capture, and the rest are computed from CSS, not captured. They are separate from the tap-target measurements.

Approved exceptions, listed as they are and not claimed as 44px:
- The calendar view switcher (`.cal-seg`, M/W/D) keeps its drawn size. Its hit area is 46px tall but only 27 to 31px wide (Month 29, Week 31, Day 27). It is not widened. This is a deliberate, approved exception.
- The month-grid day number is a small `<button class="d">` of about 40px wide by 32px tall. The `.cell` clips the pseudo-element, and the click handler sits on that button, not on the cell. The cell keeps its double-click new-task behaviour. No code change. This is a deliberate, approved exception.
- The other approved exceptions are covered where they apply: reduced motion checked from the CSS only (Motion), the hidden phone scrollbar (below), mono on long strings and the orchid washes (Typography and Components).

Known gaps:
- The weekday cells (`.wd`) are 44px wide with no overlap at 375px. Measured: hit 44 wide with no overlap at 375px (pitch 47 to 48) and at 360px (pitch 45). 320px was not measured.
- By arithmetic (not measured), the tab bar buttons can overlap by a few px at 320px.
- Not measured in a browser, so not claims of compliance: the dark-theme side panel, the kanban with more than one column in dark theme, and the Shortcuts panel (PocketBase mode only).

**Scrollbar.** At 760px and below `.content` hides its scrollbar (`scrollbar-width:none`). Reason: the global 8px classic scrollbar took 8px of the 16px gutter on any view taller than the screen, so cards ended at 351 instead of 359 at 375px. This was decided on purpose. The tradeoff: a browser window of 760px or less, used with a mouse, shows no scrollbar. Scrolling still works. There is no `scrollbar-gutter`, because it would reserve space on both sides.

Breakpoints: at 1100px and below the detail pane becomes a fixed overlay on the right. At 760px and below the rail moves to a bottom tab bar (52px plus the safe-area inset), the sidebar becomes a slide-in drawer with a scrim, the detail pane fills the screen, matrix quadrants stack, and tags in rows are hidden. Phone tab order follows the board: Tasks, Calendar, Habits, Focus, Search, then Matrix and the rest.

The `spacing` frontmatter group holds shipped measurements, not a token set. Only `row-height` is backed by a token (`--row`); the others are plain values in `src/style.css`. The recurring rhythm is a 6px gap between cards, 10px gaps inside rows, 8px and 12px inner padding, and 24px content gutters.

## Elevation & Depth

Tonal layering with hairlines. Surfaces step from ground to surface (cards) to raised (floating panels and inputs), each with a 1px `--line-c` border. Nothing at rest has a shadow.

### Shadow Vocabulary
- **Pop** (`--shadow-pop`, light `0 8px 24px rgba(43,47,51,.14),0 1px 3px rgba(43,47,51,.1)`, dark `0 8px 24px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.35)`): floating things only: popovers, reminder cards, the toast, a dragged calendar block, the touch-drag ghost.
- **Scrim** (`--scrim`, `rgba(0,0,0,.25)`): the phone drawer backdrop.
- **Grain** (`--grain`, .05 light and .07 dark): declared in the tokens, but no stylesheet rule reads it today.

### Named Rules
**The Flat-At-Rest Rule.** Surfaces are flat and bordered. A shadow appears only on something that floats above the page.

**The Legacy Shadow Note.** The detail overlay and the phone drawer still read the legacy `--shadow` alias, which equals `--shadow-pop`. New code uses `--shadow-pop`.

## Shapes

Soft but not round. Cards, popovers, rows, the rail buttons and the toast use 8px (`--radius-lg`). Buttons, inputs, tabs and property rows use 6px (`--radius-sm`). The pill (`--radius-pill`, 999px) is for chips, tags and the date pill. The app icon and sidebar logo use a 22.5% radius. Avatars and priority and dot markers are circles.

Small parts such as checkboxes (5px, 4px in subtasks), heatmap cells (2px), tooltips and small icon buttons use fixed radii of 2 to 6px written directly in the stylesheet. They are not tokens.

Borders are 1px hairlines in `--line-c`. A selected or focused thing swaps to `--accent-line`. Dashed outlines mean "still open" (today's habit cell) or "add new" (new kanban column). Calendar events carry an inset 3px bar on the left in their hue.

## Components

### Buttons
- **Shape:** 6px radius, 32px high, 14px side padding, 13px text. Focus-mode buttons are 40px high and 15px text.
- **Primary:** orchid fill, `--on-accent` text, weight 500. Hover mixes 88% orchid with ink. Disabled is 60% opacity. The danger variant is `--danger-c` fill with `--on-hue` text.
- **Secondary:** transparent with a 1px hairline border and ink text. Hover is a 6% ink tint.
- **Icon button:** 30px (44px on phone), 6px radius, `--text-3` icon that goes to `--text-2` on hover (5% ink tint). Active is orchid.

### Task rows
A surface card: 8px radius, hairline border, 38px high (46px on phone), 12px side padding. Hover mixes 3% ink into the surface. Selected is a 9% orchid tint with an `--accent-line` border. The checkbox is an 18px neutral outline. It turns orchid while a task is being completed, then settles to `--text-3` once done, and the priority dot turns `--text-3` with it. Priority reads as a 10px dot: filled, half, or outline.

### Inputs and quick add
Quick add and the search box are `--raised` fills, 40px high, 6px radius, with a hairline border. Focus changes only the border to `--accent-line`. Popover fields use the ground colour as their fill. Placeholders use `--text-3`.

### Popovers and menus
`--raised`, 8px radius, hairline border, `--shadow-pop`, 6px padding, entering over 200ms. Menu items are 34px high (44px on phone), 6px radius, and hover with a 13% orchid wash. That wash is a deliberate decision, as is the 9% orchid wash on `.drop-over` targets.

### Navigation
The rail holds 38px buttons with 22px icons; the active one is orchid text on a 13% orchid tint. The sidebar items are 34px high, 6px radius, with the active item in the same 13% tint and an orchid icon. Tooltips are inverted (ink on ground), 12.5px, and appear after a 320ms delay.

### Chips and tags
Chips are pills with a 13% orchid tint and ink text; priority chips use a 14% or 16% tint of the priority colour with text in that colour. Tags are pills with a hairline border and `--text-2` text.

### Calendar
Hour lines are structure and use `--line-c`. Today is a neutral 3% ink tint plus an orchid date pill. Events and blocks are their hue at 20% over the ground with an inset 3px bar. Read-only Google events add a faint hatch. A ghost (done elsewhere or pending) is transparent with an outline.

### Habits and focus
Habit cards are surface cards with square 26px hue cells, a dashed outline on today while it is open, and a Martian Mono streak count at the end. The heatmap ramps the habit hue into `--raised` in OKLab at 0, 28, 52, 76 and 100%. The overview heatmap does the same with orchid. Focus is a large Martian Mono clock, one 3px orchid progress line, and a task row in the Today style.

### Milestone (signature)
When a habit streak hits a milestone, a pill line rises in and the orchid moment dot lands last, over 600ms. It is the only place `--dur-4` is used.

### Identity: the chi and the moment dot
The wordmark is the lowercase word "xairos" beside a hand-drawn calligraphic chi (main stroke 12.5, crossing stroke 5). An orchid moment dot (radius 7.6) sits on the crossing, ringed in the ground colour. The chi itself is never orchid. Below 20px tall, or in one colour, the dot takes the ink colour or is dropped. The app mark is the orchid chi on the ground. Sources are `assets/wordmark.svg` and `assets/icon.svg`; the PNGs come from `npm run icons`.

### Icons
Icons are inlined SVG strings in `src/ui/icons.ts`, Lucide-style rounded line icons on a 24-unit grid with `currentColor`. No emoji or Unicode glyphs as icons. The target stroke is 1.5px (brand rule), but the shipped file uses 1.8 for most icons (25 of 42 icons), 2 for 12, 2.4 for two (including the check mark), 2.6 for one and 3 for two. This is recorded as drift from the rule, not as a decision. Icon sizes in the UI are 12px (carets, meta), 14 to 16px (inline), 18 to 22px (buttons, rail).

### Motion
- **Durations:** `--dur-1` 120ms (press, hover, checkbox), `--dur-2` 200ms (popover, toast, section caret), `--dur-3` 320ms (panel, sheet, tooltip delay), `--dur-4` 600ms (the streak milestone only).
- **Easing:** `--ease-out` is `cubic-bezier(.16,1,.3,1)` for entrances. `--ease-exit` is `cubic-bezier(.3,0,.8,.15)` for exits. Exits are faster than entrances. No bounce.
- **Completing a task:** the check draws over 160ms, the strike runs left to right, then the row slides 8px and fades over 180ms (the choreography is called M4).
- **Kept as decisions:** the sync spinner (1s linear, rotates), the focus progress line (`.f-track b`, scaleX over 260ms linear, so the line moves continuously between 250ms updates), and the completion choreography above.
- **Reduced motion:** opacity-only overrides are shipped for these: the toast (no slide, opens over `--dur-2`, closes over `--dur-1` with `--ease-exit`), the phone drawer (no slide, fades in and out, ignores taps while closed), and the section and sidebar carets (no rotation transition; the open and closed angle stays). The Today row exit, popovers, reminder cards, the detail overlay and the milestone were already fades. Kept on purpose as activity signals: the sync spinner, the `.f-track b` scaleX and the completion choreography. This is checked from the CSS only, not live: reduced motion was never emulated in a browser. This is a deliberate, approved exception.
- **Entrance and exit pairs:** the toast and the phone drawer close faster than they open (`--dur-1` with `--ease-exit` against `--dur-2` with `--ease-out`). Tooltip delay is `--dur-3` and the caret turns over `--dur-1`.
- Animate transforms and opacity. Do not animate height.

## Do's and Don'ts

### Do:
- **Do** read tokens from `src/ui/tokens.css`: `--ground`, `--surface`, `--raised`, `--line-c`, `--text`, `--text-2`, `--text-3`, `--accent`, `--on-accent`, `--accent-line`, `--prio-*`, `--success`, `--info`, `--warning`, `--danger-c`.
- **Do** use orchid as a solid fill on one small thing, or as an OKLab tint: 9% for selected rows, 13% for active nav.
- **Do** set Martian Mono at 0.88 of the text beside it, and only for short real data.
- **Do** use `--radius-lg` (8px) for cards and popovers, `--radius-sm` (6px) for buttons and inputs, and the pill for chips only.
- **Do** keep surfaces flat with 1px `--line-c` hairlines, and use `--shadow-pop` only on floating things.
- **Do** use `--text-2` for text on surface, raised and side backgrounds in dark mode. `--text-3` is 4.16, 3.66 and 4.37 to 1 there, under the 4.5 minimum. A block at the end of `src/style.css` (scoped to `:root[data-mode="dark"]`) moves those texts to `--text-2`: side counts and section heads, row meta and done titles, quick-add, search and Focus placeholders, stat labels, habit info and weekday labels, reminder subtext, the popover hints, labels, notes and member lines, and the kanban column counts (`.sec-h .n`) and `.kc-add` "Add task". There is no token change, and `--text-3` stays `#7E8168`. Icons, borders, the checkbox outline and the today ring keep `--text-3`, which needs only 3:1. `--ground` and `--rail-c` pass and are untouched.
- **Do** use `--danger-c` for fills and icons, and `--danger-text` for danger text on popovers and selected rows. Light `--danger-c` is under 4.5:1 as text on `--raised` and on selected backgrounds.
- **Do** give warning and danger an icon or shape as well as colour.
- **Do** respect `prefers-reduced-motion` and keep exits faster than entrances.
- **Do** give new phone controls a 44px hit area at 760px and below. Keep the drawn size where the board draws it and use an `::after` hit area; use a real box only where nothing is drawn at rest.

### Don't:
- **Don't** mix orchid in OKLCH, and don't use it as a text colour or a large fill.
- **Don't** put a raw hex, `rgb()` or `hsl()` in `src/style.css` or `src/views/*`.
- **Don't** use the remaining legacy aliases in new code. Removed in the brand clean-up: `--primary`, `--grey`, `--bg`, `--pop` and `--t1` to `--t4`. Still in `tokens.css` and read by `src/style.css`: `--on-primary`, `--rail`, `--side`, `--hover`, `--p-high`, `--p-med`, `--p-low`, `--danger`, `--toast-link`, `--line`, `--shadow`, `--radius`, `--font`, `--font-head` and `--font-num`. They exist only until the remaining views move onto the named tokens.
- **Don't** use `--danger-text` for fills or icons, or `--danger-c` for text on `--raised` or a selected row.
- **Don't** use Martian Mono for labels, names or long strings, beyond the four documented exceptions.
- **Don't** add `scrollbar-gutter` to `.content` on phone, or show its scrollbar there, without a new decision.
- **Don't** use `--dur-4` for anything except the streak milestone.
- **Don't** add bounce, long ease curves or height animation.
- **Don't** use emoji or Unicode glyphs as icons.
- **Don't** add a user accent picker or user themes. The brand is fixed.
- **Don't** colour the chi orchid, or place an orchid badge next to a high-priority dot.
- **Don't** use a body weight below 400.
