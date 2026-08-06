// management.js — adds a single "Extension" button to the Management app's sidebar.
// Clicking it renders our own page into the app's main content area, listing every
// registered feature as a tile with an on/off switch. Tiles never run anything —
// they only write to chrome.storage.
(() => {
  "use strict";
  const AE = window.AutocabExtras;
  const NAV_ID = "autocab-extras-nav";
  const PAGE_ID = "autocab-extras-page";
  const CSS_ID = "autocab-extras-css";

  // Mirrors the app's own .tile / .page-content-body styling.
  const CSS = `
    #${PAGE_ID} { height:100%; width:100%; box-sizing:border-box; padding:40px;
      display:flex; flex-flow:wrap; align-content:flex-start; overflow-y:auto;
      background:#fff; color:rgb(63,97,111);
      font-family:ZonaProRegular,Arial,Helvetica,sans-serif; }
    #${PAGE_ID} .ae-tile { width:300px; height:300px; margin:15px 10px; background:#fff;
      border-radius:15px; box-shadow:5px 5px 20px rgb(175,175,175); display:flex;
      flex-direction:column; align-items:center; padding:28px 20px;
      box-sizing:border-box; cursor:pointer; transition:box-shadow .15s; }
    #${PAGE_ID} .ae-tile:hover { box-shadow:5px 5px 24px rgb(150,150,150); }
    #${PAGE_ID} .ae-tile h3 { margin:0; text-align:center; color:rgb(63,97,111);
      font:300 22px/1.25 ZonaProLight,Arial,sans-serif; }
    #${PAGE_ID} .ae-icon { flex:1; display:flex; align-items:center;
      font-size:60px; opacity:.85; }
    #${PAGE_ID} .ae-sw { position:relative; flex:none; width:52px; height:28px;
      border-radius:28px; background:#c8d1d5; transition:.15s; }
    #${PAGE_ID} .ae-sw::before { content:""; position:absolute; top:3px; left:3px;
      width:22px; height:22px; border-radius:50%; background:#fff; transition:.15s;
      box-shadow:0 1px 3px rgba(0,0,0,.3); }
    #${PAGE_ID} .ae-tile[aria-checked="true"] .ae-sw { background:#4caf50; }
    #${PAGE_ID} .ae-tile[aria-checked="true"] .ae-sw::before { transform:translateX(24px); }
    #${PAGE_ID} .ae-state { margin-top:10px; font-size:12px; letter-spacing:.08em;
      text-transform:uppercase; opacity:.55; }
  `;

  function paint(tile, on) {
    tile.setAttribute("aria-checked", String(on));
    tile.querySelector(".ae-state").textContent = on ? "On" : "Off";
  }

  function buildTile(feature) {
    const tile = document.createElement("div");
    tile.className = "ae-tile";
    tile.dataset.aeId = feature.id;
    tile.setAttribute("role", "switch");
    tile.setAttribute("tabindex", "0");

    const h = document.createElement("h3");
    h.textContent = feature.label;
    const iconWrap = document.createElement("div");
    iconWrap.className = "ae-icon";
    const i = document.createElement("i");
    i.className = "fal " + (feature.icon || "fa-circle");
    iconWrap.appendChild(i);
    const sw = document.createElement("div");
    sw.className = "ae-sw";
    const state = document.createElement("div");
    state.className = "ae-state";
    tile.append(h, iconWrap, sw, state);
    paint(tile, true);                 // syncTiles() corrects this

    const toggle = () => {
      const on = tile.getAttribute("aria-checked") !== "true";
      paint(tile, on);                 // optimistic
      AE.setEnabled(feature.id, on);
    };
    tile.addEventListener("click", toggle);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    return tile;
  }

  // Storage is the source of truth; a missing key means ON.
  function syncTiles() {
    document.getElementById(PAGE_ID)?.querySelectorAll(".ae-tile")
      .forEach((t) => paint(t, AE.isOn(t.dataset.aeId)));
  }

  // ---- our page in the app's main content area ----------------------------
  let savedTitle = null;
  const titleEl = () => document.querySelector("user-panel .page-title h2 span");

  function showPage() {
    const host = document.querySelector("div.page-content");
    if (!host || document.getElementById(PAGE_ID)) return;
    AE.css(CSS_ID, CSS);

    // Park whatever the router rendered; hidePage() puts it back.
    for (const child of host.children) {
      child.dataset.aeHidden = "1";
      child.style.display = "none";
    }

    const page = document.createElement("div");
    page.id = PAGE_ID;
    for (const f of AE.features()) page.appendChild(buildTile(f));
    host.appendChild(page);

    const link = document.getElementById(NAV_ID)?.querySelector("a.parent-menu-option-link");
    link?.classList.add("active");
    const t = titleEl();
    if (t) { if (savedTitle === null) savedTitle = t.textContent; t.textContent = "Extension"; }
    syncTiles();
  }

  function hidePage() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    page.remove();
    document.querySelectorAll("[data-ae-hidden]").forEach((el) => {
      el.style.display = "";
      delete el.dataset.aeHidden;
      if (!el.getAttribute("style")) el.removeAttribute("style");
    });
    const link = document.getElementById(NAV_ID)?.querySelector("a.parent-menu-option-link");
    link?.classList.remove("active");
    const t = titleEl();
    if (t && savedTitle !== null) t.textContent = savedTitle;
    savedTitle = null;
  }

  // ---- the sidebar button ------------------------------------------------
  function ensureNav() {
    const list = document.querySelector("sidebar .sidebar ul.parent-list");
    if (!list || document.getElementById(NAV_ID)) return;  // not Management, or already added
    const parentTpl = list.querySelector(":scope > li");
    if (!parentTpl) return;                                // sidebar still rendering

    const li = parentTpl.cloneNode(true);       // inherits the Angular-scoped styling
    li.id = NAV_ID;
    li.querySelector("ul.child-list")?.remove();           // single button, nothing to expand

    const link = li.querySelector("a.parent-menu-option-link");
    link.removeAttribute("href");                          // we render the page ourselves
    link.classList.remove("active");
    li.querySelector(".parent-menu-option i").className = "icon fal fa-puzzle-piece";
    li.querySelector(".parent-menu-option-text").textContent = "Extension";
    li.querySelector(".parent-menu-option span.fal")?.remove();   // no chevron

    link.addEventListener("click", (e) => { e.preventDefault(); showPage(); });
    list.appendChild(li);
  }

  // Any real navigation tears our page down and hands the area back to Angular.
  window.addEventListener("hashchange", hidePage);
  document.addEventListener("click", (e) => {
    const nav = e.target.closest?.("a.parent-menu-option-link, a.subMenu");
    if (nav && !nav.closest("#" + NAV_ID)) hidePage();
  });

  AE.onChange(syncTiles);
  // Wait for the first <li>, not just the <ul> — ensureNav needs one to clone.
  AE.waitFor("sidebar .sidebar ul.parent-list > li", ensureNav);
})();