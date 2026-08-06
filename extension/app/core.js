// core.js — registry, shared helpers, and the enabled/disabled store.
(() => {
  "use strict";
  if (window.AutocabExtras) return;

  let enabled = {};                     // id -> bool; a missing key means ON
  const listeners = [];
  const notify = () => listeners.forEach((fn) => fn());

  chrome.storage.local.get("enabled", (d) => { enabled = d.enabled || {}; notify(); });
  chrome.storage.onChanged.addListener((c) => {
    if (!c.enabled) return;
    enabled = c.enabled.newValue || {};
    notify();
  });

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483647",
      background: "#323232", color: "#fff", padding: "10px 16px",
      borderRadius: "6px", font: "14px/1.4 system-ui, sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,.3)", maxWidth: "360px",
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function readSelectedRow() {
    const row = document.querySelector("gvs-body-row.selected");
    if (!row) return null;
    const cellText = (sel) => row.querySelector(sel)?.innerText.trim() || "";
    return {
      pickupTime: cellText("time-with-time-zone-cell"),
      status: cellText("booking-status-cell"),
      zone: cellText("zone-cell-tpl"),
      allCells: [...row.children].map((c) => c.innerText.trim()),
    };
  }

  window.AutocabExtras = {
    buttons: [],
    registerButton(cfg) { this.buttons.push(cfg); },
    showToast,
    readSelectedRow,

    // ---- enabled store: read synchronously, subscribe for changes ----------
    isOn(id) { return enabled[id] !== false; },
    setEnabled(id, on) { chrome.storage.local.set({ enabled: { ...enabled, [id]: on } }); },
    onChange(fn) { listeners.push(fn); fn(); },   // fires now, and on every change

    // Every toggleable feature: a menu button's items, or an action button itself.
    features() {
      return this.buttons.flatMap((b) =>
        b.items || [{ id: b.id, label: b.title, icon: b.icon }]);
    },

    // ---- DOM helpers -------------------------------------------------------
    css(id, text) {
      if (document.getElementById(id)) return;
      const el = document.createElement("style");
      el.id = id;
      el.textContent = text;
      document.head.appendChild(el);
    },
    // Angular may not have rendered at document_idle, and a quiet page produces
    // no mutations to react to. Bounded at 10s.
    waitFor(selector, fn) {
      let tries = 0;
      const t = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) { clearInterval(t); fn(el); }
        else if (++tries > 40) clearInterval(t);
      }, 250);
    },
  };
})();