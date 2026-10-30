// Run with NO server running: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/chaos-busy.ts
// Starts the server with a cap of 3 unconfirmed grabs, goes over it, and watches the pause lift at the next block.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { act, getEvents, getHealth } from "../src/referee/api.ts";
import { buildBody, chainPass, check, describe, id, provider, results, serverView, sleep, waitForPass } from "./chaos-lib.ts";

const CAP = 3;
const MAX_WAIT_MS = 30 * 60 * 1000;

const childEnv: Record<string, string | undefined> = {
  ...process.env,
  FUNGE_RESET_SECONDS: "600",
  FUNGE_KEEPER_DELAY_SECONDS: "3600",
  FUNGE_UNCONFIRMED_CAP: String(CAP),
};
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

async function stopServer() {
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

  let passNow = 0;
  for (let i = 1; i <= CAP; i++) {
    const g = await buildBody();
    const r = await act(id, g.body);
    check(`grab ${i} of ${CAP} is accepted`, r.ok, describe(r));
    if (!r.ok) throw new Error("A normal grab was refused.");
    await waitForPass(g.passCount + 1);
    passNow = g.passCount + 1;
  }

  const over = await buildBody();
  const refused = await act(id, over.body);
  if (refused.ok) throw new Error("INCONCLUSIVE: a block arrived while the grabs were going in, so the cap was not reached. Run it again.");
  check("the grab over the cap is refused as 'network busy'", refused.error === "network_busy", describe(refused));
  check("the refused grab never reached the chain", (await chainPass()) === passNow);

  const v1 = await serverView();
  check("the clock is paused with the reason network_busy", v1.round.paused?.reason === "network_busy", String(v1.round.paused?.reason));
  const remA = v1.round.remainingMs;
  await sleep(6000);
  const remB = (await serverView()).round.remainingMs;
  check(
    "the clock stays frozen while the network is busy",
    remA !== null && remB !== null && Math.abs(remA - remB) <= 1500,
    `${remA === null ? "none" : Math.round(remA / 1000)} s, then ${remB === null ? "none" : Math.round(remB / 1000)} s`,
  );

  console.log("\nWaiting for the next block (this can take up to about 10 minutes)…");
  const started = Date.now();
  let lastPrint = started;
  let resumed: Awaited<ReturnType<typeof serverView>> | null = null;
  while (Date.now() - started < MAX_WAIT_MS) {
    const v = await serverView();
    if (v.round.paused === null) {
      resumed = v;
      break;
    }
    if (Date.now() - lastPrint >= 60_000) {
      lastPrint = Date.now();
      console.log(`  still paused after ${Math.round((Date.now() - started) / 60000)} min, chain height ${await provider.getBlockHeight()}`);
    }
    await sleep(10_000);
  }
  check("a new block lifted the pause", resumed !== null, `${Math.round((Date.now() - started) / 1000)} s`);
  if (!resumed) throw new Error("The pause was never lifted.");

  const remC = resumed.round.remainingMs;
  check(
    "the clock continued from where it froze",
    remC !== null && remB !== null && Math.abs(remC - remB) <= 15_000,
    `${remB === null ? "none" : Math.round(remB / 1000)} s frozen, ${remC === null ? "none" : Math.round(remC / 1000)} s after`,
  );
  const ev = await getEvents(id, 0);
  check(
    "the events show the pause and the resume",
    ev.ok &&
      ev.events.some((e) => e.type === "clock_paused" && e.reason === "network_busy") &&
      ev.events.some((e) => e.type === "clock_resumed" && e.reason === "network_ok"),
  );

  const again = await buildBody();
  const ra = await act(id, again.body);
  check("a grab after the block is accepted", ra.ok, describe(ra));
  if (ra.ok) {
    await waitForPass(again.passCount + 1);
    check("the chain moved by one pass", (await chainPass()) === again.passCount + 1);
  }
} catch (e) {
  results.failed++;
  console.log("STOPPED:", e instanceof Error ? e.message : e);
} finally {
  await stopServer();
}
console.log(results.failed === 0 ? "\nThe busy-network pause works." : `\n${results.failed} check(s) FAILED.`);
console.log("The round is still unsettled. Start the server normally to let it finish: npm run server");
process.exit(results.failed === 0 ? 0 : 1);