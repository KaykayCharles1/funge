// The wait between a settled round and the next one. kingdomMode.ts starts it and marks progress; the action bar,
// the battlefield notice and the round panel show nextRoundLine().
//   Normally the next round is already prepared (game.<network>.next.json): the winner is shown for WINNER_SECONDS,
//   with a countdown, then the page switches. Without a prepared round, the robot has to deploy one first (the old
//   wait, about WAIT_SECONDS).
import { COPY } from "./copy.ts";

const T = COPY.battlefield;
export const WINNER_SECONDS = 10;
// Measured: about 30 s for the GitHub robot, then about 50 s for Render and Cloudflare (side by side), then the
// page's next check.
const WAIT_SECONDS = 90;

let startedAt: number | null = null;
let almost = false;
let switchAt: number | null = null; // the prepared round is ready: the moment the page switches to it

// The prepared round is ready: switch WINNER_SECONDS after the round ended, so the winner is seen first.
// Returns the moment to switch.
export function nextRoundReady(): number {
  switchAt ??= (startedAt ?? Date.now()) + WINNER_SECONDS * 1000;
  return switchAt;
}

export function startNextRoundWait(): void {
  if (startedAt === null) startedAt = Date.now();
}

// The new round is on screen: the next finished round starts a fresh wait
export function resetNextRoundWait(): void {
  startedAt = null;
  almost = false;
  switchAt = null;
}

// The new game file is out: only the referee is left
export function markNextRoundAlmost(): void {
  almost = true;
}

export function nextRoundLine(): string {
  if (switchAt !== null) {
    const left = Math.max(0, Math.ceil((switchAt - Date.now()) / 1000));
    return T.nextRoundIn(`0:${String(left).padStart(2, "0")}`);
  }
  if (startedAt === null) return T.nextRound;
  if (almost) return T.nextRoundAlmost;
  const left = Math.ceil(WAIT_SECONDS - (Date.now() - startedAt) / 1000);
  if (left <= 0) return T.nextRoundAnyMoment;
  return T.nextRoundIn(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
}
