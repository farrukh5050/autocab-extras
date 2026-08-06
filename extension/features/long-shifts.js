// features/long-shifts.js — panel listing drivers still on shift who have worked
// more than the configured number of hours today, with takings and £/hour.
// mode:"action" rather than an items menu: dispatch.js builds its panels from
// items with a run() each, which a content panel doesn't fit. So we build and
// tear down our own element, reusing .ae-panel for position:fixed and styling.
(() => {
  "use strict";
  const AE = window.AutocabExtras;
  const ID = "ae-long-shifts";

  // Every rule is id-scoped and states colour/background/font outright. The
  // dispatch app has global table/h4 styling, and an inherited colour loses to
  // any direct rule on the element — which is why the rows came out unreadable
  // when this leaned on .ae-panel's colour cascading down into the cells.
  AE.css("ae-long-shifts-css", `
    #${ID} { min-width:420px; max-height:60vh; overflow-y:auto;
      background:#2b2b2b; color:#fff; font:14px/1.4 system-ui,sans-serif;
      border-radius:8px; box-shadow:0 6px 24px rgba(0,0,0,.4); }
    #${ID} h4 { margin:0; padding:8px 10px; color:#fff; background:none;
      font:400 11px/1.4 system-ui,sans-serif; letter-spacing:.08em; opacity:.75; }
    #${ID} table { width:100%; border-collapse:collapse; background:none;
      color:#fff; font:inherit; }
    #${ID} tr { background:none; }
    #${ID} th, #${ID} td { padding:5px 8px; text-align:left; white-space:nowrap;
      background:none; color:#fff; font:inherit; }
    #${ID} th { font-size:11px; font-weight:400; letter-spacing:.06em;
      color:#b9c4cc; text-transform:uppercase; }
    #${ID} td { border-top:1px solid rgba(255,255,255,.12); }
    #${ID} tr:hover td { background:rgba(255,255,255,.06); }
    #${ID} .ae-num { text-align:right; font-variant-numeric:tabular-nums; }
    #${ID} .ae-msg { padding:10px; color:#fff; opacity:.8; }
  `);

  const hhmm = (h) => {
    const mins = Math.round(h * 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  };
  const gbp = (n) => "£" + Number(n || 0).toFixed(2);

  function close() { document.getElementById(ID)?.remove(); }

  // Anchored under our own top-bar button, right edges aligned.
  function place(box) {
    const btn = document.querySelector(`[data-ae-id="long-shifts"]`);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    box.style.top = r.bottom + 6 + "px";
    box.style.left = Math.max(8, r.right - box.getBoundingClientRect().width) + "px";
  }

  function message(box, text) {
    const p = document.createElement("div");
    p.className = "ae-msg";
    p.textContent = text;
    box.appendChild(p);
  }

  function render(box, summary) {
    box.textContent = "";
    const rows = summary.longShifts || [];

    const h = document.createElement("h4");
    h.textContent = summary.error
      ? "LONG SHIFTS"
      : `ON SHIFT OVER ${summary.longShiftHours}H — ${rows.length}`;
    box.appendChild(h);

    if (summary.error) {
      message(box, summary.error === "no-key"
        ? "No API key set — add one in the extension options."
        : summary.error);
      return;
    }
    if (!rows.length) {
      message(box, "Nobody over the threshold.");
      return;
    }

    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const [label, num] of [
      ["Driver", 0], ["Worked", 0], ["Cash", 1], ["Account", 1], ["£/h", 1],
    ]) {
      const th = document.createElement("th");
      th.textContent = label;
      if (num) th.className = "ae-num";
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const d of rows) {
      const tr = document.createElement("tr");
      for (const [text, num] of [
        [`${d.callsign}  ${d.name}`, 0],
        [hhmm(d.hours), 0],
        [gbp(d.cash), 1],
        [gbp(d.account), 1],
        [gbp(d.perHour), 1],
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        if (num) td.className = "ae-num";
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    box.appendChild(table);
  }

  // A content script outlives its extension. Reloading or auto-updating the
  // extension orphans every copy already injected into an open tab, and
  // `chrome.runtime` goes undefined there. Operators keep dispatch open all
  // day, so this is the normal state after any update, not an edge case.
  const orphaned = () => typeof chrome === "undefined" || !chrome.runtime?.id;

  function fail(box, text) {
    render(box, { error: text });
    place(box);
  }

  function open() {
    const box = document.createElement("div");
    box.id = ID;
    box.className = "ae-panel";      // position:fixed + dark styling from dispatch.js
    message(box, "Loading shifts…");
    document.body.appendChild(box);
    place(box);

    if (orphaned()) {
      fail(box, "Extension was updated — refresh this page to reconnect.");
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "getShiftSummary" }, (summary) => {
        if (!document.getElementById(ID)) return;   // closed while we waited
        // Reading lastError is what marks it handled. Ignoring it logs an
        // "unchecked" warning and leaves the panel stuck on "Loading…".
        const failed = chrome.runtime.lastError?.message;
        render(box, summary || { error: failed || "No response from the extension." });
        place(box);                                 // the table changed our width
      });
    } catch (e) {
      // Orphaning can also land between the check above and the send.
      fail(box, `${e.message || e} — refresh this page.`);
    }
  }

  document.addEventListener("click", (e) => {
    const box = document.getElementById(ID);
    if (box && !box.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  AE.registerButton({
    id: "long-shifts",
    title: "Drivers on long shifts",
    icon: "fa-clock",
    mode: "action",
    run: () => { if (document.getElementById(ID)) close(); else open(); },
  });
})();
