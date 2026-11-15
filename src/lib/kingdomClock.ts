// The Kingdom clock. It replaces the shrinking bell.
//   Open: the clock starts at the cap.
//   Every conquest (a "take back your throne" too), with "left" the time left at the instant the referee records
//   the move (never below 0, so a conquest inside the 1 s grace counts as 0 left):
//     left of ENDGAME or more: time left becomes min(CAP, left + ADD)
//     left under ENDGAME:      time left becomes min(ENDGAME, left + ENDGAME_ADD)
//   and never less than MIN. So with 5:00 / +0:30 / under 1:00 +0:10: 2:00 -> 2:30, 0:45 -> 0:55, 0:55 -> 1:00.
//   Protect never changes the clock.
// Pure maths, no clock and no network, so the server, the mocks, the tests and the page all agree.
export type ClockSettings = {
  capSeconds: number; // the most time the clock can show; the open starts here
  addSeconds: number; // what a conquest adds to the time left
  minSeconds: number; // a conquest never leaves less than this (0 = off)
  endgameSeconds: number; // below this much time left, a conquest adds endgameAddSeconds instead, and never lifts the clock past this (0 = off)
  endgameAddSeconds: number; // what a conquest adds when less than endgameSeconds is left
};

export function validateClock(s: ClockSettings): void {
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (!whole(s.capSeconds) || s.capSeconds === 0) throw new Error("Clock: the cap must be whole seconds above zero.");
  if (!whole(s.addSeconds)) throw new Error("Clock: the conquest addition must be whole seconds, zero or more.");
  if (!whole(s.minSeconds)) throw new Error("Clock: the conquest minimum must be whole seconds, zero or more.");
  if (s.minSeconds > s.capSeconds) throw new Error("Clock: the conquest minimum cannot be above the cap.");
  if (!whole(s.endgameSeconds) || !whole(s.endgameAddSeconds)) throw new Error("Clock: the endgame settings must be whole seconds, zero or more.");
  if (s.endgameSeconds > s.capSeconds) throw new Error("Clock: the endgame cannot start above the cap.");
}

// The time left right after a conquest, in ms, from the time left just before it (in ms)
export function clockAfterConquestMs(leftMs: number, s: ClockSettings): number {
  const left = Math.max(0, leftMs);
  const endgame = s.endgameSeconds * 1000;
  const raised = left < endgame ? Math.min(endgame, left + s.endgameAddSeconds * 1000) : left + s.addSeconds * 1000;
  return Math.min(s.capSeconds * 1000, Math.max(s.minSeconds * 1000, raised));
}

// The time left right after the open, in ms
export const clockAfterOpenMs = (s: ClockSettings): number => s.capSeconds * 1000;

// Whole seconds for events and the round description (the deadline itself keeps full precision)
export const wholeSeconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));
