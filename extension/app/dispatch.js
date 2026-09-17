// dispatch.js — everything we add to the dispatch app: top-bar buttons with
// dropdown panels, and items in the right-click context menu.
// The Management app has no `user-panel .actions`, so the buttons no-op there.
(() => {
  "use strict";
  const AE = window.AutocabExtras;
  const BTN = "autocab-extras-btn";
  const ITEM = "autocab-extras-item";

  const items = (b) => (b.items || []).filter((i) => AE.isOn(i.id));
  // A menu button with nothing switched on would open an empty panel — hide it.
  const buttons = () =>
    AE.buttons.filter((b) => AE.isOn(b.id) && (b.items ? items(b).length : true));

  AE.css("autocab-extras-dispatch-css", `
    .ae-panel { position:fixed; z-index:2147483647; min-width:240px; padding:6px;
      background:#2b2b2b; color:#fff; border-radius:8px;
      box-shadow:0 6px 24px rgba(0,0,0,.4); font:14px/1.4 system-ui,sans-serif; }
    .ae-panel h4 { margin:0; padding:8px 10px; font-size:11px; font-weight:400;
      letter-spacing:.08em; opacity:.6; }
    .ae-panel button { display:flex; align-items:center; gap:10px; width:100%;
      padding:10px; border:none; border-radius:6px; background:none; color:#fff;
      font:inherit; text-align:left; cursor:pointer; }
    .ae-panel button:hover { background:rgba(255,255,255,.12); }
    .ae-panel button i { width:16px; }
  `);

  // ---- top-bar buttons + panels ------------------------------------------
  let panel = null, panelOwner = null;

  function hidePanel() {
    if (panel) { panel.remove(); panel = null; panelOwner = null; }
  }

  function showPanel(cfg, btnEl) {
    if (panelOwner === cfg.id) { hidePanel(); return; }
    hidePanel();
    panel = document.createElement("div");
    panel.className = "ae-panel";
    panel.style.visibility = "hidden";
    const h = document.createElement("h4");
    h.textContent = cfg.title.toUpperCase();
    panel.appendChild(h);

    for (const it of items(cfg)) {          // built fresh, so always current
      const row = document.createElement("button");
      row.type = "button";
      const i = document.createElement("i");
      i.className = "far " + (it.icon || "fa-circle");
      const span = document.createElement("span");
      span.textContent = it.label;
      row.append(i, span);
      row.addEventListener("click", () => { hidePanel(); it.run(); });
      panel.appendChild(row);
    }
    document.body.appendChild(panel);

    panelOwner = cfg.id;
    const r = btnEl.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    panel.style.left = Math.max(8, r.right - panel.getBoundingClientRect().width) + "px";
    panel.style.visibility = "visible";
  }

  function ensureButtons() {
    const actions = document.querySelector("user-panel .actions");
    if (!actions) return;
    const template = actions.querySelector(`.btn:not(.${BTN})`);

    for (const cfg of buttons()) {
      if (actions.querySelector(`[data-ae-id="${cfg.id}"]`)) continue;
      const btn = template ? template.cloneNode(true) : document.createElement("div");
      btn.className = "btn " + BTN;      // drop the native modifier, keep .btn styling
      btn.dataset.aeId = cfg.id;
      btn.title = cfg.title;
      let icon = btn.querySelector("i");
      if (!icon) { icon = document.createElement("i"); btn.appendChild(icon); }
      icon.className = "icon far " + cfg.icon;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (cfg.mode === "action") { hidePanel(); cfg.run(); }
        else showPanel(cfg, btn);
      });
      // Insert before the first native button so ours keep registry order.
      actions.insertBefore(btn, template);
    }
  }

  // ---- right-click context menu -------------------------------------------
  function addMenuItems(menu, retry = true) {
    if (menu.querySelector("." + ITEM)) return;
    const template = menu.querySelector("button.gvs-menu-item");
    // The CDK overlay can be inserted before its items are attached; the observer
    // won't fire for the menu again, so retry once next frame.
    if (!template) {
      if (retry) requestAnimationFrame(() => addMenuItems(menu, false));
      return;
    }
    for (const b of AE.buttons)
      for (const it of items(b)) {
        // All three sub-apps share this menu, and each has several grids whose
        // rows mean different things. `apps` narrows to the sub-app, `route` to
        // the screen — an item acting on a row id MUST set `route`, or it will
        // offer itself on a grid whose ids belong to something else entirely.
        // Neither key set means everywhere.
        if (!it.contextMenu) continue;
        if (it.apps && !it.apps.includes(AE.app)) continue;
        if (it.route && !location.hash.includes(it.route)) continue;
        const el = template.cloneNode(true);
        el.classList.add(ITEM);
        const icon = el.querySelector("i");
        if (icon) icon.className = (it.icon || "fa-bolt") + " fal";
        const label = el.querySelector(".gvs-menu-item-description");
        if (label) label.textContent = it.label;
        const sc = el.querySelector(".gvs-menu-item-shortcut");
        if (sc) sc.textContent = "";
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          it.run();
          document.body.click();
        });
        menu.appendChild(el);
      }
  }

  // ---- wiring -------------------------------------------------------------
  document.addEventListener("click", (e) => {
    if (panel && !panel.contains(e.target) && !e.target.closest("." + BTN)) hidePanel();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePanel(); });

  // Must watch body: the CDK overlay container doesn't exist until the first
  // right-click, so there's no narrower node to observe up front.
  new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const menu = n.matches?.("gvs-context-menu") ? n : n.querySelector?.("gvs-context-menu");
        if (menu) addMenuItems(menu);
      }
  }).observe(document.body, { childList: true, subtree: true });

  AE.waitFor("user-panel .actions", (actions) => {
    new MutationObserver(ensureButtons).observe(actions, { childList: true });
    AE.onChange(() => {
      hidePanel();
      document.querySelectorAll("." + BTN).forEach((el) => el.remove());
      ensureButtons();
    });
  });
})();