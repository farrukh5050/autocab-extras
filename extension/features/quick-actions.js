// features/quick-actions.js — clipboard and zone lookups for the selected booking.
(() => {
    "use strict";
    const AE = window.AutocabExtras;

    function copyBooking() {
        const row = AE.readSelectedRow();
        if (!row) { AE.showToast("No booking selected"); return; }
        navigator.clipboard.writeText(row.allCells.join(" | "))
            .then(() => AE.showToast("Booking copied to clipboard"))
            .catch(() => AE.showToast("Copy failed"));
    }

    function showZone() {
        const row = AE.readSelectedRow();
        AE.showToast(row ? `Zone: ${row.zone || "—"}` : "No booking selected");
    }

    AE.registerButton({
        id: "quick-actions",
        title: "Quick Actions",
        icon: "fa-clone",
        mode: "menu",
        items: [
            {
                id: "copy-booking",
                label: "Copy booking details",
                icon: "fa-copy",
                contextMenu: true,
                apps: ["dispatch"],
                run: copyBooking,
            },
            {
                id: "show-zone",
                label: "Show zone of selection",
                icon: "fa-map-marker-alt",
                contextMenu: true,
                apps: ["dispatch"],
                run: showZone,
            },
        ],
    });
})();