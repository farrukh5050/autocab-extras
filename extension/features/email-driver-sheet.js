// features/email-driver-sheet.js — one click: draft-process the selected driver
// and email them their sheet, from the jobprocessor Driver Accounts grid.
//
// The app's own route is Draft Process → dialog → "save a copy?" → confirm:
// three OKs to send one sheet. This posts the same request that dialog posts.
// `printDriverSheet:false` is the one deliberate difference — the app sends
// true, which is what raises its save-a-copy prompt. We only want the email.
//
// This WRITES to the live accounts ledger and mails a real driver. The confirm
// dialog is the gate against the wrong row; the in-flight lock is the guard
// against a double-click landing two sends. Repeat sends are deliberate and
// allowed — no cooldown.
(() => {
  "use strict";
  const AE = window.AutocabExtras;

  const PATH = "/api/ghost/v1/accounts/driveraccounts/{id}/draftprocessdriver";
  let inFlight = false;
  const DIALOG = "ae-driver-sheet-dialog";

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

  // Read-only on purpose: this is a confirm step, not an editor. The address
  // shown is the one the API will actually mail — draftprocessdriver takes no
  // recipient, it uses whatever is on the driver record — so an editable box
  // here would let an operator "fix" an address that the send then ignores.
  // Wrong address = fix it on the driver in Autocab.
  AE.css("ae-driver-sheet-css", `
    #${DIALOG} { position:fixed; inset:0; z-index:2147483646; display:flex;
      align-items:center; justify-content:center; background:rgba(0,0,0,.45); }
    #${DIALOG} .ae-box { min-width:380px; background:#2b2b2b; color:#fff;
      font:14px/1.4 system-ui,sans-serif; border-radius:8px; padding:16px;
      box-shadow:0 6px 24px rgba(0,0,0,.5); }
    #${DIALOG} h4 { margin:0 0 10px; color:#fff; background:none;
      font:400 11px/1.4 system-ui,sans-serif; letter-spacing:.08em; opacity:.75; }
    #${DIALOG} .ae-who { margin-bottom:10px; }
    #${DIALOG} input { width:100%; box-sizing:border-box; padding:7px 9px;
      border:1px solid rgba(255,255,255,.2); border-radius:4px;
      background:#1f1f1f; color:#fff; font:inherit; }
    #${DIALOG} .ae-btns { margin-top:14px; display:flex; gap:8px;
      justify-content:flex-end; }
    #${DIALOG} button { padding:7px 14px; border:0; border-radius:4px;
      font:inherit; cursor:pointer; background:#4a4a4a; color:#fff; }
    #${DIALOG} button.ae-go { background:#2e7d32; }
    #${DIALOG} button[disabled] { opacity:.5; cursor:default; }
  `);

  function closeDialog() {
    document.getElementById(DIALOG)?.remove();
    document.removeEventListener("keydown", onEsc);
  }
  const onEsc = (e) => { if (e.key === "Escape") closeDialog(); };

  // A content script outlives its extension: after a reload or auto-update
  // chrome.runtime is gone in tabs already open, which for an all-day dispatch
  // tab is the normal state, not an edge case.
  const orphaned = () => typeof chrome === "undefined" || !chrome.runtime?.id;

  function getDriver(id) {
    return new Promise((resolve) => {
      if (orphaned()) return resolve({ error: "Extension was updated — refresh this page." });
      try {
        chrome.runtime.sendMessage({ type: "getDriver", id }, (r) =>
          // Reading lastError is what marks it handled.
          resolve(r || { error: chrome.runtime.lastError?.message || "No response from the extension." }));
      } catch (e) {
        resolve({ error: `${e.message || e} — refresh this page.` });
      }
    });
  }

  function openDialog(d, email) {
    closeDialog();
    const wrap = document.createElement("div");
    wrap.id = DIALOG;
    wrap.innerHTML = `
      <div class="ae-box">
        <h4>EMAIL DRIVER SHEET</h4>
        <div class="ae-who"></div>
        <input type="email" readonly />
        <div class="ae-btns">
          <button class="ae-cancel">Cancel</button>
          <button class="ae-go">Send Email</button>
        </div>
      </div>`;
    wrap.querySelector(".ae-who").textContent = label(d);
    wrap.querySelector("input").value = email;
    wrap.querySelector(".ae-cancel").onclick = closeDialog;
    const go = wrap.querySelector(".ae-go");
    go.onclick = () => { go.disabled = true; closeDialog(); send(d); };
    wrap.onclick = (e) => { if (e.target === wrap) closeDialog(); };
    document.body.appendChild(wrap);
    go.focus();
    document.addEventListener("keydown", onEsc);
  }

  async function emailSheet() {
    const d = selectedDriver();
    if (!d) { AE.showToast("Select a driver row first"); return; }
    if (inFlight) return;

    const r = await getDriver(d.id);
    if (r.error) { AE.showToast(r.error); return; }
    if (!r.email) { AE.showToast(`No email address on ${d.callsign} — add one in Autocab`); return; }
    openDialog(d, r.email);
  }


  async function send(d) {
    // Re-checked here, not just at the dialog: the guards exist for the double
    // send, and the gap between opening the dialog and clicking Send is exactly
    // where a second one gets in.
    if (inFlight) return;

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
        route: "driver-accounts",      // Keytword to look for so this menue item can be shown
        run: emailSheet,
      },
    ],
  });
})();
