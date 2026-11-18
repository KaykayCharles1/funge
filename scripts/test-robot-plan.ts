// The next-round robot's decisions (scripts/robot-plan.ts), for every situation it can meet.   node scripts/test-robot-plan.ts
import assert from "node:assert/strict";
import { planRobot, type RobotPlan, type RoundSeen } from "./robot-plan.ts";

const r = (status: string | null, fileAgeMinutes = 30): RoundSeen => ({ status, fileAgeMinutes });
const did = (p: RobotPlan) =>
  (["promote", "replaceCurrent", "dropNext", "deployNext", "redeploy"] as const).filter((k) => p[k]).join(" ") || "nothing";
const plan = (current: RoundSeen, next: RoundSeen | null, replaceUnopened = false) => did(planRobot({ current, next, replaceUnopened }));

// The normal life of a round
assert.equal(plan(r("open"), null), "deployNext", "a round is running and none is prepared: prepare one");
assert.equal(plan(r("waiting"), null), "deployNext");
assert.equal(plan(r("open"), r("waiting")), "nothing", "running, and the next one is ready");
assert.equal(plan(r("over"), r("waiting")), "nothing", "time is up but not settled yet: wait for the keeper");
assert.equal(plan(r("settled"), r("waiting")), "promote deployNext", "settled: promote, then prepare the one after");
assert.equal(plan(r("settled"), r("open")), "promote deployNext", "players already opened the prepared round");
assert.equal(plan(r("settled"), null), "replaceCurrent deployNext", "settled with nothing prepared (the first run)");
console.log("ok    the normal life of a round");

// A rule change (--replace-unopened)
assert.equal(plan(r("waiting"), r("waiting"), true), "replaceCurrent dropNext deployNext", "both unopened: both replaced");
assert.equal(plan(r("open"), r("waiting"), true), "dropNext deployNext", "a round in play is never replaced");
assert.equal(plan(r("settled"), r("waiting"), true), "promote replaceCurrent deployNext", "the promoted round is unopened: replaced too");
assert.equal(plan(r("settled"), r("open"), true), "promote deployNext", "the promoted round is in play: kept");
console.log("ok    a rule change replaces only unopened rounds");

// The referee has not picked a file up
assert.equal(plan(r(null, 1), null), "nothing", "a new file: give it a minute");
assert.equal(plan(r(null, 30), r("waiting")), "redeploy", "an old file it never picked up: restart, change nothing else");
assert.equal(plan(r("open"), r(null, 2)), "nothing", "a new prepared file: give it a minute");
assert.equal(plan(r("open"), r(null, 30)), "redeploy", "a prepared file it never picked up: restart");
assert.equal(plan(r("settled"), r(null, 30)), "promote deployNext", "promote even so: it becomes the current file");
console.log("ok    a file the referee has not picked up");

console.log("\nall robot plan tests passed");
