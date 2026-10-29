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
export const UNCONFIRMED_CAP = 40; // pause near the node's unconfirmed chain limit (Step 4)

export type ActionType = keyof typeof RESET_SECONDS;

export const GLOBAL_RATE = { max: 120, windowMs: 60_000 }; // per IP, all routes
export const ACT_RATE = { max: 12, windowMs: 60_000 }; // per IP, POST /act
export const ACT_BODY_LIMIT = 32_768; // bytes