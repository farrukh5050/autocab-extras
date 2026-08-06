// background.js — service worker. Fetches driver shifts from the Autocab API,
// aggregates them per driver, and serves a small summary to the dispatch widget.
// The API key never leaves storage. The summary names drivers, but only those
// still on shift and past the long-shift threshold (see `longShifts`).
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

// "06:49:03", "12:08:58.9515174", or "36.19:40:09.68" — .NET TimeSpan, where a
// leading "d." appears once the span passes 24h. Missing that silently turns a
// 37-hour shift into a 1-hour one.
function durationToSeconds(text) {
  const m = String(text || "").match(/^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (+(d || 0)) * 86400 + (+h) * 3600 + (+mi) * 60 + (+s);
}

// `total` is a string ("£102.60"). Cash + rank + account + loyalty *nearly*
// reproduces it, but misses "< Premium App >" bookings — the API folds those
// into `total` and `totalCost` without giving them a field or a counter of
// their own (24 of 670 shifts on 2026-08-04, up to £46 each). So parse `total`.
const money = (text) => Number(String(text || "").replace(/[^\d.-]/g, "")) || 0;
const shiftEarnings = (s) => money(s.total);

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
      d = {
        callsign: s.driverCallsign, name: s.driver?.fullName || "",
        seconds: 0, breakSeconds: 0, cash: 0, account: 0,
        earnings: 0, open: false
      };
      byDriver.set(id, d);
    }
    d.seconds += durationToSeconds(s.shiftLength);
    d.breakSeconds += s.longBreakDurationInSeconds || 0;
    d.cash += s.cashBookingsTotal || 0;
    d.account += s.accountBookingsTotal || 0;
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

  // Still on shift, and today's fragments add up past the threshold. `hours` is
  // gross time signed on, so a driver who signed on and off six times shows one
  // real day. perHour uses `total`, so in-app takings aren't dropped.
  const longShifts = drivers
    .filter((d) => d.open && d.seconds > longShiftHours * 3600)
    .sort((a, b) => b.seconds - a.seconds)
    .map((d) => ({
      callsign: d.callsign,
      name: (d.name || "").replace(/\s+/g, " ").trim(),   // API double-spaces names
      hours: round2(d.seconds / 3600),
      cash: round2(d.cash),
      account: round2(d.account),
      total: round2(d.earnings),
      perHour: d.seconds ? round2(d.earnings / (d.seconds / 3600)) : 0,
    }));

  return {
    onShiftNow: drivers.filter((d) => d.open).length,
    overLong: drivers.filter((d) => d.open && d.seconds > longShiftHours * 3600).length,
    overLongToday: drivers.filter((d) => d.seconds > longShiftHours * 3600).length,
    longShiftHours,
    longShifts,
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