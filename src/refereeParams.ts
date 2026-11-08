// Referee timer parameters. Change them here only.
// Testing only: FUNGE_KEEPER_DELAY_SECONDS=30 shortens the keeper wait when you start the
// server. The server refuses to start with any of these overrides set on mainnet. The browser never reads these.
const envSeconds = (name: string, fallback: number) => {
  const n = typeof process !== "undefined" ? Number(process.env?.[name]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const KEEPER_DELAY_SECONDS = envSeconds("FUNGE_KEEPER_DELAY_SECONDS", 120); // the keeper settles after this
export const GRACE_SECONDS = 1; // lateness grace after the deadline
export const HEARTBEAT_SECONDS = 5; // how often the server saves a heartbeat
export const EVENT_HISTORY = 200; // events kept per round for client resync
export const UNCONFIRMED_CAP = Math.floor(envSeconds("FUNGE_UNCONFIRMED_CAP", 40)); // pause near the node's unconfirmed chain limit (Step 4). Testing only: FUNGE_UNCONFIRMED_CAP=3

// Clock settings (not in the contract: the referee decides timing only). See src/lib/kingdomClock.ts.
// The open starts the clock at the cap; each conquest sets the time left to min(CAP, max(MIN, left + ADD)).
import type { ClockSettings } from "./lib/kingdomClock.ts";
export const CLOCK_CAP_SECONDS = 600; // 10:00, the most time the clock can show
export const CONQUEST_ADD_SECONDS = 60; // each conquest adds 1:00 to the time left
export const CONQUEST_MIN_SECONDS = 0; // a dial for later (for example 180): a conquest never leaves less. 0 = off
export const CLOCK_PRESETS: Record<"standard" | "demo", ClockSettings> = {
  standard: { capSeconds: CLOCK_CAP_SECONDS, addSeconds: CONQUEST_ADD_SECONDS, minSeconds: CONQUEST_MIN_SECONDS },
  demo: { capSeconds: 300, addSeconds: CONQUEST_ADD_SECONDS, minSeconds: CONQUEST_MIN_SECONDS }, // 5:00 cap, for short live demos
};
export const PROTECT_LOCKOUT_SECONDS = 30; // protect is refused in the last 30 seconds before the deadline (protect only)

export const GLOBAL_RATE = { max: 120, windowMs: 60_000 }; // per IP, all routes
export const ACT_RATE = { max: 12, windowMs: 60_000 }; // per IP, POST /act
export const ACT_BODY_LIMIT = 32_768; // bytes