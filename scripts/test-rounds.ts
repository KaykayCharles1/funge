import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../server/clock.ts";
import { RoundManager } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { CLOCK_SETTINGS, EVENT_HISTORY, GRACE_SECONDS } from "../src/refereeParams.ts";

const dir = mkdtempSync(join(tmpdir(), "funge-rounds-"));
const clockSettings = CLOCK_SETTINGS;
const RESET = clockSettings.capSeconds * 1000; // the clock the open sets (pass 1): the cap
const GRACE = GRACE_SECONDS * 1000;

async function setup(name: string, clock = fakeClock()) {
  const path = join(dir, `${name}.json`);
  const { store } = await Store.open(path);
  const mgr = new RoundManager(store, clock);
  for (const id of ["g", "open", "paused", "over", "old", "live", "lost"]) mgr.setClock(id, clockSettings);
  return { path, clock, store, mgr };
}

// The n-th move of a round: pass 1 is the open, later passes are conquests. The clock follows src/lib/kingdomClock.ts.
function move(mgr: RoundManager, id: string, passCount = 1) {
  return mgr.applyKingdomAction(id, passCount === 1 ? "open" : "conquer", passCount);
}

// waiting: no deadline, stays idle
{
  const { mgr } = await setup("waiting");
  const r = mgr.observe("g", { live: true, passCount: 0 });
  assert.equal(r.status, "waiting");
  assert.equal(r.deadline, null);
  console.log("ok: waiting round has no deadline");
}

// the open sets the deadline; over comes at deadline + grace, not before
{
  const { mgr, clock } = await setup("timer");
  move(mgr, "g", 1);
  const r = mgr.get("g");
  assert.equal(r.status, "open");
  assert.equal(r.deadline, clock.now() + RESET);
  const deadline = r.deadline!;
  clock.set(deadline + GRACE - 1);
  assert.equal(mgr.observe("g", { live: true, passCount: 1 }).status, "open");
  clock.set(deadline + GRACE);
  assert.equal(mgr.observe("g", { live: true, passCount: 1 }).status, "over");
  assert.equal(r.events.at(-1)?.type, "round_over");
  console.log("ok: open until deadline + grace, then over");
}

// a conquest adds 0:30 to the time left (3:20 left -> 3:50), and events are numbered
{
  const { mgr, clock } = await setup("reset");
  move(mgr, "g", 1);
  clock.advance(100_000);
  move(mgr, "g", 2);
  const r = mgr.get("g");
  assert.equal(r.deadline, clock.now() + 230_000);
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2]);
  console.log("ok: a conquest adds 0:30 to the time left, events numbered");
}

// pause freezes the clock; resume pushes the deadline out by the pause length
{
  const { mgr, clock } = await setup("pause");
  move(mgr, "g", 1);
  const before = mgr.get("g").deadline!;
  clock.advance(60_000);
  mgr.pause("g", "network");
  clock.advance(300_000);
  assert.equal(mgr.observe("g", { live: true, passCount: 1 }).status, "open"); // frozen
  mgr.resume("g", "network_ok");
  assert.equal(mgr.get("g").deadline, before + 300_000);
  console.log("ok: pause freezes the clock");
}

// restart: downtime is a pause for open rounds only
{
  const a = await setup("restart");
  move(a.mgr, "open");
  move(a.mgr, "paused");
  a.mgr.pause("paused", "network");
  move(a.mgr, "over");
  a.clock.advance(RESET + GRACE);
  a.mgr.observe("over", { live: true, passCount: 1 });
  const openDeadline = a.mgr.get("open").deadline!;
  const pausedDeadline = a.mgr.get("paused").deadline!;
  a.mgr.heartbeat();
  await a.mgr.flush();
  a.clock.advance(90_000); // the server is down for 90 s

  const { store } = await Store.open(a.path);
  const m2 = new RoundManager(store, a.clock);
  m2.resumeAfterRestart();
  assert.equal(m2.get("open").deadline, openDeadline + 90_000);
  assert.equal(m2.get("paused").deadline, pausedDeadline);
  assert.equal(m2.get("over").status, "over");
  const last = m2.get("open").events.at(-1)!;
  assert.equal(last.type, "clock_resumed");
  assert.equal(last.reason, "restart");
  assert.equal(last.data?.downtimeMs, 90_000);
  assert.equal(last.seq, 2); // numbering continues after the restart
  console.log("ok: restart pushes out open rounds by the downtime");
}

// resync after too many events
{
  const { mgr } = await setup("resync");
  for (let i = 0; i < EVENT_HISTORY + 50; i++) move(mgr, "g", i + 1);
  const r = mgr.get("g");
  assert.equal(r.events.length, EVENT_HISTORY);
  assert.equal(mgr.eventsAfter("g", 0).resync, true);
  const last = r.nextSeq - 1;
  const recent = mgr.eventsAfter("g", last - 5);
  assert.equal(recent.resync, false);
  assert.equal(recent.events.length, 5);
  assert.equal(mgr.eventsAfter("g", last).events.length, 0);
  console.log("ok: reconnect resync");
}

// chain is the truth: no state coin means settled; an unseen move opens a waiting round
{
  const a = await setup("chain");
  assert.equal(a.mgr.observe("g", { live: false, passCount: 5 }).status, "settled");
  const b = await setup("chain2");
  const r = b.mgr.observe("g", { live: true, passCount: 3 });
  assert.equal(r.status, "open");
  assert.equal(r.events.at(-1)?.reason, "observed_on_chain");
  console.log("ok: chain overrides our record");
}

// a move made outside /act still follows the clock rule
{
  const { mgr, clock } = await setup("unseen");
  move(mgr, "g", 1);
  clock.advance(100_000);
  mgr.observe("g", { live: true, passCount: 1 });
  assert.equal(mgr.get("g").events.length, 1); // nothing new
  mgr.observe("g", { live: true, passCount: 2 });
  assert.equal(mgr.get("g").deadline, clock.now() + 230_000);
  assert.equal(mgr.get("g").events.at(-1)?.reason, "observed_on_chain");
  console.log("ok: moves made outside /act follow the clock rule");
}

// a move that is being processed holds the round open, so there is no "over" flash
{
  const { mgr, clock } = await setup("hold");
  move(mgr, "g", 1);
  const deadline = mgr.get("g").deadline!;
  clock.set(deadline + GRACE + 500);
  const release = mgr.hold("g");
  assert.equal(mgr.observe("g", { live: true, passCount: 1 }).status, "open");
  assert.equal(mgr.get("g").events.some((e) => e.type === "round_over"), false);
  release();
  release(); // releasing twice is harmless
  assert.equal(mgr.observe("g", { live: true, passCount: 1 }).status, "over");
  console.log("ok: a move in progress keeps the round open");
}

// restart only touches rounds of loaded games; old settled rounds are pruned, unsettled ones kept
{
  const a = await setup("orphans");
  move(a.mgr, "old");
  move(a.mgr, "live");
  move(a.mgr, "lost");
  a.mgr.observe("old", { live: false, passCount: 1 }); // settled
  a.mgr.heartbeat();
  await a.mgr.flush();
  a.clock.advance(30_000);
  const { store } = await Store.open(a.path);
  const m2 = new RoundManager(store, a.clock);
  assert.equal(m2.pruneSettled(["live"]), 1);
  assert.equal(store.data.rounds["old"], undefined);
  m2.resumeAfterRestart(["live"]);
  assert.equal(m2.get("live").events.at(-1)?.reason, "restart");
  assert.equal(m2.get("lost").events.length, 1); // untouched
  console.log("ok: restart and pruning only concern loaded games");
}

await new Promise((r) => setTimeout(r, 100)); // let the background saves finish
console.log("\nAll round tests passed.");
process.exit(0);