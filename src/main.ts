import "./style.css";
import { CONFIG } from "./config.ts";
import { installSafeConsole } from "./lib/safeLog.ts";
import { startKingdomMode } from "./kingdomMode.ts";
import { startRefereeMode } from "./refereeMode.ts";

installSafeConsole();

const byId = (id: string) => document.getElementById(id)!;

byId("networkTag").textContent = CONFIG.network === "mainnet" ? "Mainnet · real money" : "Test mode · chipnet";

// The Kingdom page is at /?mode=kingdom. The old steal page stays the default until the Kingdom is approved to replace it.
const start = new URLSearchParams(location.search).get("mode") === "kingdom" ? startKingdomMode : startRefereeMode;

start().catch((e) => {
  console.error(e);
  byId("status").textContent = `Error: ${e instanceof Error ? e.message : e}`;
});