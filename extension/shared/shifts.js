// shared/shifts.js — fetch and aggregate Autocab driver shifts.
// The portable half of the old background.js: no chrome.* anywhere, so this same
// file runs in the MV3 service worker today and in the Cloudflare Worker later.
// Keep it that way — the moment it touches chrome.storage it stops being shared.
// (Modules are strict by default, so no "use strict" needed.)

export const API_URL = "https://autocab-api.azure-api.net/driver/v1/drivershifts/search";
export const DEFAULTS = { companyId: 1, longShiftHours: 8 };

// The API takes UTC but its data is UK wall-clock. Deriving "midnight" from the
// host's local time only holds while the host runs on UK time — true in an
// operator's browser, false on Cloudflare Workers, which are always UTC. So the
// zone is stated here and never inferred.
export const TZ = "Europe/London";

const PARTS = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const wallClock = (date) => Object.fromEntries(
    PARTS.formatToParts(date)
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, Number(value)]),
);

// Minutes TZ is ahead of UTC at this instant: 0 in GMT, 60 in BST.
const offsetMinutes = (date) => {
    const { year, month, day, hour, minute, second } = wallClock(date);
    return (Date.UTC(year, month - 1, day, hour, minute, second)
        - Math.floor(date.getTime() / 1000) * 1000) / 60000;
};

// Midnight in TZ, N days back, as a UTC ISO string. A naive "T00:00:00Z" would
// silently drop shifts that started between midnight and 1am BST.
export function localMidnightUtc(daysAgo = 0, now = new Date()) {
    const { year, month, day } = wallClock(now);
    // Midnight in TZ, first written as though TZ were UTC…
    const naive = Date.UTC(year, month - 1, day - daysAgo);
    // …then shifted by whatever offset is actually in force at that moment.
    return new Date(naive - offsetMinutes(new Date(naive)) * 60000).toISOString();
}


// "06:49:03", "12:08:58.9515174", or "36.19:40:09.68" — .NET TimeSpan, where a
// leading "d." appears once the span passes 24h. Missing that silently turns a
// 37-hour shift into a 1-hour one.
export function durationToSeconds(text) {
    const m = String(text || "").match(/^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})/);
    if (!m) return 0;
    const [, d, h, mi, s] = m;
    return (+(d || 0)) * 86400 + (+h) * 3600 + (+mi) * 60 + (+s);
}

// `total` is a string ("£102.60"). Cash + rank + account + loyalty *nearly*
// reproduces it, but misses "< Premium App >" bookings — the API folds those
// into `total` and `totalCost` without giving them a field or a counter of
// their own (24 of 670 shifts on 2026-08-04, up to £46 each). So parse `total`.
export const money = (text) => Number(String(text || "").replace(/[^\d.-]/g, "")) || 0;

const shiftEarnings = (s) => money(s.total);

export async function fetchShifts({ apiKey, companyId }, now = new Date()) {
    const res = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": apiKey,
        },
        // From yesterday, so a shift that began before midnight and is still open
        // is included. summarise() then drops yesterday's *closed* shifts.
        body: JSON.stringify({
            from: localMidnightUtc(1, now),
            to: now.toISOString(),
            companyId,
            drivers: [],
            vehicles: [],
        }),
    });
    if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
    return res.json();
}

export function summarise(shifts, longShiftHours, now = new Date()) {
    // Already UK midnight as UTC — do NOT setHours() this, that would re-derive
    // it from the host clock and land 23h early anywhere the host runs UTC.
    const todayStart = new Date(localMidnightUtc(0, now));
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

// The one call both hosts make: the MV3 service worker today, the Cloudflare
// Worker later. Threading `now` through keeps the fetch window and the
// today-filter on the same side of midnight.
export async function loadSummary({ apiKey, companyId, longShiftHours }, now = new Date()) {
    const shifts = await fetchShifts({ apiKey, companyId }, now);
    return summarise(shifts, longShiftHours, now);
}