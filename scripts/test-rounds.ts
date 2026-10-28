import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../server/clock.ts";
import { RoundManager, classifyAction } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { EVENT_HISTORY, GRACE_SECONDS, RESET_SECONDS } from "../src/refereeParams.ts";

const dir = mkdtempSync(join(tmpdir(), "funge-rounds-"));
const RESET = RESET_SECONDS.steal * 1000;
const GRACE = GRACE_SECONDS * 1000;

async function setup(name: string, clock = fakeClock()) {
  const path = join(dir, `${name}.json`);
  const { store } = await Store.open(path);
  return { path, clock, store, mgr: new RoundManager(store, clock) };
}

// classification
assert.equal(classifyAction("pass"), "steal");
assert.equal(classifyAction("settle"), null);

// waiting: no deadline, stays idle
{
  const { mgr } = await setup("waiting");
  const r = mgr.observe("g", { live: true, passCount: 0 });
  assert.equal(r.status, "waiting");
  assert.equal(r.deadline, null);
  console.log("ok: waiting round has no deadline");
}

// steal sets the deadline; over comes at deadline + grace, not before
{
  const { mgr, clock } = await setup("timer");
  mgr.applyAction("g", "steal", "steal");
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

// a steal resets the deadline again, and events are numbered
{
  const { mgr, clock } = await setup("reset");
  mgr.applyAction("g", "steal", "steal");
  clock.advance(100_000);
  mgr.applyAction("g", "steal", "steal");
  const r = mgr.get("g");
  assert.equal(r.deadline, clock.now() + RESET);
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2]);
  console.log("ok: deadline resets on each steal, events numbered");
}

// pause freezes the clock; resume pushes the deadline out by the pause length
{
  const { mgr, clock } = await setup("pause");
  mgr.applyAction("g", "steal", "steal");
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
  a.mgr.applyAction("open", "steal", "steal");
  a.mgr.applyAction("paused", "steal", "steal");
  a.mgr.pause("paused", "network");
  a.mgr.applyAction("over", "steal", "steal");
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
  for (let i = 0; i < EVENT_HISTORY + 50; i++) mgr.applyAction("g", "steal", "steal");
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

// chain is the truth: no state coin means settled; an unseen steal opens a waiting round
{
  const a = await setup("chain");
  assert.equal(a.mgr.observe("g", { live: false, passCount: 5 }).status, "settled");
  const b = await setup("chain2");
  const r = b.mgr.observe("g", { live: true, passCount: 3 });
  assert.equal(r.status, "open");
  assert.equal(r.events.at(-1)?.reason, "observed_on_chain");
  console.log("ok: chain overrides our record");
}
await new Promise((r) => setTimeout(r, 100)); // let the background saves finish
console.log("\nAll round tests passed.");
process.exit(0);