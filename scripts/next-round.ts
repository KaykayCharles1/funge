// The GitHub robot runs this every 15 minutes. If the round in public/game.<network>.kingdom.json is over,
// it deploys the next one with the same referee key, which rewrites that file. Otherwise it does nothing.
//   node scripts/next-round.ts [<server address>]     (default https://referee.funge.cash)
//   node scripts/next-round.ts --check                (only say what it would do; never deploys)
// Read-only unless the round is settled. The workflow commits the new file and redeploys the Referee.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { CONFIG } from "../src/config.ts";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const server = (args.find((a) => !a.startsWith("--")) ?? "https://referee.funge.cash").replace(/\/$/, "");
const FILE = `public/game.${CONFIG.network}.kingdom.json`;

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

const game = JSON.parse(readFileSync(FILE, "utf8")) as { gameCategory: string; refereePubkey: string };
const status = await roundStatus(game.gameCategory);
console.log(`Round ${game.gameCategory.slice(0, 8)}… on ${server}: ${status ?? "not known to the Referee"}`);

// On GitHub, tell the workflow what to do next: "deployed" (commit and redeploy) or "redeploy" (redeploy only).
const tellWorkflow = (action: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `action=${action}\n`);

if (status === null) {
  // The Referee has not loaded this game yet: a redeploy is still running, or it failed and needs another go.
  console.log("Nothing to do here: the Referee has not loaded this game yet.");
  tellWorkflow("redeploy");
} else if (status !== "settled") {
  console.log("Nothing to do: the round is still going.");
} else if (checkOnly) {
  console.log("The round is over: without --check, this would deploy the next one.");
} else {
  console.log("The round is over: deploying the next one.");
  rmSync(FILE);
  const run = spawnSync(process.execPath, ["scripts/deploy-kingdom.ts", game.refereePubkey], { stdio: "inherit" });
  if (run.status === 0) tellWorkflow("deployed");
  process.exit(run.status ?? 1);
}
