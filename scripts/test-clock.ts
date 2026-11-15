// The Kingdom clock: the open starts at the cap; each conquest adds ADD up to the cap, or under ENDGAME left adds
// ENDGAME_ADD up to ENDGAME.
// Also the protect lockout, pauses, restarts and the clock fields on events. Run: node scripts/test-clock.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../server/clock.ts";
import { RoundManager, classifyKingdomAction } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { clockAfterConquestMs, clockAfterOpenMs, validateClock, wholeSeconds, type ClockSettings } from "../src/lib/kingdomClock.ts";
import {
  CLOCK_CAP_SECONDS, CLOCK_SETTINGS, CONQUEST_ADD_SECONDS, CONQUEST_ENDGAME_ADD_SECONDS, CONQUEST_ENDGAME_SECONDS, CONQUEST_MIN_SECONDS,
  GRACE_SECONDS, KEEPER_DELAY_SECONDS, PROTECT_LOCKOUT_SECONDS,
} from "../src/refereeParams.ts";

const dir = mkdtempSync(join(tmpdir(), "funge-clock-"));
const std = CLOCK_SETTINGS;
const GRACE = GRACE_SECONDS * 1000;
const LOCK = PROTECT_LOCKOUT_SECONDS * 1000;
const S = 1000;
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}`;

async function setup(name: string, settings: ClockSettings = std) {
  const clock = fakeClock();
  const { store } = await Store.open(join(dir, `${name}.json`));
  const mgr = new RoundManager(store, clock);
  mgr.setClock("k", settings);
  return { clock, store, mgr, path: join(dir, `${name}.json`) };
}
const reasons = (mgr: RoundManager) => mgr.get("k").events.map((e) => e.reason);
const left = (mgr: RoundManager, now: number) => mgr.get("k").deadline! - now;

// --- the settings are what was decided ---
assert.deepEqual([CLOCK_CAP_SECONDS, CONQUEST_ADD_SECONDS, CONQUEST_MIN_SECONDS, CONQUEST_ENDGAME_SECONDS, CONQUEST_ENDGAME_ADD_SECONDS], [300, 30, 0, 60, 10]);
assert.deepEqual(std, { capSeconds: 300, addSeconds: 30, minSeconds: 0, endgameSeconds: 60, endgameAddSeconds: 10 });
assert.equal(PROTECT_LOCKOUT_SECONDS, 30);
assert.equal(KEEPER_DELAY_SECONDS, 30);
console.log("ok: settings (cap 5:00, +0:30 per conquest, under 1:00 +0:10 up to 1:00, minimum off), the 30 s protect lockout, the 30 s keeper");

// --- the rule, with every example from the decision (standard) ---
{
  const after = (leftSeconds: number, s = std) => clockAfterConquestMs(leftSeconds * S, s);
  const examples: [number, number][] = [
    [300, 300], [280, 300], [270, 300], [200, 230], [120, 150], [60, 90], // 1:00 or more: +0:30, at most 5:00
    [59, 60], [55, 60], [50, 60], [45, 55], [10, 20], // under 1:00: +0:10, at most 1:00
  ];
  for (const [before, expected] of examples) {
    assert.equal(after(before), expected * S, `${mmss(before * S)} left should become ${mmss(expected * S)}`);
  }
  assert.equal(after(0), 10 * S); // a conquest inside the grace: nothing left, +0:10
  assert.equal(after(-0.5), 10 * S); // never below 0
  assert.equal(clockAfterConquestMs(59_999, std), 60 * S); // a hair under 1:00 is the endgame
  assert.equal(clockAfterConquestMs(60_000, std), 90 * S); // exactly 1:00 is not
  assert.equal(clockAfterOpenMs(std), 300 * S);
  console.log("ok: 4:40 -> 5:00, 3:20 -> 3:50, 1:00 -> 1:30; 0:59 -> 1:00, 0:45 -> 0:55, 0:10 -> 0:20, 0:00 -> 0:10; the open starts at 5:00");
}

// --- the endgame switched off behaves like a plain +ADD clock ---
{
  const plain: ClockSettings = { ...std, endgameSeconds: 0 };
  assert.equal(clockAfterConquestMs(10 * S, plain), 40 * S);
  assert.equal(clockAfterConquestMs(0, plain), 30 * S);
  console.log("ok: endgame 0 (off): 0:10 -> 0:40");
}

// --- the MIN dial works (proved at 180 s, then left at 0) ---
{
  const dial: ClockSettings = { ...std, minSeconds: 180 };
  const after = (leftSeconds: number) => clockAfterConquestMs(leftSeconds * S, dial);
  assert.equal(after(10), 180 * S); // 0:10 + 0:10 = 0:20, raised to the 3:00 minimum
  assert.equal(after(0), 180 * S);
  assert.equal(after(149), 180 * S); // 2:29 + 0:30 = 2:59, raised to 3:00
  assert.equal(after(150), 180 * S); // 2:30 + 0:30 = exactly 3:00
  assert.equal(after(160), 190 * S); // 2:40 + 0:30 = 3:10, above the minimum: unchanged
  assert.equal(after(290), 300 * S); // the cap still wins
  assert.equal(std.minSeconds, 0); // and the real setting stays off
  console.log("ok: MIN = 180 raises short clocks to 3:00 and leaves longer ones alone; the real setting is 0 (off)");
}

// --- bad settings are refused ---
{
  assert.throws(() => validateClock({ ...std, capSeconds: 0 }));
  assert.throws(() => validateClock({ ...std, addSeconds: -1 }));
  assert.throws(() => validateClock({ ...std, addSeconds: 0.5 }));
  assert.throws(() => validateClock({ ...std, minSeconds: 301 }));
  assert.throws(() => validateClock({ ...std, minSeconds: -1 }));
  assert.throws(() => validateClock({ ...std, endgameSeconds: 301 }));
  assert.throws(() => validateClock({ ...std, endgameSeconds: -1 }));
  assert.throws(() => validateClock({ ...std, endgameAddSeconds: 1.5 }));
  validateClock({ ...std, addSeconds: 0, minSeconds: 300, endgameSeconds: 0 }); // a flat clock is allowed
  console.log("ok: invalid clock settings are refused");
}

// --- classification ---
assert.equal(classifyKingdomAction("open"), "open");
assert.equal(classifyKingdomAction("conquer"), "conquer");
assert.equal(classifyKingdomAction("protect"), "protect");
assert.equal(classifyKingdomAction("settle"), null);
console.log("ok: action classification (settle never touches the clock)");

// --- the referee applies the rule: the open, then conquests at 4:40, 3:20, 1:30, 0:45 and 0:55 left ---
{
  const { clock, mgr } = await setup("flow");
  assert.equal(mgr.observe("k", { live: true, passCount: 0 }).status, "waiting");
  assert.equal(mgr.get("k").deadline, null);

  mgr.applyKingdomAction("k", "open", 1);
  assert.equal(left(mgr, clock.now()), 300 * S);
  const steps: [number, number, number][] = [[280, 300, 20], [200, 230, 30], [90, 120, 30], [45, 55, 10], [55, 60, 5]]; // [left before, after, added]
  let pass = 1;
  for (const [before, after, added] of steps) {
    clock.set(mgr.get("k").deadline! - before * S); // let the clock run down to `before`
    mgr.applyKingdomAction("k", "conquer", ++pass);
    assert.equal(left(mgr, clock.now()), after * S, `${mmss(before * S)} left: the deadline should be ${mmss(after * S)} away`);
    const ev = mgr.get("k").events.at(-1)!;
    assert.deepEqual(
      [ev.type, ev.reason, ev.data?.clockSeconds, ev.data?.addedSeconds, ev.data?.passCount, ev.data?.action],
      ["deadline_changed", "conquer", after, added, pass, "conquer"],
    );
  }
  assert.deepEqual(reasons(mgr), ["open", "conquer", "conquer", "conquer", "conquer", "conquer"]);
  console.log("ok: the referee sets 5:00, then 4:40 -> 5:00 (+0:20, the cap cut it), 3:20 -> 3:50, 1:30 -> 2:00, 0:45 -> 0:55 (+0:10), 0:55 -> 1:00 (+0:05, the endgame cap cut it)");
}

// --- every event carries the clock fields; nextClockSeconds (deprecated) is computed at event time ---
{
  const { clock, mgr } = await setup("fields");
  mgr.applyKingdomAction("k", "open", 1);
  const open = mgr.get("k").events.at(-1)!.data!;
  assert.deepEqual(
    [open.clockSeconds, open.clockCapSeconds, open.conquestAddSeconds, open.conquestMinSeconds, open.nextClockSeconds, "addedSeconds" in open],
    [300, 300, 30, 0, 300, false], // right after the open 5:00 is left; a conquest now would stay at the cap
  );
  clock.advance(200 * S); // 1:40 left
  mgr.applyProtect("k", { amount: "500", value: "1500", protectsUsed: 1 });
  const prot = mgr.get("k").events.at(-1)!.data!;
  assert.deepEqual([prot.clockSeconds, prot.nextClockSeconds, prot.clockCapSeconds], [300, 130, 300]); // still the open's 5:00; a conquest now: 1:40 + 0:30
  assert.deepEqual(mgr.clockInfo("k"), { clockSeconds: 300, nextClockSeconds: 130, clockCapSeconds: 300, conquestAddSeconds: 30, conquestMinSeconds: 0 });
  // while waiting: no clock yet, the next move (the open) gets the cap
  const w = await setup("fields-waiting");
  w.mgr.observe("k", { live: true, passCount: 0 });
  assert.deepEqual(w.mgr.clockInfo("k"), { clockSeconds: null, nextClockSeconds: 300, clockCapSeconds: 300, conquestAddSeconds: 30, conquestMinSeconds: 0 });
  // a game without settings has no clock info
  assert.equal(new RoundManager((await Store.open(join(dir, "nb.json"))).store, fakeClock()).clockInfo("x"), null);
  console.log("ok: events carry clockSeconds (right after the move), clockCapSeconds, conquestAddSeconds, conquestMinSeconds; addedSeconds on conquests only");
}

// --- a conquest inside the 1 s grace counts as 0 left: +0:10 from now ---
{
  const { clock, mgr } = await setup("grace");
  mgr.applyKingdomAction("k", "open", 1);
  const deadline = mgr.get("k").deadline!;
  clock.set(deadline + GRACE - 1); // inside the grace, after the deadline
  mgr.applyKingdomAction("k", "conquer", 2);
  assert.equal(left(mgr, clock.now()), 10 * S);
  assert.equal(mgr.get("k").events.at(-1)!.data?.addedSeconds, 10);
  console.log("ok: a conquest accepted inside the grace gives 0:10 from that moment");
}

// --- a pause: the time left is frozen while paused, the resume pushes the deadline, then the rule applies ---
{
  const { clock, mgr } = await setup("pause");
  mgr.applyKingdomAction("k", "open", 1);
  clock.advance(150 * S); // 2:30 left
  mgr.pause("k", "network_busy");
  clock.advance(120 * S); // two minutes paused
  assert.equal(mgr.clockInfo("k")!.nextClockSeconds, 180); // frozen at 2:30 left: a conquest would give 3:00
  mgr.resume("k", "network_ok");
  assert.equal(left(mgr, clock.now()), 150 * S); // the pause cost nothing
  clock.advance(60 * S); // 1:30 left
  mgr.applyKingdomAction("k", "conquer", 2);
  assert.equal(left(mgr, clock.now()), 120 * S); // 1:30 + 0:30
  console.log("ok: a pause freezes the time left (no time lost), and the next conquest adds to what was really left");
}

// --- the endgame through the referee: under 1:00 each conquest adds 0:10, never past 1:00; at 1:00 it is +0:30 again ---
{
  const { clock, mgr } = await setup("endgame");
  mgr.applyKingdomAction("k", "open", 1);
  clock.set(mgr.get("k").deadline! - 30 * S); // 0:30 left
  const seen: number[] = [];
  for (let pass = 2; pass <= 6; pass++) {
    mgr.applyKingdomAction("k", "conquer", pass);
    seen.push(left(mgr, clock.now()) / S);
  }
  assert.deepEqual(seen, [40, 50, 60, 90, 120]); // 0:30 -> 0:40 -> 0:50 -> 1:00, then 1:00 is not the endgame: 1:30 -> 2:00
  assert.deepEqual(mgr.get("k").events.slice(-5).map((e) => e.data?.addedSeconds), [10, 10, 10, 30, 30]);
  console.log("ok: endgame: 0:30 -> 0:40 -> 0:50 -> 1:00, then +0:30 again: 1:30 -> 2:00");
}

// --- protect changes nothing about the clock ---
{
  const { clock, mgr } = await setup("protect");
  mgr.applyKingdomAction("k", "open", 1);
  mgr.applyKingdomAction("k", "conquer", 2);
  const r = mgr.get("k");
  const deadline = r.deadline;
  const seen = r.seenPassCount;
  clock.advance(60_000);
  mgr.applyProtect("k", { amount: "500", value: "1500", protectsUsed: 1 });
  assert.equal(r.deadline, deadline);
  assert.equal(r.status, "open");
  assert.equal(r.seenPassCount, seen);
  const ev = r.events.at(-1)!;
  assert.deepEqual([ev.type, ev.reason, ev.data?.deadline, ev.data?.amount, ev.data?.value], ["protect_applied", "protect", deadline, "500", "1500"]);
  mgr.applyProtect("k", { amount: "100", value: "1600", protectsUsed: 2 });
  assert.equal(r.deadline, deadline);
  // and the round still ends at the same moment
  clock.set(deadline! + GRACE - 1);
  assert.equal(mgr.observe("k", { live: true, passCount: 2 }).status, "open");
  clock.set(deadline! + GRACE);
  assert.equal(mgr.observe("k", { live: true, passCount: 2 }).status, "over");
  assert.deepEqual(reasons(mgr), ["open", "conquer", "protect", "protect", "deadline"]);
  console.log("ok: protect never moves the deadline; the round still ends on time; protect events carry the unchanged deadline");
}

// --- the protect lockout ---
{
  const { clock, mgr } = await setup("lockout");
  const check = (at = clock.now()) => mgr.protectCheck("k", at);
  assert.deepEqual(check(), { ok: false, why: "not_open", remainingMs: null }); // waiting
  mgr.applyKingdomAction("k", "open", 1);
  const deadline = mgr.get("k").deadline!;
  assert.equal(check().ok, true);
  assert.equal(check(deadline - LOCK - 1).ok, true); // 30.001 s left: open
  assert.deepEqual(check(deadline - LOCK), { ok: false, why: "locked", remainingMs: LOCK }); // exactly 30 s left: closed
  assert.equal(check(deadline - 29_999).ok, false);
  assert.equal(check(deadline - 1).ok, false);
  assert.equal(check(deadline).ok, false);
  assert.equal(check(deadline + 500).ok, false); // after the deadline (inside the conquest grace): still closed for protect
  assert.equal(mgr.observe("k", { live: true, passCount: 1 }).status, "open");
  clock.set(deadline - 5_000);
  assert.equal(mgr.observe("k", { live: true, passCount: 1 }).status, "open"); // conquest still possible at 5 s
  // a conquest at 5 s left lifts the clock to 0:15: protect stays closed
  mgr.applyKingdomAction("k", "conquer", 2);
  assert.equal(left(mgr, clock.now()), 15 * S);
  assert.equal(check().ok, false);
  // two more conquests: 0:25, then 0:35, and protect opens again
  mgr.applyKingdomAction("k", "conquer", 3);
  mgr.applyKingdomAction("k", "conquer", 4);
  assert.equal(left(mgr, clock.now()), 35 * S);
  assert.equal(check().ok, true);
  // a custom lockout is honoured
  const d2 = mgr.get("k").deadline!;
  assert.equal(mgr.protectCheck("k", d2 - 10_000, 5).ok, true);
  assert.equal(mgr.protectCheck("k", d2 - 4_000, 5).ok, false);
  // paused: refused with its own reason, and the remaining time is the frozen one
  clock.set(d2 - 32_000);
  mgr.pause("k", "network_busy");
  clock.advance(1_000_000);
  assert.deepEqual(mgr.protectCheck("k", clock.now()), { ok: false, why: "paused", remainingMs: 32_000 });
  mgr.resume("k", "network_ok");
  assert.equal(mgr.protectCheck("k", clock.now()).ok, true);
  // over and settled
  clock.set(mgr.get("k").deadline! + GRACE);
  mgr.observe("k", { live: true, passCount: 4 });
  assert.equal(mgr.protectCheck("k", clock.now()).ok, false);
  mgr.markSettled("k", "tx", "keeper");
  assert.equal(mgr.protectCheck("k", clock.now()).ok, false);
  console.log("ok: protect refused in the last 30 s (30.001 s open, 30.000 s closed), when waiting, paused, over or settled; it reopens when conquests lift the clock past 0:30");
}

// --- applyProtect and applyKingdomAction refuse nonsense ---
{
  const { mgr } = await setup("guards");
  assert.throws(() => mgr.applyProtect("k"), /not running/); // waiting
  assert.throws(() => mgr.applyKingdomAction("k", "open", 2));
  assert.throws(() => mgr.applyKingdomAction("k", "conquer", 1));
  assert.throws(() => mgr.applyKingdomAction("k", "open", 0));
  mgr.applyKingdomAction("k", "open", 1);
  mgr.pause("k", "network_busy");
  assert.throws(() => mgr.applyProtect("k"), /not running/); // paused
  const noClock = new RoundManager((await Store.open(join(dir, "noclock.json"))).store, fakeClock());
  assert.throws(() => noClock.applyKingdomAction("g", "open", 1), /no clock settings/);
  console.log("ok: protect/open/conquer applied in a wrong state is a programming error, never a silent change");
}

// --- a move the timer did not see (made outside /act) follows the same rule, from now ---
{
  const { clock, mgr } = await setup("observed");
  mgr.applyKingdomAction("k", "open", 1);
  clock.advance(180 * S); // 2:00 left
  const r = mgr.observe("k", { live: true, passCount: 2 });
  assert.equal(left(mgr, clock.now()), 150 * S); // 2:00 + 0:30
  const ev = r.events.at(-1)!;
  assert.deepEqual([ev.reason, ev.data?.clockSeconds, ev.data?.passCount], ["observed_on_chain", 150, 2]);
  // an open seen on chain while we were waiting gets the cap
  const b = await setup("observed2");
  b.mgr.observe("k", { live: true, passCount: 0 });
  b.mgr.observe("k", { live: true, passCount: 1 });
  assert.equal(b.mgr.get("k").deadline, b.clock.now() + 300 * S);
  console.log("ok: an open seen only on the chain gets the cap; a conquest seen only on the chain adds 0:30 to what was left");
}

// --- restart: downtime still counts as a pause; a round saved before lastClockSeconds existed still works ---
{
  const a = await setup("restart");
  a.mgr.applyKingdomAction("k", "open", 1);
  a.mgr.applyKingdomAction("k", "conquer", 2);
  const deadline = a.mgr.get("k").deadline!;
  a.mgr.heartbeat();
  delete a.mgr.get("k").lastClockSeconds; // as if saved by the old referee
  await a.store.save();
  a.clock.advance(90_000); // the server was down for 90 s
  const { store } = await Store.open(a.path);
  const mgr2 = new RoundManager(store, a.clock);
  mgr2.setClock("k", std);
  mgr2.resumeAfterRestart(["k"]);
  assert.equal(mgr2.get("k").deadline, deadline + 90_000);
  const ev = mgr2.get("k").events.at(-1)!;
  assert.equal(ev.reason, "restart");
  assert.equal(ev.data?.clockSeconds, wholeSeconds(mgr2.get("k").deadline! - a.clock.now())); // the time left stands in
  console.log("ok: downtime still counts as a pause (reason restart); an older save without lastClockSeconds uses the time left");
}

// --- every clock change comes with a reason-coded event ---
{
  const { clock, mgr } = await setup("events");
  const r = mgr.get("k");
  let lastDeadline: number | null = null;
  let lastSeq = 0;
  const step = (label: string, fn: () => void, changes: boolean) => {
    fn();
    const moved = r.deadline !== lastDeadline;
    assert.equal(moved, changes, `${label}: deadline ${changes ? "should" : "should not"} have moved`);
    if (moved) {
      assert.ok(r.nextSeq - 1 > lastSeq, `${label}: a clock change without an event`);
      assert.ok(r.events.at(-1)!.reason, `${label}: the event has no reason`);
    }
    lastDeadline = r.deadline;
    lastSeq = r.nextSeq - 1;
  };
  step("open", () => mgr.applyKingdomAction("k", "open", 1), true);
  step("protect", () => mgr.applyProtect("k"), false);
  step("conquer", () => { clock.advance(90_000); mgr.applyKingdomAction("k", "conquer", 2); }, true);
  step("pause", () => { clock.advance(5_000); mgr.pause("k", "network_busy"); }, false);
  step("resume", () => { clock.advance(20_000); mgr.resume("k", "network_ok"); }, true);
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.reason}`), [
    "deadline_changed:open", "protect_applied:protect", "deadline_changed:conquer", "clock_paused:network_busy", "clock_resumed:network_ok",
  ]);
  console.log("ok: every clock change publishes a reason-coded event (open, conquer, restart, network_ok, observed_on_chain)");
}

console.log("\nAll clock and lockout tests passed.");
