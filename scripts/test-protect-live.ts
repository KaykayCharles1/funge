// Live chipnet test of Kingdom protect with game wallets, through the real referee server.
// Needs the server running and a WAITING Kingdom game (delete the old game file, run deploy-kingdom.ts, restart the server).
// Wallet A needs about 20.00 PUSD, wallet B about 20.00 PUSD, and each about 20,000 sats of BCH.
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   read -rs SPIKE_MNEMONIC_2; export SPIKE_MNEMONIC_2
//   node scripts/test-protect-live.ts
// It runs for about 12 minutes: it waits for the last 30 seconds of the clock to check that protect is closed there,
// then waits for the keeper to settle. SKIP_LOCKOUT=1 skips that waiting.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { conquestMoney } from "../src/lib/kingdom.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { getRound } from "../src/referee/api.ts";
import { kingdomAct, kingdomProtect, readKingdomCoins } from "../src/referee/kingdomActions.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { loadArtifact } from "./helpers.ts";

const game = JSON.parse(readFileSync(new URL(`../public/game.${CONFIG.network}.kingdom.json`, import.meta.url), "utf8"));
const m1 = process.env.SPIKE_MNEMONIC;
const m2 = process.env.SPIKE_MNEMONIC_2;
if (!m1 || !m2) throw new Error("Set SPIKE_MNEMONIC and SPIKE_MNEMONIC_2 first (two different wallets).");
const A = walletFromMnemonic(m1);
const B = walletFromMnemonic(m2);
assert.notEqual(A.pkhHex, B.pkhHex, "The two wallets must be different.");
const provider = makeProvider();
const artifacts = { pot: loadArtifact("FungePot"), kingdom: loadArtifact("FungeKingdom") };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const params = { feePercent: BigInt(game.params.feePercent), cutPercent: BigInt(game.params.cutPercent) };
const OPEN = BigInt(game.params.openingPrice);

async function snapshot() {
  const r = await getRound(game.gameCategory);
  if (!r.ok) throw new Error(`server: ${JSON.stringify(r)}`);
  return r.round as any;
}
const pusdOf = async (w: typeof A) => (await w.getBalances(provider)).pusd;

async function expectPusd(name: string, w: typeof A, want: bigint) {
  let have = 0n;
  for (let i = 0; i < 20; i++) {
    have = await pusdOf(w);
    if (have === want) return console.log(`ok    ${name} holds ${have} units, as expected`);
    await sleep(3000);
  }
  assert.fail(`${name}: expected ${want} units of PUSD, found ${have}`);
}

// The chain shows the new state: wait until it matches
async function waitForState(what: string, test: (s: { passCount: number; value: bigint; protects: number }) => boolean) {
  for (let i = 0; i < 20; i++) {
    const live = await readKingdomCoins(game, provider);
    if (live && test(live.state)) return live;
    await sleep(3000);
  }
  throw new Error(`the chain never showed: ${what}`);
}

function refused(name: string, out: { ok: boolean; code?: string }, code: string) {
  assert.ok(!out.ok && out.code === code, `${name}: expected ${code}, got ${JSON.stringify(out)}`);
  console.log(`ok    ${name}: ${code}`);
}

const first = await snapshot();
assert.equal(first.kind, "kingdom");
assert.equal(first.status, "waiting", `the round must be waiting (it is ${first.status})`);
const a0 = await pusdOf(A);
const b0 = await pusdOf(B);
console.log(`start: A holds ${a0}, B holds ${b0}`);

// 1. A opens and is king
const opened = await kingdomAct({ game, provider, wallet: A, action: "open", expectedPay: OPEN, artifacts });
if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);
await waitForState("pass 1", (s) => s.passCount === 1);
const afterOpen = await snapshot();
const deadline0 = afterOpen.deadline as number;
console.log(`ok    A opened, pot ${afterOpen.pot}, deadline ${deadline0}`);

// 2. refusals before any protect succeeds
refused("B (not the king) protects, checked on the client", await kingdomProtect({ game, provider, wallet: B, amount: 100n, artifacts }), "not_king");
refused("B (not the king) protects, forced past the client", await kingdomProtect({ game, provider, wallet: B, amount: 100n, artifacts, force: true }), "not_king");
refused("A protects 2.00 (not 1, 5 or 10), checked on the client", await kingdomProtect({ game, provider, wallet: A, amount: 200n, artifacts }), "invalid");
refused("A protects 2.00, forced past the client", await kingdomProtect({ game, provider, wallet: A, amount: 200n, artifacts, force: true }), "invalid");

// 3. A protects with 1.00, then 5.00
const p1 = await kingdomProtect({ game, provider, wallet: A, amount: 100n, artifacts });
if (!p1.ok) throw new Error(`protect 1 failed: ${JSON.stringify(p1)}`);
await waitForState("value 1100", (s) => s.value === OPEN + 100n && s.protects === 1);
let snap = await snapshot();
assert.equal(snap.deadline, deadline0, "a protect must not move the deadline");
assert.equal(snap.pot, (OPEN + 100n).toString());
assert.equal(snap.kingdom.value, (OPEN + 100n).toString());
assert.equal(snap.kingdom.protectsUsed, 1);
assert.equal(snap.kingdom.protectsLeft, 1);
assert.equal(snap.passCount, 1);
console.log("ok    protect 1.00: value 11.00, pot 11.00, one protect left, the deadline did not move");
await expectPusd("A", A, a0 - OPEN - 100n);

const p2 = await kingdomProtect({ game, provider, wallet: A, amount: 500n, artifacts });
if (!p2.ok) throw new Error(`protect 2 failed: ${JSON.stringify(p2)}`);
await waitForState("value 1600", (s) => s.value === OPEN + 600n && s.protects === 2);
snap = await snapshot();
assert.equal(snap.deadline, deadline0, "a protect must not move the deadline");
assert.equal(snap.pot, (OPEN + 600n).toString());
assert.equal(snap.kingdom.protectsLeft, 0);
assert.deepEqual(snap.kingdom.protectAmounts, []);
const value = OPEN + 600n;
const money = conquestMoney(value, params);
assert.equal(snap.kingdom.conquest.pay, money.payment.toString(), "the conquest price must follow the raised value");
console.log(`ok    protect 5.00: value 16.00, pot 16.00, no protects left, a conquest now costs ${money.payment}`);
await expectPusd("A", A, a0 - OPEN - 600n);

// 4. a third protect is refused
refused("A's third protect, checked on the client", await kingdomProtect({ game, provider, wallet: A, amount: 100n, artifacts }), "no_protects_left");
refused("A's third protect, forced past the client", await kingdomProtect({ game, provider, wallet: A, amount: 100n, artifacts, force: true }), "no_protects_left");

// 5. B conquers at the raised price; the counter resets for the new reign
const conquered = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: money.payment, artifacts });
if (!conquered.ok) throw new Error(`conquer failed: ${JSON.stringify(conquered)}`);
const live = await waitForState("pass 2", (s) => s.passCount === 2);
assert.equal(live.state.value, value);
assert.equal(live.state.protects, 0);
assert.equal(live.potUtxo.token?.amount, value + money.poolGets);
console.log(`ok    B conquered at ${money.payment}: value stays 16.00, protects reset, pot ${value + money.poolGets}`);
await expectPusd("A", A, a0 - OPEN - 600n + money.kingGets);
refused("A (dethroned) protects", await kingdomProtect({ game, provider, wallet: A, amount: 100n, artifacts }), "not_king");

// 6. the new king can protect
const p3 = await kingdomProtect({ game, provider, wallet: B, amount: 100n, artifacts });
if (!p3.ok) throw new Error(`B's protect failed: ${JSON.stringify(p3)}`);
await waitForState("value 1700", (s) => s.value === value + 100n && s.protects === 1);
console.log("ok    B protects with 1.00 in its own reign: value 17.00, one of two used");
const finalPot = value + money.poolGets + 100n;
await expectPusd("B", B, b0 - money.payment - 100n);

// 7. protect is closed in the last 30 seconds of the clock, then the keeper settles
if (process.env.SKIP_LOCKOUT === "1") {
  console.log("skipped the last-30-seconds check and the settlement (SKIP_LOCKOUT=1)");
} else {
  for (;;) {
    snap = await snapshot();
    const closesIn = snap.kingdom?.protectClosesInMs as number | null;
    if (closesIn === null) throw new Error("no clock to wait for");
    if (closesIn <= 0) break;
    console.log(`waiting: protect closes in ${Math.ceil(closesIn / 1000)} s`);
    await sleep(Math.min(closesIn + 500, 30_000));
  }
  assert.ok(snap.remainingMs > 3000, `too late to run this check (${snap.remainingMs} ms left)`);
  refused("B protects in the last 30 seconds", await kingdomProtect({ game, provider, wallet: B, amount: 100n, artifacts }), "protect_locked");
  for (let i = 0; i < 60; i++) {
    snap = await snapshot();
    if (snap.status === "settled") break;
    await sleep(5000);
  }
  assert.equal(snap.status, "settled", `the round did not settle (${snap.status})`);
  console.log("ok    the keeper settled the round");
  await expectPusd("B", B, b0 - money.payment - 100n + finalPot);
  await expectPusd("A", A, a0 - OPEN - 600n + money.kingGets);
}
console.log("\nKingdom protect live test passed.");
process.exit(0);