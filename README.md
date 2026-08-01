# Autocab365 Extras

A Chrome extension (MV3) that adds custom controls to the Autocab365 web apps
(`dispatch`, `jobprocessor`, `management` — anything under `*.autocab365.com`).

Distributed **unlisted** on the Chrome Web Store to Autocab operators. Free for now.

## Architecture

```
Chrome Extension (thin client) ──HTTPS+auth──▶ Cloudflare Worker (API)
  • core.js      shared helpers + registry     • verifies Google sign-in
  • buttons/*.js one file per toolbar button   • manual-approval gate
  • ui.js        injects toolbar + menus       • serves button config/logic
  • popup.*      per-feature on/off toggles    • D1: approvals + audit
        ▲ installed & auto-updated via Web Store
        │
   GitHub (source + CI): deploy Worker · publish extension
```

**Why this shape:** client extension code is always readable by whoever installs
it, so the valuable logic/endpoints live server-side and are served only to
**approved** accounts. Google sign-in identifies the user; a manual-approval
allowlist is the gate. Each operator's own Autocab session cookie is used
automatically, so one `@match` (`https://*.autocab365.com/*`) serves every
tenant and every sub-app with no per-tenant code.

## Layout

```
extension/
  manifest.json          # MV3; lists content scripts in load order
  core.js                # window.AutocabExtras: registry + shared helpers
  buttons/               # one file per toolbar button
    extras.js            #   menu button — "Show selected booking"
    quick-actions.js     #   menu button — copy details, show zone
    count-bookings.js    #   action button — runs on click, no dropdown
  ui.js                  # renders toolbar buttons, panels, context-menu items
  popup.html             # the popup UI + toggle-switch CSS
  popup.js               # renders a toggle per button/feature, persists state
backend/                 # Cloudflare Worker + D1 (later phase)
.github/workflows/       # deploy + publish (later phase)
```

Load order matters: `core.js` creates the namespace, each `buttons/*.js`
registers into it, then `ui.js` renders whatever was registered. Content scripts
share one global scope, which is what lets them talk via `window.AutocabExtras`.

## How it works

**The button registry.** Each file in `buttons/` calls
`AutocabExtras.registerButton({...})` with one of two modes:

- `mode: "menu"` — the toolbar button opens a dropdown panel listing its `items`.
- `mode: "action"` — clicking the toolbar button runs `run()` immediately.

Items may set `contextMenu: true` to *also* appear in the app's own right-click
menu on a booking row.

**Adding a button** is two steps: create `buttons/my-thing.js` and add it to the
`js` array in `manifest.json` (and the `<script>` list in `popup.html`). Nothing
else needs to change — the toolbar, the panels, the context menu, and the popup
toggles all derive from the registry.

**Enable/disable.** `popup.js` writes one `enabled` object
(`{ "<id>": false, ... }`) to `chrome.storage.local`; an id absent from it counts
as ON. `ui.js` reads that on load and listens for `chrome.storage.onChanged`, so
flipping a toggle updates the page live with no reload. Button ids and item ids
share this one flat map — keep them distinct.

**DOM coupling.** `ui.js` and `core.js` target Autocab's own markup: the toolbar
(`user-panel .actions`), the context menu (`gvs-context-menu` /
`button.gvs-menu-item`), and booking rows (`gvs-body-row.selected`,
`gvs-body-cell`, plus semantic cells like `booking-status-cell`). These were
captured from dispatch **v1.36.2618.004** and may shift when Autocab ships an
update — every lookup fails soft (no injection) rather than throwing into a live
dispatch screen. New toolbar buttons and menu items are built by *cloning* a
native element so they inherit the app's styling.

## Load the extension locally

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Open a dispatch page and reload it.

You should see the Extras buttons in the top-right toolbar next to the chat icon.
Menu buttons open a dark **EXTRAS** / **QUICK ACTIONS** dropdown; the count
button toasts immediately. Select a booking row, then right-click it — the
opted-in items appear at the bottom of Autocab's own menu. Left-click the
extension icon for the popup, where each button and feature has an on/off toggle
that persists.

> Note: a 128×128 icon is required before Web Store submission but not for loading
> unpacked. We'll add icons when we get to the publish phase.

## Roadmap

- **Phase 1 — extension skeleton (done):** MV3 client, per-file button registry,
  toolbar + context-menu injection, DOM reads, popup toggles persisted to
  `chrome.storage`.
- **Phase 2 — backend:** Cloudflare Worker + D1, Google token verification,
  manual-approval gate, serve config. (Swappable for Firebase or a self-hosted
  SQL server later — the extension only talks to the Worker.)
- **Phase 3 — wire together:** sign-in in the popup, features that call the API
  to perform audited actions rather than only reading the page.
- **Phase 4 — CI + Web Store:** GitHub Actions, obfuscated build, unlisted
  publish, auto-update.
