// The Kingdom bell: how long the clock runs after each open or conquest.
// The first king (the open) gets the start value; every conquest takes stepSeconds off, down to the floor.
// Pure maths, no clock and no network, so the server, the tests and the page all agree.
export type BellSettings = { startSeconds: number; stepSeconds: number; floorSeconds: number };

export function validateBell(s: BellSettings): void {
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  if (!whole(s.startSeconds) || !whole(s.floorSeconds)) throw new Error("Bell: start and floor must be whole seconds above zero.");
  if (!Number.isInteger(s.stepSeconds) || s.stepSeconds < 0) throw new Error("Bell: step must be a whole number of seconds, zero or more.");
  if (s.floorSeconds > s.startSeconds) throw new Error("Bell: the floor cannot be above the start.");
}

// passCount = kings so far: 1 right after the open, 2 after the first conquest, and so on.
export function clockSecondsFor(passCount: number, s: BellSettings): number {
  if (!Number.isInteger(passCount) || passCount < 1) throw new Error(`Bell: pass count must be 1 or more, got ${passCount}.`);
  return Math.max(s.floorSeconds, s.startSeconds - s.stepSeconds * (passCount - 1));
}

// What the next conquest will set the clock to (shown as "Next conquest clock"). While waiting (0) it is the open's clock.
export const nextClockSecondsFor = (passCount: number, s: BellSettings): number =>
  clockSecondsFor(passCount < 1 ? 1 : passCount + 1, s);