# Autocab365 Extras

A Chrome extension (MV3) that adds custom controls to the Autocab365 web apps
(`dispatch`, `jobprocessor`, `management` — anything under `*.autocab365.com`).

Built at Street Cars, a Manchester taxi firm, against a **live production**
dispatch system. Everything currently in the extension either reads the page or
reads the Autocab API — nothing writes back into dispatch.

Distributed **unlisted** on the Chrome Web Store to Autocab operators. Free for now.

## What it does today

**In the dispatch app** — buttons appear in the top-right toolbar next to the
chat icon. Menu buttons open a dark dropdown; action buttons run on click and
toast the result. Items marked `contextMenu: true` also appear at the bottom of
Autocab's own right-click menu on a booking row.

| Feature | id | What it does |
| --- | --- | --- |
| Show selected booking | `show-booking` | Toasts pickup time, status and zone for the selected row; logs the full row to the console. |
| Copy booking details | `copy-booking` | Copies every cell of the selected row to the clipboard, pipe-separated. |
| Show zone of selection | `show-zone` | Toasts the selected booking's zone. |
| Count visible bookings | `count-bookings` | Counts the `gvs-body-row`s currently rendered in the grid. |
| Drivers on long shifts | `long-shifts` | Panel listing every driver **still on shift** who has worked more than the configured hours today, with cash, account and £/hour. Data comes from the Autocab API, not the page. |

**In the management app** — an **Extension** item is appended to the left
sidebar. Clicking it renders our own page into the app's content area: one tile
per feature with an on/off switch. The tiles are settings only — they never run
a feature, they just write to `chrome.storage`. Any real navigation tears the
page down and hands the content area back to Angular.

**Behind the scenes** — the service worker polls the Autocab driver-shifts API
every minute, aggregates it per driver, and caches one summary. Ten open dispatch
tabs therefore cost one API call, and the panel opens instantly.

## Architecture

```
Chrome Extension                        Autocab API (Azure APIM)
  core.js        registry + helpers       driver/v1/drivershifts/search
  features/*.js  one file per feature   ▲
  dispatch.js    toolbar + context menu │ Ocp-Apim-Subscription-Key
  management.js  sidebar + settings page│
  background.js  service worker ────────┘  (must be the SW — see below)
  options.*      API key + thresholds
        ▲ installed & auto-updated via Web Store
        │
   GitHub (source + CI)                    ┄┄▶ Cloudflare Worker (planned)
```

**Why the API call lives in the service worker:** the `Ocp-Apim-Subscription-Key`
header triggers a CORS preflight that the Azure gateway rejects from a page
origin. A content script simply cannot make this call. The worker holds
`host_permissions` and does it instead, so the key never enters the page and
never leaves `chrome.storage.local`.

## Layout

```
extension/
  manifest.json          # MV3; content scripts in load order
  core.js                # window.AutocabExtras: registry, enabled store, DOM helpers
  features/              # one file per feature, each self-registering
    show-booking.js
    quick-actions.js
    count-bookings.js
    long-shifts.js       #   the only one that talks to background.js
  dispatch.js            # toolbar buttons, dropdown panels, context-menu items
  management.js          # sidebar "Extension" item + the settings page of tiles
  background.js          # service worker: fetch, aggregate, cache, alarm refresh
  options.html/.js       # API key, company id, long-shift threshold, test button
index.html, driver-shift.js   # standalone scratch page (see Prototypes)
```

Load order matters: `core.js` creates the namespace, each `features/*.js`
registers into it, then `management.js` and `dispatch.js` render whatever was
registered. Content scripts share one global scope, which is what lets them talk
via `window.AutocabExtras`.

## How it works

**The registry.** Each file in `features/` calls
`AutocabExtras.registerButton({...})` with one of two modes:

- `mode: "menu"` — the toolbar button opens a dropdown listing its `items`.
- `mode: "action"` — clicking the toolbar button runs `run()` immediately.

Items may set `contextMenu: true` to *also* appear in the right-click menu.
`long-shifts` uses `mode: "action"` and builds its own panel, because a table of
content doesn't fit the "list of items with a `run()`" shape `dispatch.js` renders.

**Adding a feature** is two steps: create `features/my-thing.js` and add it to the
`js` array in `manifest.json`. Nothing else changes — the toolbar, the panels, the
context menu and the settings tiles all derive from the registry.

> Watch out: with the old toolbar-only trigger gone, a feature only has a
> right-click trigger if it sets `contextMenu: true`. A feature with neither a
> toolbar button nor that flag gets a settings tile that controls nothing.

**Enable/disable.** `management.js` writes one `enabled` object
(`{ "<id>": false, ... }`) to `chrome.storage.local`; an id absent from it counts
as ON. `core.js` reads that on load and listens for `chrome.storage.onChanged`,
so flipping a tile updates every open tab live with no reload. Button ids and
item ids share this one flat map — keep them distinct.

**DOM coupling.** We target Autocab's own markup: the toolbar
(`user-panel .actions`), the sidebar (`sidebar .sidebar ul.parent-list`), the
content area (`div.page-content`), the context menu (`gvs-context-menu` /
`button.gvs-menu-item`), and booking rows (`gvs-body-row.selected`, plus semantic
cells like `booking-status-cell`). Captured from dispatch **v1.36.2618.004** and
management **v0.36.2618.004**; these may shift when Autocab ships an update.
Every lookup **fails soft** — no injection rather than an exception thrown into a
live dispatch screen. New elements are built by *cloning* a native one so they
inherit the app's styling. Angular may not have rendered at `document_idle` and a
quiet page produces no later mutations, so `AE.waitFor()` polls for 10s and gives up.

**Content scripts outlive their extension.** Reloading or auto-updating the
extension orphans every copy already injected into an open tab, and
`chrome.runtime` goes `undefined` there. Operators keep dispatch open all day, so
this is the normal state after any update — `long-shifts.js` detects it and says
"refresh this page to reconnect" instead of hanging on "Loading…".

## The driver-shifts data, and its traps

`POST driver/v1/drivershifts/search`, body `{from, to, companyId, drivers: [], vehicles: []}`.
Five things about this data have each caused a wrong number at least once:

1. **An active shift is `ended: null`**, and its `shiftLength` is live and
   server-computed. Never calculate elapsed time yourself.
2. **`from`/`to` are UTC but `started` comes back `+01:00`.** A naive
   `T00:00:00Z` drops shifts that started 00:00–01:00 BST. We query from *local*
   midnight yesterday, or overnight shifts still running go missing entirely.
3. **Drivers sign on and off repeatedly** — one driver can have a dozen records,
   some seconds long. Aggregate on `driver.id`; row counts are meaningless. (The
   dispatch header's "N Drivers On Shift" counts *records*, not drivers.)
4. **`total` is a string (`"£102.60"`) and is the only complete money figure.**
   Cash + rank + account + loyalty does *not* reproduce it — it understates
   in-app bookings, which Autocab exports as account `< Premium App >` with no
   money field and no counter of their own. Parse `total`; don't rebuild it.
5. A "long shift" count is only actionable **filtered to open shifts** —
   otherwise it climbs all day and describes drivers who already went home.

The subscription key must be issued against the same Autocab account as the
dispatch login. A key belonging to a different operator returns a completely
different fleet with no error. Sanity-check driver callsigns against the Driver
Shifts grid (press `K` in dispatch) before trusting any figure.

## Settings

Open `chrome://extensions` → **Details** → **Extension options**:

- **Ocp-Apim-Subscription-Key** — from the Autocab API developer portal. Stored
  in this browser only; sent nowhere except Autocab.
- **Company ID** — Street Cars is `1`.
- **Long-shift warning (hours)** — default `10`.
- **Test connection** — forces a refresh and prints the summary, which is the
  fastest way to tell a bad key from a bad selector.

## Load the extension locally

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Set your API key in the options page.
5. Open a dispatch page and reload it.

> A 128×128 icon is required before Web Store submission but not for loading
> unpacked. Icons come with the publish phase.

## Roadmap

### Next: late-pickup alerts

The biggest planned feature, and the first one driven by **push** rather than
polling: alert operators when a passenger has not been picked up by the pickup
due time plus a grace period — a job that's been accepted but is going wrong,
surfaced before the customer rings in to complain.

A working prototype already exists outside this repo (`~/Desktop/extension`), as
a Node server plus a Tampermonkey userscript:

```
Autocab webhooks ──▶ Cloudflare tunnel ──▶ local Node server ──▶ job-tracker
                                                                     │
   dispatch screen ◀── flashing banner ◀── GET /alerts (poll 5s) ◀────┘
                        Acknowledge  ──▶ POST /alerts/ack
```

- Tracking **starts** on `BookingDispatchAccepted` and **stops** on
  `BookingPOB` (passenger on board — the success case), plus cancelled,
  modified, no-fare and complete.
- A monitor ticks every 60s. If a tracked job is still open past
  `PickupDueTime + ALERT_GRACE_MINUTES` (default 5), it alerts.
- The dispatch screen polls `/alerts` and renders a flashing red banner per
  overdue job — booking id, driver callsign and name, passenger, minutes
  overdue — with an **Acknowledge** button that silences the banner but keeps
  tracking the job so it still clears normally on pickup or cancellation.
- Tracked jobs persist to `tracked-jobs.json` so a restart doesn't lose them.

**Open questions before this ships in the extension:**

- Only `BookingDispatchAccepted` is confirmed from a real payload; the stop-event
  strings are inferred from the webhook event list and need verifying the first
  time each one fires.
- Accepted ≠ arrived. If the alert should key off the driver *arriving* rather
  than accepting, that's a different start event and needs identifying.
- `PickupDueTime` arrives as a naive local time (`"2026-08-05T12:15:00"`), which
  is only correct while the server runs on UK time, same as dispatch. Needs
  pinning down properly before it runs anywhere else.
- Webhooks need a public endpoint, so this cannot be extension-only — it's the
  feature that forces the backend phase below.

### Phases

- **Phase 1 — extension skeleton (done):** MV3 client, per-file feature registry,
  toolbar + context-menu injection, management sidebar page, DOM reads, toggles
  persisted to `chrome.storage`.
- **Phase 2 — driver-shifts data (done):** service worker fetch, per-driver
  aggregation, alarm refresh + cache, options page, the long-shifts panel.
- **Phase 3 — backend:** Cloudflare Worker + D1 to receive Autocab webhooks and
  hold state that can't live in a browser, plus Google token verification and a
  manual-approval gate so paid logic is served only to approved accounts.
  (Swappable for Firebase or self-hosted SQL later — the extension only ever
  talks to the Worker.)
- **Phase 4 — late-pickup alerts in the extension:** port the prototype onto the
  Worker; the extension subscribes and renders the banners.
- **Phase 5 — write actions:** features that ask the API to *change* something
  rather than only read. Nothing writes to live dispatch until there's an audit
  trail on the Worker.
- **Phase 6 — CI + Web Store:** GitHub Actions, obfuscated build, unlisted
  publish, auto-update.

## Prototypes

Scratch work that proved something, kept for reference and not part of the built
extension:

- `index.html` + `driver-shift.js` (repo root) — a standalone page listing every
  driver currently on shift in a table. Runs in a plain tab, prompts for the API
  key and keeps it in `sessionStorage`. Useful for eyeballing raw API fields
  without reloading the extension.
- `~/Desktop/extension` (outside this repo) — the webhook server, job tracker and
  userscript described above. Note that `tracked-jobs.json` holds **real booking
  data including passenger names and phone numbers**, which is one reason it
  lives outside the repo; don't commit it here.
