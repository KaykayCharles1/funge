import assert from "node:assert/strict";
import { MOCK_KINGS, MOCK_ROUND_ID, playMockRound } from "../src/mockRound.ts";
import type { RefereeEvent, RoundSnapshot } from "../src/referee/api.ts";

// The scripted round plays through the same two handlers a real round uses. Time is fake here.
let clock = 1_000_000;
const events: RefereeEvent[] = [];
const snapshots: RoundSnapshot[] = [];
const labels: string[] = [];
await playMockRound({
  now: () => clock,
  shiftClock: (ms) => void (clock += ms),
  onEvent: (e) => void events.push(e),
  onSnapshot: (s) => void snapshots.push(s),
  sleep: async (ms) => void (clock += ms),
  cancelled: () => false,
  label: (t) => void labels.push(t),
});

assert.deepEqual(events.map((e) => `${e.type}/${e.reason}`), ["deadline_changed/open", "protect_applied/protect", "deadline_changed/conquer", "round_over/deadline"]);
assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4]);
for (const e of events) {
  assert.equal(e.roundId, MOCK_ROUND_ID);
  for (const key of ["king", "previousKing", "passCount", "conquests", "value", "treasury", "protectsLeft", "deadline", "clockSeconds", "nextClockSeconds", "clockCapSeconds", "conquestAddSeconds", "conquestMinSeconds"]) {
    assert.ok(key in (e.data ?? {}), `${e.type} is missing ${key}`);
  }
}
const [open, protect, conquer, over] = events.map((e) => e.data!);
assert.deepEqual([open!.actor, open!.paid, open!.toTreasury, open!.treasury, open!.clockSeconds], [MOCK_KINGS.alice, "1000", "1000", "1000", 600]);
assert.deepEqual([protect!.paid, protect!.value, protect!.treasury, protect!.protectsLeft, protect!.deadline], ["500", "1500", "1500", 1, open!.deadline]);
assert.deepEqual(
  [conquer!.actor, conquer!.previousKing, conquer!.paid, conquer!.refunded, conquer!.toTreasury, conquer!.treasury, conquer!.conquests, conquer!.clockSeconds, conquer!.addedSeconds, conquer!.nextClockSeconds],
  [MOCK_KINGS.bob, MOCK_KINGS.alice, "1530", "1380", "150", "1650", 1, 600, 5, 600], // 5 s after the open: 9:55 + 1:00, cut to the 10:00 cap
);
assert.deepEqual([over!.king, over!.treasury], [MOCK_KINGS.bob, "1650"]);
assert.equal(snapshots.at(0)!.status, "waiting");
assert.equal(snapshots.at(-1)!.status, "over");
assert.equal(snapshots.at(-1)!.kingdom?.holder, MOCK_KINGS.bob);
assert.equal(snapshots.at(-1)!.lastSeq, 4);
// each snapshot after a move is the world that move made, and the clock is realistic (not shortened for the test)
assert.equal(snapshots.find((s) => s.passCount === 2)!.kingdom?.conquest?.pay, "1530");
assert.ok(labels.length >= 6);
console.log("ok: the mock round plays open, protect, conquer, clock jumps and round over; each event is complete");

// stopping it midway ends the script quietly
{
  let n = 0;
  const seen: RefereeEvent[] = [];
  await playMockRound({
    now: () => clock, shiftClock: () => undefined, onEvent: (e) => void seen.push(e), onSnapshot: () => undefined,
    sleep: async () => undefined, cancelled: () => ++n > 3, label: () => undefined,
  });
  assert.ok(seen.length < 4);
  console.log("ok: the mock round can be stopped midway");
}
console.log("\nMock round test passed.");
