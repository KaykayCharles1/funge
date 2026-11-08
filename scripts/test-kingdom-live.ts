// Live chipnet test of Kingdom open + conquer with two game wallets, through the real referee server.
// Needs the server running (npm run server) and a waiting Kingdom game (node scripts/deploy-kingdom.ts).
// Each wallet needs PUSD (player A at least 10.00, player B at least 10.20) and about 20,000 sats of BCH:
//   node scripts/send-test-pusd.ts <token-aware address> 2000
// Run:
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   read -rs SPIKE_MNEMONIC_2; export SPIKE_MNEMONIC_2
//   node scripts/test-kingdom-live.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { conquestMoney } from "../src/lib/kingdom.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { getEvents, getRound } from "../src/referee/api.ts";
import { kingdomAct, readKingdomCoins } from "../src/referee/kingdomActions.ts";
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

async function snapshot() {
  const r = await getRound(game.gameCategory);
  if (!r.ok) throw new Error(`server: ${JSON.stringify(r)}`);
  return r.round as any;
}
const pusdOf = async (w: typeof A) => (await w.getBalances(provider)).pusd;

// Wait until a wallet's PUSD balance equals what we expect (the network needs a moment to show a new transaction)
async function expectPusd(name: string, w: typeof A, want: bigint) {
  let have = 0n;
  for (let i = 0; i < 20; i++) {
    have = await pusdOf(w);
    if (have === want) return console.log(`ok    ${name} holds ${have} units, as expected`);
    await sleep(3000);
  }
  assert.fail(`${name}: expected ${want} units of PUSD, found ${have}`);
}

async function waitForPass(n: number) {
  for (let i = 0; i < 20; i++) {
    const live = await readKingdomCoins(game, provider);
    if (live && live.state.passCount === n) return live;
    await sleep(3000);
  }
  throw new Error(`the chain never showed pass count ${n}`);
}

const first = await snapshot();
assert.equal(first.kind, "kingdom", "the server did not report a Kingdom round");
assert.equal(first.status, "waiting", `the round must be waiting to run this test (it is ${first.status})`);
const openPay = BigInt(game.params.openingPrice);
const money = conquestMoney(openPay, params);
const a0 = await pusdOf(A);
const b0 = await pusdOf(B);
console.log(`start: A holds ${a0}, B holds ${b0}, opening price ${openPay}, conquest costs ${money.payment}`);
assert.ok(a0 >= openPay, "wallet A needs more PUSD");
assert.ok(b0 >= money.payment, "wallet B needs more PUSD");

// 1. A tries to conquer a round that nobody opened: refused on the player's side, nothing is sent
const early = await kingdomAct({ game, provider, wallet: A, action: "conquer", expectedPay: openPay, artifacts });
assert.ok(!early.ok && early.code === "not_open", `conquer on a waiting round: ${JSON.stringify(early)}`);
console.log("ok    conquer on a waiting round is refused: not_open");

// 2. A opens
const opened = await kingdomAct({ game, provider, wallet: A, action: "open", expectedPay: openPay, artifacts });
if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);
assert.equal(opened.passCount, 1);
console.log("ok    open accepted, txid", opened.txid);
await waitForPass(1);
const afterOpen = await snapshot();
assert.equal(afterOpen.status, "open");
assert.equal(afterOpen.king, A.pkhHex);
assert.equal(afterOpen.pot, openPay.toString());
assert.equal(afterOpen.kingdom.value, openPay.toString());
assert.equal(afterOpen.kingdom.conquest.pay, money.payment.toString());
const clock1 = afterOpen.kingdom.clockSeconds as number;
assert.ok(afterOpen.remainingMs <= clock1 * 1000 && afterOpen.remainingMs > clock1 * 1000 - 20_000, `clock after open: ${afterOpen.remainingMs} ms for a ${clock1} s clock`);
console.log(`ok    round is open, A is king, pot ${afterOpen.pot}, clock ${clock1} s`);
await expectPusd("A", A, a0 - openPay);

// 3. the king cannot conquer their own throne (refused before anything is built)
const self = await kingdomAct({ game, provider, wallet: A, action: "conquer", expectedPay: money.payment, artifacts });
assert.ok(!self.ok && self.code === "already_king", `king conquers self: ${JSON.stringify(self)}`);
console.log("ok    the king cannot conquer their own throne: already_king");

// 4. a wrong price is refused on the player's side
const stale = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: money.payment - 1n, artifacts });
assert.ok(!stale.ok && stale.code === "price_changed", `stale price: ${JSON.stringify(stale)}`);
console.log("ok    a price the player did not agree to is refused: price_changed");

// 5. B conquers
const conquered = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: money.payment, artifacts });
if (!conquered.ok) throw new Error(`conquer failed: ${JSON.stringify(conquered)}`);
assert.equal(conquered.passCount, 2);
console.log("ok    conquer accepted, txid", conquered.txid);
const live = await waitForPass(2);
assert.equal(live.state.holderPkh, B.pkhHex);
assert.equal(live.state.value, openPay);
assert.equal(live.state.previous, A.pkhHex.slice(0, 22));
assert.equal(live.potUtxo.token?.amount, openPay + money.poolGets);
const afterConquer = await snapshot();
assert.equal(afterConquer.king, B.pkhHex);
assert.equal(afterConquer.pot, (openPay + money.poolGets).toString());
const clock2 = afterConquer.kingdom.clockSeconds as number;
assert.ok(clock2 <= afterOpen.kingdom.clockCapSeconds, `the clock never goes above the cap after a conquest (${clock1} -> ${clock2})`);
console.log(`ok    B is king, previous king recorded, pot ${afterConquer.pot}, clock ${clock2} s`);
await expectPusd("A", A, a0 - openPay + money.kingGets);
await expectPusd("B", B, b0 - money.payment);

// 6. B tries to conquer again
const again = await kingdomAct({ game, provider, wallet: B, action: "conquer", expectedPay: money.payment, artifacts });
assert.ok(!again.ok && again.code === "already_king", `king conquers self again: ${JSON.stringify(again)}`);
console.log("ok    the new king cannot conquer either: already_king");

const ev = await getEvents(game.gameCategory, 0);
if (!ev.ok) throw new Error(`events: ${JSON.stringify(ev)}`);
console.log("events:", ev.events.map((e) => `${e.seq}:${e.type}/${e.reason}`).join("  "));
console.log("\nKingdom live test passed. This round is now open with B as king; the keeper settles it after the clock runs out.");
process.exit(0);