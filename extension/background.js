// background.js — service worker. Fetches driver shifts from the Autocab API,
// aggregates them per driver, and serves a small summary to the dispatch widget.
// The API key never leaves storage, and the summary carries no driver names.
"use strict";

const API_URL = "https://autocab-api.azure-api.net/driver/v1/drivershifts/search";
const CACHE_KEY = "shiftSummary";
const ALARM = "ae-refresh-shifts";
const DEFAULTS = { companyId: 1, longShiftHours: 10 };

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

// "06:49:03", or "12:08:58.9515174" on an open shift. Hours can exceed 24, so
// don't try to parse this as a clock time.
function durationToSeconds(text) {
  const parts = String(text || "").split(":");
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts;
  return (+h || 0) * 3600 + (+m || 0) * 60 + Math.floor(parseFloat(s) || 0);
}

// `total` is a string ("£102.60"); these four numerics reproduce it exactly.
// areaCharges is deliberately left out — the API excludes it from `total` too.
const shiftEarnings = (s) =>
  (s.cashBookingsTotal || 0) + (s.rankJobsTotal || 0) +
  (s.accountBookingsTotal || 0) + (s.loyaltyCardTotal || 0);

// Local midnight N days back, as UTC. The API takes Z but returns +01:00, so a
// naive "T00:00:00Z" silently drops shifts started between midnight and 1am BST.
function localMidnightUtc(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

async function fetchShifts({ apiKey, companyId }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
    },
    // From yesterday, so a shift that began before midnight and is still open
    // is included. summarise() then drops yesterday's *closed* shifts.
    body: JSON.stringify({
      from: localMidnightUtc(1),
      to: new Date().toISOString(),
      companyId,
      drivers: [],
      vehicles: [],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json();
}

function summarise(shifts, longShiftHours) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const byDriver = new Map();

  let counted = 0;

  for (const s of shifts) {
    const open = s.ended === null;
    // Today's shifts, plus any still-open shift that began earlier.
    if (!open && new Date(s.started) < todayStart) continue;
    counted++;

    // Drivers sign on and off repeatedly — one driver can have a dozen records,
    // several only seconds long. Aggregate, never count rows.
    const id = s.driver?.id ?? s.driverCallsign;
    let d = byDriver.get(id);
    if (!d) {
      d = { seconds: 0, breakSeconds: 0, earnings: 0, open: false };
      byDriver.set(id, d);
    }
    d.seconds += durationToSeconds(s.shiftLength);
    d.breakSeconds += s.longBreakDurationInSeconds || 0;
    d.earnings += shiftEarnings(s);
    d.open = d.open || open;
  }

  const drivers = [...byDriver.values()];
  const t = drivers.reduce((a, d) => ({
    seconds: a.seconds + d.seconds,
    breakSeconds: a.breakSeconds + d.breakSeconds,
    earnings: a.earnings + d.earnings,
  }), { seconds: 0, breakSeconds: 0, earnings: 0 });

  const grossHours = t.seconds / 3600;
  const netHours = Math.max(0, (t.seconds - t.breakSeconds) / 3600);
  const round2 = (n) => Math.round(n * 100) / 100;

  return {

    onShiftNow: drivers.filter((d) => d.open).length,
    overLong: drivers.filter((d) => d.seconds > longShiftHours * 3600).length,
    longShiftHours,
    takings: round2(t.earnings),
    perHourGross: grossHours ? round2(t.earnings / grossHours) : 0,
    perHourNet: netHours ? round2(t.earnings / netHours) : 0,
    driverCount: drivers.length,
    shiftCount: counted,
    fetchedCount: shifts.length,
    fetchedAt: new Date().toISOString(),
  };
}

async function refresh() {
  const cfg = await settings();
  let payload;
  if (!cfg.apiKey) {
    payload = { error: "no-key", fetchedAt: new Date().toISOString() };
  } else {
    try {
      payload = summarise(await fetchShifts(cfg), cfg.longShiftHours);
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
    if (cached && age < 60000) sendResponse(cached);
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