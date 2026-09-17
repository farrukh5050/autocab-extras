// features/email-driver-sheet.js — one click: draft-process the selected driver
// and email them their sheet, from the jobprocessor Driver Accounts grid.
//
// The app's own route is Draft Process → dialog → "save a copy?" → confirm:
// three OKs to send one sheet. This posts the same request that dialog posts.
// `printDriverSheet:false` is the one deliberate difference — the app sends
// true, which is what raises its save-a-copy prompt. We only want the email.
//
// This WRITES to the live accounts ledger and mails a real driver, with no
// confirmation by design. The guards are therefore against the accident, not
// the intent: an in-flight lock and a per-driver cooldown, so a double-click,
// a slow response or a jumpy hand cannot send twice.
(() => {
  "use strict";
  const AE = window.AutocabExtras;

  const PATH = "/api/ghost/v1/accounts/driveraccounts/{id}/draftprocessdriver";
  const COOLDOWN_MS = 30000;
  const sentAt = new Map();            // driverId -> ms of last successful send
  let inFlight = false;

  // The API host carries a per-tenant hash (ghost-main-<hash>.ghostapi.app:29003)
  // and the session token is a JWT the app parks in localStorage. Both are found
  // by shape rather than by key name, so this survives an Autocab rename and
  // works for every operator without a per-tenant build.
  function scanStorage(re) {
    for (const key of Object.keys(localStorage)) {
      let value = "";
      try { value = localStorage.getItem(key) || ""; } catch { continue; }
      const hit = value.match(re);
      if (hit) return hit[0];
    }
    return null;
  }
  const apiHost = () => scanStorage(/https:\/\/[\w.-]*ghostapi\.app(?::\d+)?/i);
  const authToken = () => scanStorage(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);

  // Columns are drag-reorderable (gvs-header-cell is cdkdrag), so positions are
  // only valid for the grid as it looks right now. Rebuild on every read.
  function columnIndex(grid, label) {
    const heads = [...grid.querySelectorAll("gvs-header-cell")];
    return heads.findIndex((h) => h.innerText.trim() === label);
  }

  // data-key on the row is the driverId the API takes — confirmed against
  // `driverID` in the GET /driveraccounts/{id} response. Never scrape the
  // Driver Id column for this; the row attribute is the authoritative one.
  //
  // Second gate, behind the `route` check on the menu item: every grid in this
  // app puts *some* id in data-key, so before treating one as a driverId we
  // confirm the grid is actually the driver-accounts grid. Getting this wrong
  // means draft-processing an unrelated driver who happens to own that number.
  function selectedDriver() {
    const row = document.querySelector("gvs-body-row.selected");
    const id = row?.dataset.key;
    if (!id) return null;
    const grid = row.closest("ghost-vs-table");
    if (!grid) return null;
    const cell = (label) => {
      const i = columnIndex(grid, label);
      return i >= 0 ? row.children[i]?.innerText.trim() || "" : "";
    };
    // Both columns exist only on the driver-accounts grid.
    if (columnIndex(grid, "Driver Callsign") < 0 || columnIndex(grid, "Driver Id") < 0) return null;
    return {
      id,
      callsign: cell("Driver Callsign") || id,
      name: cell("Driver Name"),
      balance: cell("Current Balance"),
    };
  }

  function label(d) {
    return [d.callsign, d.name, d.balance].filter(Boolean).join(" · ");
  }

  async function emailSheet() {
    const d = selectedDriver();
    if (!d) { AE.showToast("Select a driver row first"); return; }

    if (inFlight) return;                       // a second click while one is open
    const last = sentAt.get(d.id);
    if (last && Date.now() - last < COOLDOWN_MS) {
      AE.showToast(`Already emailed ${d.callsign} moments ago — ignored`);
      return;
    }

    const host = apiHost();
    const token = authToken();
    if (!host || !token) {
      AE.showToast("Couldn't read the API session — reload the page and retry");
      return;
    }

    inFlight = true;
    AE.showToast(`Emailing sheet — ${label(d)}…`);
    try {
      const res = await fetch(host + PATH.replace("{id}", encodeURIComponent(d.id)), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authentication-Token": token,
        },
        body: JSON.stringify({
          emailBody: null,               // null = the template configured in settings
          emailSubject: null,
          printDriverSheet: false,       // true is what triggers the save-a-copy prompt
          sendAsEmail: true,
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      sentAt.set(d.id, Date.now());
      // The toast is the only feedback there is, so it names who was mailed —
      // that is what makes a wrong-row send visible straight away.
      AE.showToast(`Sheet emailed — ${label(d)}`);
    } catch (e) {
      AE.showToast(`Email FAILED for ${d.callsign}: ${e.message}`);
    } finally {
      inFlight = false;
    }
  }

  // mode:"menu" rather than "action" — an action button registers no `items`,
  // and the context menu is built from items, so an action feature would have
  // no trigger here (jobprocessor has no toolbar to host one).
  AE.registerButton({
    id: "driver-sheet",
    title: "Driver Sheet",
    icon: "fa-envelope",
    mode: "menu",
    items: [
      {
        id: "email-driver-sheet",
        label: "Email Driver Sheet",
        icon: "fa-envelope",
        contextMenu: true,
        apps: ["jobprocessor"],
        route: "driver-accounts",      // NOT the docket, customer or sheet-history grids
        run: emailSheet,
      },
    ],
  });
})();
