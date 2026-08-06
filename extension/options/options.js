// options.js — stores the API key and settings, and proves the API call works.
// Loaded as a module (see options.html), so it can share DEFAULTS with the
// service worker rather than repeating the numbers. Extension pages may be
// modules; content scripts may not.
import { DEFAULTS } from "../shared/shifts.js";

const $ = (id) => document.getElementById(id);

function show(text) {
  const el = $("status");
  el.textContent = text;
  el.style.display = "block";
}

if (!chrome?.storage?.local) {
  show("No extension APIs here.\n\n" +
       "Open this page from chrome://extensions → Details → Extension options, " +
       "not by opening options.html as a file.");
  throw new Error("options.html loaded outside the extension");
}

chrome.storage.local.get(["apiKey", "companyId", "longShiftHours"], (d) => {
  $("apiKey").value = d.apiKey || "";
  $("companyId").value = d.companyId ?? DEFAULTS.companyId;
  $("longShiftHours").value = d.longShiftHours ?? DEFAULTS.longShiftHours;
});

$("save").addEventListener("click", () => {
  chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    companyId: Number($("companyId").value) || DEFAULTS.companyId,
    longShiftHours: Number($("longShiftHours").value) || DEFAULTS.longShiftHours,
  }, () => show("Saved."));
});

$("test").addEventListener("click", () => {
  show("Fetching…");
  chrome.runtime.sendMessage({ type: "getShiftSummary", force: true }, (s) => {
    if (!s) { show("No response — is the service worker registered?"); return; }
    if (s.error) { show("Error: " + s.error); return; }
    show([
      `On shift now:     ${s.onShiftNow}`,
      `Over ${s.longShiftHours}h:          ${s.overLong}`,
      `Takings today:    £${s.takings.toFixed(2)}`,
      `£/hour gross:     £${s.perHourGross.toFixed(2)}`,
      `£/hour net:       £${s.perHourNet.toFixed(2)}`,
      `Drivers / shifts: ${s.driverCount} / ${s.shiftCount}`,
    ].join("\n"));
  });
});