// The GitHub robot: keeps a next round ready, so a new round can start the moment the current one is settled.
//   public/game.<network>.kingdom.json   the current round
//   public/game.<network>.next.json      the prepared next round: deployed, waiting; the referee keeps it closed
//                                        until the current round is settled (server/gameRegistry.ts)
// Each run: if the current round is settled, the prepared one becomes current; then, if no round is prepared, it
// deploys one (paid by the deploy wallet). The referee picks the files up from the site by itself, so Render is only
// restarted when it has not picked a file up for 5 minutes. What to do is decided in scripts/robot-plan.ts.
//   node scripts/next-round.ts [<server address>]     (default https://referee.funge.cash)
//   node scripts/next-round.ts --check                (only say what it would do; never deploys)
//   node scripts/next-round.ts --replace-unopened     (after a rule change: replace the prepared round, and the
//                                                      current one too if nobody has opened it)
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { planRobot, type RoundSeen } from "./robot-plan.ts";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const replaceUnopened = args.includes("--replace-unopened");
const server = (args.find((a) => !a.startsWith("--")) ?? "https://referee.funge.cash").replace(/\/$/, "");
const CURRENT = `public/game.${CONFIG.network}.kingdom.json`;
const NEXT = `public/game.${CONFIG.network}.next.json`;

// The Referee may be waking up or restarting: try a few times before giving up.
async function roundStatus(id: string): Promise<string | null> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${server}/rounds/${id}`, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`status ${res.status}`);
      return String(((await res.json()) as { status?: string }).status);
    } catch (e) {
      if (i === 3) throw e;
      console.log(`The Referee did not answer (${e instanceof Error ? e.message : e}), trying again in 20 s.`);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

// How long ago the file was last committed (a new file the referee has not picked up yet is normal for a minute)
function fileAgeMinutes(file: string): number {
  const committed = Number(spawnSync("git", ["log", "-1", "--format=%ct", "--", file], { encoding: "utf8" }).stdout.trim());
  return committed ? (Date.now() / 1000 - committed) / 60 : Infinity;
}

type GameFile = { gameCategory: string; refereePubkey: string };
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as GameFile;
async function seen(file: string, game: GameFile): Promise<RoundSeen> {
  const status = await roundStatus(game.gameCategory);
  console.log(`${file === CURRENT ? "Current" : "Prepared"} round ${game.gameCategory.slice(0, 8)}… on ${server}: ${status ?? "not known to the Referee"}`);
  return { status, fileAgeMinutes: fileAgeMinutes(file) };
}

const current = read(CURRENT);
const nextGame = existsSync(NEXT) ? read(NEXT) : null;
if (!nextGame) console.log("No prepared round yet.");
const plan = planRobot({
  current: await seen(CURRENT, current),
  next: nextGame ? await seen(NEXT, nextGame) : null,
  replaceUnopened,
});
for (const n of plan.notes) console.log(n);

// On GitHub, tell the workflow what to do next: "deployed" (commit the files) and/or "redeploy" (restart the Referee)
const tellWorkflow = (key: string, value: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
if (plan.redeploy) tellWorkflow("redeploy", "yes");
if (checkOnly) console.log("(--check: nothing changed)");

const deploy = (asNext: boolean) => {
  const run = spawnSync(
    process.execPath,
    ["scripts/deploy-kingdom.ts", current.refereePubkey, ...(asNext ? ["--next"] : [])],
    { stdio: "inherit" },
  );
  if (run.status !== 0) process.exit(run.status ?? 1);
};

let changed = false;
if (checkOnly) {
  // nothing to do
} else if (plan.promote) {
  writeFileSync(CURRENT, readFileSync(NEXT));
  rmSync(NEXT);
  changed = true;
}
if (!checkOnly && plan.replaceCurrent) {
  rmSync(CURRENT);
  deploy(false);
  changed = true;
}
if (!checkOnly && plan.dropNext && existsSync(NEXT)) {
  rmSync(NEXT);
  changed = true;
}
if (!checkOnly && plan.deployNext) {
  if (existsSync(NEXT)) rmSync(NEXT);
  deploy(true);
  changed = true;
}
if (changed) tellWorkflow("action", "deployed");
