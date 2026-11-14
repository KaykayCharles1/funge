// The wait between a settled round and the next one. kingdomMode.ts starts it and marks progress; the action bar,
// the battlefield notice and the round panel show nextRoundLine().
import { COPY } from "./copy.ts";

const T = COPY.battlefield;
// Measured: about 30 s for the GitHub robot, then about 50 s for Render and Cloudflare (side by side), then the
// page's next 5-second check.
const WAIT_SECONDS = 90;

let startedAt: number | null = null;
let almost = false;

export function startNextRoundWait(): void {
  if (startedAt === null) startedAt = Date.now();
}

// The new game file is out: only the referee is left
export function markNextRoundAlmost(): void {
  almost = true;
}

export function nextRoundLine(): string {
  if (startedAt === null) return T.nextRound;
  if (almost) return T.nextRoundAlmost;
  const left = Math.ceil(WAIT_SECONDS - (Date.now() - startedAt) / 1000);
  if (left <= 0) return T.nextRoundAnyMoment;
  return T.nextRoundIn(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
}
