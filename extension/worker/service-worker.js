// worker/service-worker.js — the Chrome-only half: settings, cache, the alarm,
// and the one message the page can send. Every line here is glue that can never
// leave the extension. The shift logic itself lives in shared/shifts.js.

import { DEFAULTS, loadSummary } from "../shared/shifts.js";
const CACHE_KEY = "shiftSummary";
const ALARM = "ae-refresh-shifts";
const FRESH_MS = 60000;

function settings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiKey", "companyId", "longShiftHours"], (d) =>
      resolve({
        apiKey: d.apiKey || "",
        companyId: d.companyId ?? DEFAULTS.companyId,
        longShiftHours: d.longShiftHours ?? DEFAULTS.longShiftHours,
      }));
  });
}

async function refresh() {
  const cfg = await settings();
  let payload;
  if (!cfg.apiKey) {
    payload = { error: "no-key", fetchedAt: new Date().toISOString() };
  } else {
    try {
      payload = await loadSummary(cfg);
    } catch (e) {
      payload = { error: String(e.message || e), fetchedAt: new Date().toISOString() };
    }
  }
  await chrome.storage.local.set({ [CACHE_KEY]: payload });
  return payload;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "getShiftSummary") return;
  if (msg.force) { refresh().then(sendResponse); return true; }
  // Serve the cache if it's fresh, so ten open tabs cost one API call.
  chrome.storage.local.get(CACHE_KEY, (d) => {
    const cached = d[CACHE_KEY];
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
    if (cached && age < FRESH_MS) sendResponse(cached);
    else refresh().then(sendResponse);
  });
  return true;                    // keeps the channel open for the async reply
});

// A service worker is torn down whenever Chrome feels like it, so setInterval
// won't survive. Alarms do.
chrome.alarms.create(ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refresh(); });
chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);