// The Kingdom clock. It replaces the shrinking bell.
//   Open: the clock starts at the cap.
//   Every conquest (a "take back your throne" too): time left becomes min(CAP, max(MIN, left + ADD)),
//   where "left" is the time left at the instant the referee records the move (never below 0, so a conquest
//   inside the 1 s grace counts as 0 left and gets ADD).
//   Protect never changes the clock.
// Pure maths, no clock and no network, so the server, the mocks, the tests and the page all agree.
export type ClockSettings = {
  capSeconds: number; // the most time the clock can show; the open starts here
  addSeconds: number; // what a conquest adds to the time left
  minSeconds: number; // a conquest never leaves less than this (0 = off)
};

export function validateClock(s: ClockSettings): void {
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (!whole(s.capSeconds) || s.capSeconds === 0) throw new Error("Clock: the cap must be whole seconds above zero.");
  if (!whole(s.addSeconds)) throw new Error("Clock: the conquest addition must be whole seconds, zero or more.");
  if (!whole(s.minSeconds)) throw new Error("Clock: the conquest minimum must be whole seconds, zero or more.");
  if (s.minSeconds > s.capSeconds) throw new Error("Clock: the conquest minimum cannot be above the cap.");
}

// The time left right after a conquest, in ms, from the time left just before it (in ms)
export function clockAfterConquestMs(leftMs: number, s: ClockSettings): number {
  const left = Math.max(0, leftMs);
  return Math.min(s.capSeconds * 1000, Math.max(s.minSeconds * 1000, left + s.addSeconds * 1000));
}

// The time left right after the open, in ms
export const clockAfterOpenMs = (s: ClockSettings): number => s.capSeconds * 1000;

// Whole seconds for events and the round description (the deadline itself keeps full precision)
export const wholeSeconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));
