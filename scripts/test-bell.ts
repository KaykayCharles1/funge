import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../server/clock.ts";
import { RoundManager, classifyKingdomAction } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { clockSecondsFor, nextClockSecondsFor, validateBell } from "../src/lib/bell.ts";
import { BELL_PRESETS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../src/refereeParams.ts";

const dir = mkdtempSync(join(tmpdir(), "funge-bell-"));
const std = BELL_PRESETS.standard;
const demo = BELL_PRESETS.demo;
const GRACE = GRACE_SECONDS * 1000;
const LOCK = PROTECT_LOCKOUT_SECONDS * 1000;

async function setup(name: string, bell = std) {
  const clock = fakeClock();
  const { store } = await Store.open(join(dir, `${name}.json`));
  const mgr = new RoundManager(store, clock);
  mgr.setBell("k", bell);
  return { clock, store, mgr, path: join(dir, `${name}.json`) };
}
const reasons = (mgr: RoundManager) => mgr.get("k").events.map((e) => e.reason);

// --- the presets are what was decided ---
assert.deepEqual(std, { startSeconds: 600, stepSeconds: 30, floorSeconds: 120 });
assert.deepEqual(demo, { startSeconds: 300, stepSeconds: 30, floorSeconds: 120 });
assert.equal(PROTECT_LOCKOUT_SECONDS, 30);
console.log("ok: presets (standard 10:00, demo 5:00, step 0:30, floor 2:00) and the 30 s protect lockout");

// --- the bell table ---
{
  const at = (n: number, s = std) => clockSecondsFor(n, s);
  assert.deepEqual([1, 2, 3, 4].map((n) => at(n)), [600, 570, 540, 510]); // 10:00, 9:30, 9:00, 8:30
  assert.equal(at(16), 150);
  assert.equal(at(17), 120); // reaches the floor
  assert.equal(at(18), 120);
  assert.equal(at(500), 120);
  assert.deepEqual([1, 2, 7, 8, 9].map((n) => at(n, demo)), [300, 270, 120, 120, 120]);
  assert.equal(nextClockSecondsFor(0, std), 600); // waiting: the open gets the start
  assert.equal(nextClockSecondsFor(1, std), 570);
  assert.equal(nextClockSecondsFor(3, std), 510); // "Next conquest clock: 8:30"
  assert.equal(nextClockSecondsFor(17, std), 120);
  assert.throws(() => clockSecondsFor(0, std));
  assert.throws(() => clockSecondsFor(1.5, std));
  console.log("ok: bell table 10:00, 9:30, 9:00, 8:30 ... floor 2:00 (demo 5:00 ... 2:00); next-clock value");
}

// --- bad settings are refused ---
{
  assert.throws(() => validateBell({ startSeconds: 100, stepSeconds: 30, floorSeconds: 200 }));
  assert.throws(() => validateBell({ startSeconds: 0, stepSeconds: 30, floorSeconds: 0 }));
  assert.throws(() => validateBell({ startSeconds: 600, stepSeconds: -1, floorSeconds: 120 }));
  assert.throws(() => validateBell({ startSeconds: 600, stepSeconds: 0.5, floorSeconds: 120 }));
  validateBell({ startSeconds: 600, stepSeconds: 0, floorSeconds: 600 }); // a flat clock is allowed
  console.log("ok: invalid bell settings are refused");
}

// --- classification ---
assert.equal(classifyKingdomAction("open"), "open");
assert.equal(classifyKingdomAction("conquer"), "conquer");
assert.equal(classifyKingdomAction("protect"), "protect");
assert.equal(classifyKingdomAction("settle"), null);
console.log("ok: action classification (settle never touches the clock)");

// --- open and conquer set the clock to the bell, not to what was left ---
{
  const { clock, mgr } = await setup("flow");
  assert.equal(mgr.observe("k", { live: true, passCount: 0 }).status, "waiting");
  assert.equal(mgr.get("k").deadline, null);

  mgr.applyKingdomAction("k", "open", 1);
  assert.equal(mgr.get("k").deadline, clock.now() + 600_000);
  clock.advance(100_000); // 500 s left
  mgr.applyKingdomAction("k", "conquer", 2);
  assert.equal(mgr.get("k").deadline, clock.now() + 570_000); // reset to the bell (9:30), not 500 + anything
  clock.advance(10_000);
  mgr.applyKingdomAction("k", "conquer", 3);
  assert.equal(mgr.get("k").deadline, clock.now() + 540_000);
  const last = mgr.get("k").events.at(-1)!;
  assert.deepEqual(
    [last.type, last.reason, last.data?.clockSeconds, last.data?.nextClockSeconds, last.data?.passCount, last.data?.action],
    ["deadline_changed", "conquer", 540, 510, 3, "conquer"],
  );
  assert.deepEqual(reasons(mgr), ["open", "conquer", "conquer"]);
  console.log("ok: open 10:00, conquest resets to the bell (9:30, 9:00), events say why and what comes next");
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
  // conquest is not affected by the lockout: the clock check for conquest is the old rule, untouched
  assert.equal(mgr.observe("k", { live: true, passCount: 1 }).status, "open");
  clock.set(deadline - 5_000);
  assert.equal(mgr.observe("k", { live: true, passCount: 1 }).status, "open"); // conquest still possible at 5 s
  // a custom lockout is honoured
  assert.equal(mgr.protectCheck("k", deadline - 10_000, 5).ok, true);
  assert.equal(mgr.protectCheck("k", deadline - 4_000, 5).ok, false);
  // paused: refused with its own reason, and the remaining time is the frozen one
  clock.set(deadline - 200_000);
  mgr.pause("k", "network_busy");
  clock.advance(1_000_000);
  assert.deepEqual(mgr.protectCheck("k", clock.now()), { ok: false, why: "paused", remainingMs: 200_000 });
  mgr.resume("k", "network_ok");
  assert.equal(mgr.protectCheck("k", clock.now()).ok, true);
  // over and settled
  clock.set(mgr.get("k").deadline! + GRACE);
  mgr.observe("k", { live: true, passCount: 1 });
  assert.equal(mgr.protectCheck("k", clock.now()).ok, false);
  mgr.markSettled("k", "tx", "keeper");
  assert.equal(mgr.protectCheck("k", clock.now()).ok, false);
  console.log("ok: protect refused in the last 30 s (30.001 s open, 30.000 s closed), when waiting, paused, over or settled; conquest unaffected");
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
  const noBell = new RoundManager((await Store.open(join(dir, "nobell.json"))).store, fakeClock());
  assert.throws(() => noBell.applyKingdomAction("g", "open", 1), /no bell/);
  console.log("ok: protect/open/conquer applied in a wrong state is a programming error, never a silent change");
}

// --- a conquest the timer did not see (made outside /act) restarts the clock at the bell for that pass ---
{
  const { clock, mgr } = await setup("observed");
  mgr.applyKingdomAction("k", "open", 1);
  clock.advance(30_000);
  const r = mgr.observe("k", { live: true, passCount: 3 }); // two conquests happened elsewhere
  assert.equal(r.deadline, clock.now() + 540_000);
  const ev = r.events.at(-1)!;
  assert.deepEqual([ev.reason, ev.data?.clockSeconds, ev.data?.nextClockSeconds, ev.data?.passCount], ["observed_on_chain", 540, 510, 3]);
  // an open seen on chain while we were waiting
  const b = await setup("observed2");
  b.mgr.observe("k", { live: true, passCount: 0 });
  b.mgr.observe("k", { live: true, passCount: 1 });
  assert.equal(b.mgr.get("k").deadline, b.clock.now() + 600_000);
  console.log("ok: an open or conquest seen only on the chain restarts the clock at that pass's bell, reason observed_on_chain");
}

// --- demo preset ---
{
  const { clock, mgr } = await setup("demo", demo);
  mgr.applyKingdomAction("k", "open", 1);
  assert.equal(mgr.get("k").deadline, clock.now() + 300_000);
  for (let n = 2; n <= 9; n++) mgr.applyKingdomAction("k", "conquer", n);
  assert.equal(mgr.get("k").deadline, clock.now() + 120_000);
  assert.deepEqual(mgr.bellInfo("k", 9), { clockSeconds: 120, nextClockSeconds: 120, floorSeconds: 120 });
  assert.deepEqual(mgr.bellInfo("k", 0), { clockSeconds: null, nextClockSeconds: 300, floorSeconds: 120 });
  assert.equal(new RoundManager((await Store.open(join(dir, "nb.json"))).store, fakeClock()).bellInfo("x", 1), null);
  console.log("ok: demo preset 5:00 down to 2:00, bell info for the round description");
}

// --- pause, resume and restart still behave with the bell ---
{
  const a = await setup("restart");
  a.mgr.applyKingdomAction("k", "open", 1);
  a.mgr.applyKingdomAction("k", "conquer", 2);
  const deadline = a.mgr.get("k").deadline!;
  a.mgr.heartbeat();
  await a.store.save();
  a.clock.advance(90_000); // the server was down for 90 s
  const { store } = await Store.open(a.path);
  const mgr2 = new RoundManager(store, a.clock);
  mgr2.setBell("k", std);
  mgr2.resumeAfterRestart(["k"]);
  assert.equal(mgr2.get("k").deadline, deadline + 90_000);
  assert.equal(mgr2.get("k").events.at(-1)!.reason, "restart");
  console.log("ok: downtime still counts as a pause (reason restart) for a bell game");
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
  step("conquer", () => { clock.advance(5_000); mgr.applyKingdomAction("k", "conquer", 2); }, true);
  step("pause", () => { clock.advance(5_000); mgr.pause("k", "network_busy"); }, false);
  step("resume", () => { clock.advance(20_000); mgr.resume("k", "network_ok"); }, true);
  assert.deepEqual(r.events.map((e) => `${e.type}:${e.reason}`), [
    "deadline_changed:open", "protect_applied:protect", "deadline_changed:conquer", "clock_paused:network_busy", "clock_resumed:network_ok",
  ]);
  console.log("ok: every clock change publishes a reason-coded event (open, conquer, restart, network_ok, observed_on_chain)");
}

console.log("\nAll bell and lockout tests passed.");