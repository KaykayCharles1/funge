import "./style.css";
import { CONFIG } from "./config.ts";
import { startRefereeMode } from "./refereeMode.ts";

const byId = (id: string) => document.getElementById(id)!;

byId("networkTag").textContent = CONFIG.network === "mainnet" ? "Mainnet · real money" : "Test mode · chipnet";

startRefereeMode().catch((e) => {
  console.error(e);
  byId("status").textContent = `Error: ${e instanceof Error ? e.message : e}`;
});