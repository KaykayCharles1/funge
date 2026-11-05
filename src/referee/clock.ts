import { getHealth } from "./api.ts";

let offsetMs = 0; // server time minus this device's time
let rttMs: number | null = null;

// The server's clock, as best we can tell. The countdown must use this, never the device clock.
export const serverNow = () => Date.now() + offsetMs;
// Dev-only: the mock round player moves the clock forward to skip time, then moves it back.
export const shiftClockForMock = (ms: number) => {
  offsetMs += ms;
};
export const clockInfo = () => ({ offsetMs: Math.round(offsetMs), rttMs, synced: rttMs !== null });

// Asks the server for its time a few times and keeps the answer with the shortest round trip
// (the most accurate one: the error is at most half of that round trip).
export async function syncClock(samples = 5): Promise<boolean> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const r = await getHealth();
    const t1 = Date.now();
    if (r) {
      const rtt = t1 - t0;
      const offset = r.serverNow + rtt / 2 - t1;
      if (!best || rtt < best.rtt) best = { rtt, offset };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!best) return false;
  offsetMs = best.offset;
  rttMs = best.rtt;
  return true;
}