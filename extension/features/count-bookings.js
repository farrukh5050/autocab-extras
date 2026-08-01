// features/count-bookings.js — counts the booking rows currently in the grid.
(() => {
  "use strict";
  const AE = window.AutocabExtras;

  function countRows() {
    return document.querySelectorAll("gvs-body-row").length;
  }

  function countBookings() {
    const n = countRows();
    AE.showToast(`${n} booking row${n === 1 ? "" : "s"} visible`);
  }

  AE.registerButton({
    id: "count-bookings",
    title: "Count visible bookings",
    icon: "fa-list-ol",
    mode: "action",
    run: countBookings,
  });
})();