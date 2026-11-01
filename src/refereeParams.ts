// Referee timer parameters. Change them here only.
// Testing only: FUNGE_RESET_SECONDS=60 and FUNGE_KEEPER_DELAY_SECONDS=30 shorten rounds when you start the
// server. The server refuses to start with either set on mainnet. The browser never reads these.
const envSeconds = (name: string, fallback: number) => {
  const n = typeof process !== "undefined" ? Number(process.env?.[name]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const RESET_SECONDS = { steal: envSeconds("FUNGE_RESET_SECONDS", 600) }; // deadline reset per action type
export const KEEPER_DELAY_SECONDS = envSeconds("FUNGE_KEEPER_DELAY_SECONDS", 120); // the keeper settles after this
export const GRACE_SECONDS = 1; // lateness grace after the deadline
export const HEARTBEAT_SECONDS = 5; // how often the server saves a heartbeat
export const EVENT_HISTORY = 200; // events kept per round for client resync
export const UNCONFIRMED_CAP = Math.floor(envSeconds("FUNGE_UNCONFIRMED_CAP", 40)); // pause near the node's unconfirmed chain limit (Step 4). Testing only: FUNGE_UNCONFIRMED_CAP=3
export type ActionType = keyof typeof RESET_SECONDS;

// Kingdom referee settings (not in the contract: the referee decides timing only)
import type { BellSettings } from "./lib/bell.ts";
export const BELL_PRESETS: Record<"standard" | "demo", BellSettings> = {
  standard: { startSeconds: 600, stepSeconds: 30, floorSeconds: 120 }, // 10:00, minus 0:30 per conquest, never below 2:00
  demo: { startSeconds: 300, stepSeconds: 30, floorSeconds: 120 }, // 5:00 start, for short live demos
};
export const PROTECT_LOCKOUT_SECONDS = 30; // protect is refused in the last 30 seconds before the deadline (protect only)

export const GLOBAL_RATE = { max: 120, windowMs: 60_000 }; // per IP, all routes
export const ACT_RATE = { max: 12, windowMs: 60_000 }; // per IP, POST /act
export const ACT_BODY_LIMIT = 32_768; // bytes