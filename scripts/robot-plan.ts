// What the next-round robot (scripts/next-round.ts) should do, from what the referee says about the round files.
// Kept apart from the doing so it can be tested (scripts/test-robot-plan.ts).
//   current: the round in game.<network>.kingdom.json. next: the prepared round in game.<network>.next.json.
//   A status is the referee's: "waiting" | "open" | "over" | "settled", or null when the referee does not know it.

export type RoundSeen = { status: string | null; fileAgeMinutes: number };
export type RobotPlan = {
  promote: boolean; // the current round is settled: the prepared round becomes the current one
  replaceCurrent: boolean; // deploy a new current round (no prepared one to promote, or a rule change)
  dropNext: boolean; // throw away the prepared round (a rule change: it was deployed with the old rules)
  deployNext: boolean; // prepare a next round
  redeploy: boolean; // the referee has not picked up a round file for 5 minutes: restart it on Render
  notes: string[];
};

const STALE_MINUTES = 5;

export function planRobot(o: { current: RoundSeen; next: RoundSeen | null; replaceUnopened: boolean }): RobotPlan {
  const plan: RobotPlan = { promote: false, replaceCurrent: false, dropNext: false, deployNext: false, redeploy: false, notes: [] };
  const { current, replaceUnopened } = o;
  let next = o.next;

  // The referee should pick up a new file within a minute or two (Cloudflare publishes it, the referee reads it every
  // 10 s). Much later than that, something is wrong: ask for a restart, and change nothing until it knows the round.
  if (current.status === null) {
    if (current.fileAgeMinutes > STALE_MINUTES) {
      plan.redeploy = true;
      plan.notes.push("The referee does not know the current round, and the file is not new: restart it.");
    } else {
      plan.notes.push("The referee is probably still picking up the current round: nothing to do yet.");
    }
    return plan;
  }

  let currentStatus: string | null = current.status;
  if (currentStatus === "settled" && next) {
    plan.promote = true;
    plan.notes.push("The current round is settled: the prepared round becomes the current one.");
    currentStatus = next.status;
    next = null;
  }
  if (currentStatus === "settled") {
    plan.replaceCurrent = true; // no prepared round (the first run, or it was dropped): deploy one now
    plan.notes.push("The current round is settled and none is prepared: deploying a new current round.");
  } else if (replaceUnopened && currentStatus === "waiting") {
    plan.replaceCurrent = true;
    plan.notes.push("Rule change: the current round is unopened, so it is replaced.");
  }
  if (next && replaceUnopened) {
    plan.dropNext = true; // the prepared round can only be unopened here (an opened one would have been promoted)
    plan.notes.push("Rule change: the prepared round is replaced.");
    next = null;
  }
  if (!next) {
    plan.deployNext = true;
    plan.notes.push("Preparing the next round.");
  } else if (next.status === null && next.fileAgeMinutes > STALE_MINUTES) {
    plan.redeploy = true;
    plan.notes.push("The referee has not picked up the prepared round for 5 minutes: restart it.");
  }
  if (!plan.promote && !plan.replaceCurrent && !plan.dropNext && !plan.deployNext && !plan.redeploy) {
    plan.notes.push("Nothing to do: a round is running and the next one is ready.");
  }
  return plan;
}
