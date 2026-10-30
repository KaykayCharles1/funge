// Run with NO server running: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/chaos-restart.ts
// Starts the server itself, hard-kills it mid-round, brings it back, and checks the clock.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { act, getEvents, getHealth } from "../src/referee/api.ts";
import { buildBody, check, chainPass, describe, id, results, serverView, sleep, waitForPass } from "./chaos-lib.ts";

const DOWNTIME_MS = 20_000;
const TOLERANCE_MS = 6_000; // a heartbeat is saved every 5 s, so the restored clock can differ by about that much

const childEnv: Record<string, string | undefined> = { ...process.env, FUNGE_RESET_SECONDS: "120", FUNGE_KEEPER_DELAY_SECONDS: "900" };
delete childEnv.SPIKE_MNEMONIC; // the server never needs it
let server: ChildProcess | null = null;

function start() {
  server = spawn(process.execPath, ["server/index.ts"], { env: childEnv, stdio: ["ignore", "inherit", "inherit"] });
}

async function waitHealthy() {
  for (let i = 0; i < 80; i++) {
    if (await getHealth()) return;
    await sleep(500);
  }
  throw new Error("The server did not start in time.");
}

// A hard kill: no clean shutdown, like a crash or a power cut
async function crash() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  const gone = new Promise<void>((r) => s.once("exit", () => r()));
  s.kill("SIGKILL");
  await gone;
}

try {
  check("no server is running yet", (await getHealth()) === null, "stop it with Ctrl+C first if this fails");
  if (results.failed > 0) throw new Error("A server is already running.");
  start();
  await waitHealthy();

  const first = await buildBody();
  const r1 = await act(id, first.body);
  check("a grab starts the clock", r1.ok, describe(r1));
  if (!r1.ok) throw new Error("The first grab was refused.");
  await waitForPass(first.passCount + 1);
  await sleep(7000); // make sure a heartbeat has been saved

  const before = await serverView();
  const remBefore = before.round.remainingMs;
  if (before.round.status !== "open" || remBefore === null) throw new Error("The clock is not running.");
  console.log(`\nBefore the crash: ${Math.round(remBefore / 1000)} s left on the clock.`);
  await crash();
  console.log(`Server killed. Staying down for ${DOWNTIME_MS / 1000} s…`);
  await sleep(DOWNTIME_MS);
  start();
  await waitHealthy();

  const after = await serverView();
  const remAfter = after.round.remainingMs;
  console.log(`After the restart: ${remAfter === null ? "no clock" : `${Math.round(remAfter / 1000)} s`} left.\n`);
  check(
    "the clock resumed where it stopped (the downtime did not count)",
    remAfter !== null && Math.abs(remAfter - remBefore) <= TOLERANCE_MS,
    `before ${Math.round(remBefore / 1000)} s, after ${remAfter === null ? "none" : Math.round(remAfter / 1000)} s`,
  );
  check("the round is still open after the restart", after.round.status === "open" && after.round.paused === null);
  check("the pass count survived", after.round.passCount === first.passCount + 1);
  const ev = await getEvents(id, 0);
  check(
    "a 'clock resumed after restart' event was published",
    ev.ok && ev.events.some((e) => e.type === "clock_resumed" && e.reason === "restart"),
  );

  const next = await buildBody();
  const r2 = await act(id, next.body);
  check("a grab after the restart is accepted", r2.ok, describe(r2));
  if (r2.ok) {
    await waitForPass(next.passCount + 1);
    check("the chain moved by one pass", (await chainPass()) === next.passCount + 1);
  }
} catch (e) {
  results.failed++;
  console.log("STOPPED:", e instanceof Error ? e.message : e);
} finally {
  await crash();
}
console.log(results.failed === 0 ? "\nRestart handling works." : `\n${results.failed} check(s) FAILED.`);
console.log("The round is still unsettled. Start the server normally to let it finish: npm run server");
process.exit(results.failed === 0 ? 0 : 1);