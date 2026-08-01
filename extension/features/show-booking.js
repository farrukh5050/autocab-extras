// features/show-booking.js — the Extras menu: report the selected booking.
(() => {
  "use strict";
  const AE = window.AutocabExtras;

  function describe(row) {
    return `Booking · ${row.pickupTime} · ${row.status} · ${row.zone}`;
  }

  function showBooking() {
    const row = AE.readSelectedRow();
    console.log("[Autocab Extras] selected booking:", row);
    AE.showToast(row ? describe(row) : "No booking selected");
  }

  AE.registerButton({
    id: "extras",
    title: "Extras",
    icon: "fa-bolt",
    mode: "menu",
    items: [
      {
        id: "show-booking",
        label: "Show selected booking",
        icon: "fa-receipt",
        contextMenu: true,
        run: showBooking,
      },
    ],
  });
})();