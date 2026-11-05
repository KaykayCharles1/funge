// The only place the server reads time. Everything else receives a Clock.
export type Clock = { now: () => number };

export const systemClock: Clock = { now: () => Date.now() };

export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}