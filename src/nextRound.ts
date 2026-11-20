// The wait between a settled round and the next one. kingdomMode.ts starts it and marks progress; the action bar,
// the battlefield notice and the round panel show nextRoundLine().
//   The next round is prepared in advance (game.<network>.next.json): the winner is shown for WINNER_SECONDS, with a
//   countdown, then the page switches. The countdown is always those 10 seconds; if the new round is not ready when
//   it reaches zero (rare: the robot had to deploy one), the line says it starts any moment.
import { COPY } from "./copy.ts";

const T = COPY.battlefield;
export const WINNER_SECONDS = 10;

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
  const left = Math.ceil(WINNER_SECONDS - (Date.now() - startedAt) / 1000);
  if (left > 0) return T.nextRoundIn(`0:${String(left).padStart(2, "0")}`);
  return almost ? T.nextRoundAlmost : T.nextRoundAnyMoment;
}
