// Runs before the page is drawn: on the battlefield, the plain game page under it is never shown, not even for a
// moment while the scripts load (src/kingdomMode.ts shows it again only if the battlefield fails to load).
if (new URLSearchParams(location.search).get("mode") === "battlefield") document.documentElement.classList.add("fg-boot");
