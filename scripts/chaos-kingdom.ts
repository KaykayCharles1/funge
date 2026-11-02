// Live chipnet chaos test for the Kingdom, with two game wallets and a server this script starts (and kills) itself.
//
// Before you run it (the round must be WAITING and no server may be running):
//   rm public/game.chipnet.kingdom.json
//   node scripts/deploy-kingdom.ts
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   read -rs SPIKE_MNEMONIC_2; export SPIKE_MNEMONIC_2
//   node scripts/chaos-kingdom.ts
// Each wallet needs at least 40.00 PUSD (4000 units) and about 30,000 sats of BCH. The run takes about 12 minutes.
//
// What it checks:
//   S1  the same open sent twice at once: exactly one is accepted; a later copy is refused
//   S2  a stale price is refused before anything is sent; a move built on an old state is refused by the server
//   S3  a conquest and a protect built on the same state, sent at the same moment: exactly one wins
//   S4  the server is killed hard and brought back: the clock resumes where it stopped
//   S5  a protect in the last seconds is refused (protect_locked)
//   S6  conquests 0.3 s before the deadline and 0.5 s after (inside the grace) are accepted; 1.5 s after is refused
//   S7  the keeper settles the round, and the PUSD of both wallets plus the pool is conserved at every step
//   S8  a burst of requests is rate limited and the server stays healthy
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { TransactionBuilder } from "cashscript";
import { CONFIG } from "../src/config.ts";
import { findEndedKingdom } from "../src/endedKingdom.ts";
import { conquestMoney } from "../src/lib/kingdom.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { act, getEvents, getHealth, getRound } from "../src/referee/api.ts";
import {
  addKingdomOutputs, addProtectOutputs, claimsFor, kingdomAct, kingdomContracts, pickWalletCoins, planKingdomAction, planProtect,
  protectUnlocker, readKingdomCoins, stateUnlocker,
} from "../src/referee/kingdomActions.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import type { LocalWallet } from "../src/wallet/local.ts";
import { loadArtifact } from "./helpers.ts";

const game = JSON.parse(readFileSync(new URL(`../public/game.${CONFIG.network}.kingdom.json`, import.meta.url), "utf8"));
const id: string = game.gameCategory;
const m1 = process.env.SPIKE_MNEMONIC;
const m2 = process.env.SPIKE_MNEMONIC_2;
if (!m1 || !m2) throw new Error("Set SPIKE_MNEMONIC and SPIKE_MNEMONIC_2 first (two different wallets).");
const A = walletFromMnemonic(m1);
const B = walletFromMnemonic(m2);
if (A.pkhHex === B.pkhHex) throw new Error("The two wallets must be different.");
const provider = makeProvider();
const artifacts = { pot: loadArtifact("FungePot"), kingdom: loadArtifact("FungeKingdom") };
const params = { feePercent: BigInt(game.params.feePercent), cutPercent: BigInt(game.params.cutPercent) };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nameOf = (pkh: string | null) => (pkh === A.pkhHex ? "A" : pkh === B.pkhHex ? "B" : "?");
const walletOf = (pkh: string): LocalWallet => (pkh === A.pkhHex ? A : B);
const otherOf = (w: LocalWallet): LocalWallet => (w === A ? B : A);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const describe = (r: { ok: boolean; error?: string }) => (r.ok ? "accepted" : `refused: ${r.error}`);

// ---------- the server this script runs ----------
const childEnv: Record<string, string | undefined> = {
  ...process.env,
  FUNGE_BELL_PRESET: "demo", // 5:00 clock, 30 s shorter per conquest, floor 2:00
  FUNGE_KEEPER_DELAY_SECONDS: "20", // the keeper settles 20 s after time is up
};
delete childEnv.SPIKE_MNEMONIC; // the server never needs a seed
delete childEnv.SPIKE_MNEMONIC_2;
let server: ChildProcess | null = null;
const startServer = () => {
  server = spawn(process.execPath, ["server/index.ts"], { env: childEnv, stdio: ["ignore", "inherit", "inherit"] });
};
async function waitHealthy() {
  for (let i = 0; i < 80; i++) {
    if (await getHealth()) return;
    await sleep(500);
  }
  throw new Error("The server did not start in time.");
}
// A hard kill: no clean shutdown, like a crash or a power cut
async function crashServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  const gone = new Promise<void>((r) => s.once("exit", () => r()));
  s.kill("SIGKILL");
  await gone;
}

// ---------- the chain and the server, as this test sees them ----------
async function chainNow() {
  const live = await readKingdomCoins(game, provider);
  if (!live) return null;
  return { ...live.state, pot: live.potUtxo.token?.amount ?? 0n };
}
async function waitForPass(n: number) {
  for (let i = 0; i < 40; i++) {
    const c = await chainNow();
    if (c && c.passCount >= n) return c;
    await sleep(1000);
  }
  throw new Error(`The network never showed pass ${n}.`);
}
async function waitForProtects(n: number) {
  for (let i = 0; i < 40; i++) {
    const c = await chainNow();
    if (c && c.protects >= n) return c;
    await sleep(1000);
  }
  throw new Error(`The network never showed ${n} protects.`);
}
async function serverView() {
  const t0 = Date.now();
  const res = await getRound(id);
  const t1 = Date.now();
  if (!res.ok) throw new Error(`The server did not answer: ${res.error}`);
  return { round: res.round, offset: res.round.serverNow - (t0 + t1) / 2 };
}
// How far the server's clock is from this computer's, from several cheap /health calls (the one with the shortest round trip wins).
// A single slow call is not good enough: the deadline checks below are judged to a few hundred milliseconds.
async function syncOffset(samples = 7): Promise<number> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const h = await getHealth();
    const t1 = Date.now();
    if (h) {
      const rtt = t1 - t0;
      const offset = h.serverNow + rtt / 2 - t1;
      if (!best || rtt < best.rtt) best = { rtt, offset };
    }
    await sleep(100);
  }
  if (!best) throw new Error("The server did not answer /health.");
  return best.offset;
}
// Sleeps until the SERVER's clock reads serverMs. Measures the clock difference again close to the end, so a long wait stays exact.
async function sleepUntilServer(serverMs: number) {
  let off = await syncOffset();
  const early = serverMs - off - Date.now() - 4000;
  if (early > 0) {
    await sleep(early);
    off = await syncOffset();
  }
  await sleep(Math.max(0, serverMs - off - Date.now()));
}
const pusdOf = async (w: LocalWallet) => (await w.getBalances(provider)).pusd;

// Keeps this test under the server's own limit (12 requests a minute) so only deliberate refusals appear
const sent: number[] = [];
async function pace(n: number) {
  for (;;) {
    const now = Date.now();
    while (sent.length > 0 && now - sent[0]! > 62_000) sent.shift();
    if (sent.length + n <= 10) break;
    await sleep(2000);
  }
  for (let i = 0; i < n; i++) sent.push(Date.now());
}

// PUSD in wallet A + wallet B + the pool never changes while the round is running
let total = 0n;
async function conserved(label: string) {
  let sum = 0n;
  for (let i = 0; i < 20; i++) {
    const c = await chainNow();
    sum = (await pusdOf(A)) + (await pusdOf(B)) + (c?.pot ?? 0n);
    if (sum === total) break;
    await sleep(3000);
  }
  check(`PUSD is conserved after ${label}`, sum === total, `A+B+pool = ${sum}, expected ${total}`);
}

// A signed move for the current chain state, with a throwaway where the server puts the referee signature. Nothing is sent.
async function buildBody(wallet: LocalWallet, action: "open" | "conquer" | "protect", protectAmount = 100n) {
  const { pot, state } = kingdomContracts(game, provider, artifacts);
  const live = await readKingdomCoins(game, provider);
  if (!live) throw new Error("no live round");
  const { stateUtxo, potUtxo, state: s } = live;
  const coins = await provider.getUtxosForLockingBytecode(wallet.lock);
  const builder = new TransactionBuilder({ provider });
  let inputs;
  let pay: bigint;
  if (action === "protect") {
    const planned = planProtect(game, s, wallet.pkhHex, protectAmount);
    if (!planned.ok) throw new Error(`protect not possible: ${planned.text}`);
    pay = protectAmount;
    const picked = pickWalletCoins(coins, game.pusdCategory, pay);
    if (!picked.ok) throw new Error(`${nameOf(wallet.pkhHex)} has no usable PUSD coin for ${pay}: ${picked.code}`);
    inputs = picked.inputs;
    builder.addInput(stateUtxo, protectUnlocker(state, protectAmount)).addInput(potUtxo, pot.unlock.release());
    for (const c of inputs) builder.addInput(c, wallet.unlockP2PKH());
    addProtectOutputs(builder, { game, state, pot, stateUtxo, potUtxo, next: planned.next, amount: protectAmount });
  } else {
    pay = action === "open" ? BigInt(game.params.openingPrice) : conquestMoney(s.value, params).payment;
    const planned = planKingdomAction(game, s, action, wallet.pkhHex, pay);
    if (!planned.ok) throw new Error(`${action} not possible: ${planned.text}`);
    const picked = pickWalletCoins(coins, game.pusdCategory, pay);
    if (!picked.ok) throw new Error(`${nameOf(wallet.pkhHex)} has no usable PUSD coin for ${pay}: ${picked.code}`);
    inputs = picked.inputs;
    builder.addInput(stateUtxo, stateUnlocker(state, action, wallet.pkhHex)).addInput(potUtxo, pot.unlock.release());
    for (const c of inputs) builder.addInput(c, wallet.unlockP2PKH());
    addKingdomOutputs(builder, { game, state, pot, stateUtxo, potUtxo, s, plan: planned.plan });
  }
  builder
    .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
    .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: 2 });
  return { body: { action, txHex: builder.build(), walletInputs: claimsFor(wallet, inputs) }, passCount: s.passCount, pay };
}

try {
  // ---------- preflight ----------
  check("no server is running yet", (await getHealth()) === null, "stop it with Ctrl+C first if this fails");
  if (failed > 0) throw new Error("A server is already running.");
  const first = await chainNow();
  if (!first || first.passCount !== 0) throw new Error("The round must be waiting (nobody has opened it). Deploy a fresh Kingdom game first.");
  const a0 = await A.getBalances(provider);
  const b0 = await B.getBalances(provider);
  console.log(`wallet A: ${a0.pusd} PUSD units, ${a0.sats} sats | wallet B: ${b0.pusd} PUSD units, ${b0.sats} sats`);
  if (a0.pusd < 4000n || b0.pusd < 4000n) throw new Error("Each wallet needs at least 4000 units (40.00 PUSD).");
  if (a0.sats < 30_000n || b0.sats < 30_000n) throw new Error("Each wallet needs about 30,000 sats of BCH.");
  total = a0.pusd + b0.pusd;
  startServer();
  await waitHealthy();
  const v0 = await serverView();
  if (v0.round.kind !== "kingdom" || v0.round.status !== "waiting") throw new Error("The server is not showing a waiting Kingdom round.");

  // ---------- S1: the same open, twice at once ----------
  console.log("\nS1: the same open sent twice");
  {
    await pace(3);
    const o = await buildBody(A, "open");
    const [x, y] = await Promise.all([act(id, o.body), act(id, o.body)]);
    const wins = [x, y].filter((r) => r.ok).length;
    check("exactly one of two simultaneous copies is accepted", wins === 1, `${describe(x)} / ${describe(y)}`);
    if (wins === 0) throw new Error("Nothing was accepted. Check the server window.");
    await waitForPass(1);
    const again = await act(id, o.body);
    check("the same open sent again later is refused", !again.ok && (again.error === "state_changed" || again.error === "invalid"), describe(again));
    check("the chain has exactly one king", (await chainNow())?.passCount === 1);
    await conserved("S1");
  }

  // ---------- S2: a stale price, and a move built on an old state ----------
  console.log("\nS2: stale price and stale state");
  {
    await pace(3);
    const stale = await buildBody(B, "conquer"); // built now, at the price of the first king's value
    const p = await buildBody(A, "protect", 100n);
    const rp = await act(id, p.body);
    check("the king's protect is accepted", rp.ok, describe(rp));
    if (!rp.ok) throw new Error("The protect was refused. Check the server window.");
    await waitForProtects(1);
    const priceNow = conquestMoney((await chainNow())!.value, params).payment;
    const local = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: stale.pay, artifacts });
    check(
      "a price the player no longer sees is refused before anything is sent",
      !local.ok && local.code === "price_changed" && stale.pay !== priceNow,
      local.ok ? "accepted" : `${local.code}, old ${stale.pay}, now ${priceNow}`,
    );
    const old = await act(id, stale.body);
    check("a conquest built on the old state is refused by the server", !old.ok && old.error === "state_changed", describe(old));
    check("the refused move changed nothing", (await chainNow())?.passCount === 1);
    const good = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: priceNow, artifacts });
    check("B conquers at the new price", good.ok, good.ok ? "accepted" : good.code);
    if (!good.ok) throw new Error("The conquest was refused.");
    await waitForPass(2);
    await conserved("S2");
  }

  // ---------- S3: a conquest and a protect on the same state at the same moment ----------
  console.log("\nS3: a conquest and a protect at the same moment");
  {
    await pace(2);
    const king = walletOf((await chainNow())!.holderPkh);
    const challenger = otherOf(king);
    const before = await chainNow();
    const [conquest, protect] = await Promise.all([buildBody(challenger, "conquer"), buildBody(king, "protect", 100n)]);
    const [rc, rp] = await Promise.all([act(id, conquest.body), act(id, protect.body)]);
    const wins = [rc, rp].filter((r) => r.ok).length;
    check("exactly one of the two is accepted", wins === 1, `conquest ${describe(rc)} / protect ${describe(rp)}`);
    const loser = rc.ok ? rp : rc;
    check("the other one gets state_changed", !loser.ok && loser.error === "state_changed", describe(loser));
    if (rc.ok) await waitForPass(before!.passCount + 1);
    else await waitForProtects(before!.protects + 1);
    const after = await chainNow();
    check(
      "the chain shows the winner's move only",
      rc.ok ? after!.passCount === before!.passCount + 1 && after!.protects === 0 : after!.passCount === before!.passCount && after!.protects === before!.protects + 1,
      `pass ${after!.passCount}, protects ${after!.protects}`,
    );
    await conserved("S3");
  }

  // ---------- S4: the server crashes and comes back ----------
  console.log("\nS4: the server is killed hard (about 40 s)");
  {
    await sleep(7000); // a heartbeat is saved every 5 s
    const before = await serverView();
    const rem = before.round.remainingMs;
    if (before.round.status !== "open" || rem === null) throw new Error("The clock is not running.");
    const passBefore = before.round.passCount;
    console.log(`Before the crash: ${Math.round(rem / 1000)} s left.`);
    await crashServer();
    await sleep(20_000);
    startServer();
    await waitHealthy();
    const after = await serverView();
    const remAfter = after.round.remainingMs;
    console.log(`After the restart: ${remAfter === null ? "no clock" : `${Math.round(remAfter / 1000)} s`} left.`);
    check(
      "the clock resumed where it stopped (the downtime did not count)",
      remAfter !== null && Math.abs(remAfter - rem) <= 8_000,
      `before ${Math.round(rem / 1000)} s, after ${remAfter === null ? "none" : Math.round(remAfter / 1000)} s`,
    );
    check("the round is still open and not paused", after.round.status === "open" && after.round.paused === null);
    check("the king and pass count survived", after.round.passCount === passBefore && after.round.king === before.round.king);
    const ev = await getEvents(id, 0);
    check("a 'clock resumed after restart' event was published", ev.ok && ev.events.some((e) => e.type === "clock_resumed" && e.reason === "restart"));
  }

  // ---------- S5: protect in the last seconds ----------
  console.log("\nS5: a protect in the last 30 seconds (waits for the clock; up to 5 minutes)");
  {
    const c = (await chainNow())!;
    if (c.protects >= game.params.protectsPerReign) throw new Error("The king has no protects left, so this check cannot run. Deploy a fresh round and run again.");
    const king = walletOf(c.holderPkh);
    const p = await buildBody(king, "protect", 100n); // valid in every way except the time
    const view = await serverView();
    if (view.round.deadline === null) throw new Error("The clock is not running.");
    const wait = view.round.deadline - 25_000 - Date.now() - view.offset;
    if (wait < -2000) throw new Error("Less than 25 s were left already. Run again with a fresh round.");
    await pace(1);
    await sleepUntilServer(view.round.deadline - 25_000);
    const r = await act(id, p.body);
    check("a protect with 25 s left is refused: protect_locked", !r.ok && r.error === "protect_locked", describe(r));
    check("the refused protect changed nothing", (await chainNow())?.protects === c.protects);
  }

  // ---------- S6: conquests at the deadline ----------
  console.log("\nS6: conquests around the deadline (about 7 minutes: it waits for two clocks to run down)");
  let lastKing = "";
  {
    await pace(3);
    const c0 = (await chainNow())!;
    const o = otherOf(walletOf(c0.holderPkh));
    const p1 = await buildBody(o, "conquer");
    const view = await serverView();
    if (view.round.status !== "open" || view.round.deadline === null) throw new Error("The clock is not running.");
    if (view.round.deadline - Date.now() - view.offset < 3000) throw new Error("Less than 3 s were left. Run again.");
    await sleepUntilServer(view.round.deadline - 300);
    const r1 = await act(id, p1.body);
    check("a conquest 0.3 s before the deadline is accepted", r1.ok, describe(r1));
    if (!r1.ok || r1.deadline === null) throw new Error("The last-second conquest was refused.");
    await waitForPass(p1.passCount + 1);

    const p2 = await buildBody(otherOf(o), "conquer");
    await sleepUntilServer(r1.deadline + 500);
    const r2 = await act(id, p2.body);
    check("a conquest 0.5 s after the deadline (inside the 1 s grace) is accepted", r2.ok, describe(r2));
    if (!r2.ok || r2.deadline === null) throw new Error("The grace-period conquest was refused.");
    await waitForPass(p2.passCount + 1);

    const p3 = await buildBody(o, "conquer");
    await sleepUntilServer(r2.deadline + 1500);
    const r3 = await act(id, p3.body);
    console.log(`the server's clock read ${r3.serverNow === null ? "an unknown time" : `${r3.serverNow - r2.deadline} ms`} after the deadline when it answered the late conquest`);
    check("a conquest 1.5 s after the deadline is refused", !r3.ok && (r3.error === "too_late" || r3.error === "round_over"), describe(r3));
    const endNow = await chainNow();
    check("the late conquest never reached the chain", endNow?.passCount === p3.passCount);
    lastKing = endNow ? endNow.holderPkh : "";
    await conserved("S6");
  }

  // ---------- S7: the keeper settles, and every unit is accounted for ----------
  console.log("\nS7: waiting for the keeper to settle (about 30 s)");
  {
    let settled = false;
    for (let i = 0; i < 60 && !settled; i++) {
      const r = await getRound(id);
      settled = r.ok && r.round.status === "settled";
      if (!settled) await sleep(3000);
    }
    check("the keeper settled the round", settled);
    let ended = null;
    for (let i = 0; i < 20 && !ended; i++) {
      ended = await findEndedKingdom(game, provider).catch(() => null);
      if (!ended) await sleep(3000);
    }
    check("the pool and the trophy went to the last king", !!ended && ended.winnerPkh === lastKing, ended ? `winner ${nameOf(ended.winnerPkh)}` : "no settlement found");
    let sum = 0n;
    for (let i = 0; i < 20; i++) {
      sum = (await pusdOf(A)) + (await pusdOf(B));
      if (sum === total) break;
      await sleep(3000);
    }
    check("after settlement A + B hold exactly what they started with", sum === total, `now ${sum}, started ${total}`);
  }

  // ---------- S8: a burst of requests ----------
  console.log("\nS8: a burst of 30 requests (then a 65 s pause)");
  {
    const results = await Promise.all(Array.from({ length: 30 }, () => act(id, {})));
    const limited = results.filter((r) => !r.ok && r.error === "rate_limited").length;
    const others = results.filter((r) => !r.ok && r.error !== "rate_limited").length;
    check("part of the burst is rate limited", limited >= 10, `${limited} limited, ${others} answered normally`);
    check("the server still answers /health during the burst", (await getHealth()) !== null);
    await sleep(65_000);
    const after = await act(id, {});
    check("after the pause the server answers normally again", !after.ok && after.error !== "rate_limited", describe(after));
  }
} catch (e) {
  failed++;
  console.log("STOPPED:", e instanceof Error ? e.message : e);
} finally {
  await crashServer();
}
console.log(failed === 0 ? "\nAll Kingdom chaos checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);