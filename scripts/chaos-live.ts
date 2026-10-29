// Run: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/chaos-live.ts
// Server first: FUNGE_RESET_SECONDS=45 FUNGE_KEEPER_DELAY_SECONDS=60 npm run server
import { readFileSync } from "node:fs";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import { makeProvider } from "../src/lib/provider.ts";
import { act, getRound } from "../src/referee/api.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, toVmCategory } from "./helpers.ts";

const game = JSON.parse(readFileSync(new URL("../public/game.chipnet.v2.json", import.meta.url), "utf8"));
const mnemonic = process.env.SPIKE_MNEMONIC;
if (!mnemonic) throw new Error("Set SPIKE_MNEMONIC first.");
const wallet = walletFromMnemonic(mnemonic);
const provider = makeProvider();
const id: string = game.gameCategory;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(game.gameCategory)], { provider });
const state = new Contract(
  loadArtifact("FungeStateV2"),
  [hexToBin(pot.lockingBytecode), toVmCategory(game.pusdCategory), BigInt(game.params.basePrice), BigInt(game.params.priceStep),
    hexToBin(game.refereePubkey), BigInt(game.params.fallbackBlocks), BigInt(game.params.waitingFallbackBlocks)],
  { provider },
);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const describe = (r: { ok: boolean; error?: string }) => (r.ok ? "accepted" : `refused: ${r.error}`);

async function chainPass(): Promise<number> {
  const [u] = await provider.getUtxos(game.state.address);
  if (!u?.token?.nft) throw new Error("no live round");
  return decodeCommitment(u.token.nft.commitment).passCount;
}

async function waitForPass(n: number) {
  for (let i = 0; i < 40; i++) {
    if ((await chainPass()) >= n) return;
    await sleep(1000);
  }
  throw new Error(`The network never showed pass ${n}.`);
}

// A signed grab for the current state, with a placeholder where the server puts the referee signature
async function buildBody() {
  const [[stateUtxo], [potUtxo]] = await Promise.all([provider.getUtxos(game.state.address), provider.getUtxos(game.pot.address)]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) throw new Error("no live round");
  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);
  const coins = await provider.getUtxosForLockingBytecode(wallet.lock);
  const pusdCoin = coins
    .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft && u.token.amount >= price)
    .sort((a, b) => (a.token!.amount < b.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) throw new Error(`wallet has no single PUSD coin >= ${price}`);
  const bchCoin = pusdCoin.satoshis < 6_000n
    ? coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0] : undefined;
  const wallets = bchCoin ? [pusdCoin, bchCoin] : [pusdCoin];

  const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)));
  const b = new TransactionBuilder({ provider })
    .addInput(stateUtxo, state.unlock.pass(hexToBin(wallet.pkhHex), placeholder))
    .addInput(potUtxo, pot.unlock.release());
  for (const c of wallets) b.addInput(c, wallet.unlockP2PKH());
  b.addOutput({ to: state.tokenAddress, amount: stateUtxo.satoshis,
      token: { amount: 0n, category: game.gameCategory, nft: { capability: "mutable", commitment: encodeCommitment(passCount + 1, wallet.pkhHex) } } })
    .addOutput({ to: pot.tokenAddress, amount: potUtxo.satoshis, token: { amount: potUtxo.token.amount + price, category: game.pusdCategory } })
    .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
    .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: 2 });

  const body = {
    action: "steal",
    txHex: b.build(),
    walletInputs: wallets.map((u) => ({
      txid: u.txid, vout: u.vout, satoshis: String(u.satoshis), lockingBytecode: binToHex(wallet.lock),
      ...(u.token ? { token: { amount: String(u.token.amount), category: u.token.category } } : {}),
    })),
  };
  return { body, passCount, price };
}

// Offset between this computer's clock and the server's, from one round-trip
async function serverView() {
  const t0 = Date.now();
  const res = await getRound(id);
  const t1 = Date.now();
  if (!res.ok) throw new Error(`The server did not answer: ${res.error}`);
  return { round: res.round, offset: res.round.serverNow - (t0 + t1) / 2 };
}
const sleepUntilServer = (serverMs: number, offset: number) => sleep(Math.max(0, serverMs - offset - Date.now()));

const accepted: bigint[] = [];
try {
  const first = await serverView();
  console.log(`Round is ${first.round.status}, pass ${first.round.passCount}. Server clock offset ${Math.round(first.offset)} ms.`);
  if (first.round.status !== "waiting" && first.round.status !== "open") throw new Error("This round is not running. Deploy a fresh game.");
  const startPusd = (await wallet.getBalances(provider)).pusd;

  {
    console.log("\nS1: the same grab sent twice");
    const a = await buildBody();
    const [x, y] = await Promise.all([act(id, a.body), act(id, a.body)]);
    const wins = [x, y].filter((r) => r.ok).length;
    check("exactly one of two simultaneous copies is accepted", wins === 1, `${describe(x)} / ${describe(y)}`);
    if (wins === 0) throw new Error("Nothing was accepted. Check the server window.");
    accepted.push(a.price);
    await waitForPass(a.passCount + 1);
    const again = await act(id, a.body);
    check("the same grab sent again later is refused", !again.ok && again.error === "state_changed", describe(again));
    check("the chain moved by exactly one pass", (await chainPass()) === a.passCount + 1);
  }

  {
    console.log("\nS2: a grab built on an old state");
    const stale = await buildBody();
    for (let i = 1; i <= 2; i++) {
      const g = await buildBody();
      const r = await act(id, g.body);
      check(`normal grab ${i} is accepted`, r.ok, describe(r));
      if (!r.ok) throw new Error("A normal grab was refused. Check the server window.");
      accepted.push(g.price);
      await waitForPass(g.passCount + 1);
    }
    const old = await act(id, stale.body);
    check("the old grab is refused", !old.ok && old.error === "state_changed", describe(old));
    check("the refused grab changed nothing", (await chainPass()) === stale.passCount + 2);
  }

  {
    console.log("\nS3: grabs at the deadline (this takes about 2 minutes)");
    const p1 = await buildBody();
    const view = await serverView();
    if (view.round.status !== "open" || view.round.deadline === null) throw new Error("The clock is not running.");
    if (view.round.deadline - Date.now() - view.offset < 3000) {
      throw new Error("Less than 3 seconds were left on the clock. Use FUNGE_RESET_SECONDS=45 and run again.");
    }
    await sleepUntilServer(view.round.deadline - 300, view.offset);
    const r1 = await act(id, p1.body);
    check("a grab 0.3 s before the deadline is accepted", r1.ok, describe(r1));
    if (!r1.ok || r1.deadline === null) throw new Error("The last-second grab was refused.");
    accepted.push(p1.price);
    await waitForPass(p1.passCount + 1);

    const p2 = await buildBody();
    await sleepUntilServer(r1.deadline + 500, view.offset);
    const r2 = await act(id, p2.body);
    check("a grab 0.5 s after the deadline (inside the 1 s grace) is accepted", r2.ok, describe(r2));
    if (!r2.ok || r2.deadline === null) throw new Error("The grace-period grab was refused.");
    accepted.push(p2.price);
    await waitForPass(p2.passCount + 1);

    const p3 = await buildBody();
    await sleepUntilServer(r2.deadline + 1500, view.offset);
    const r3 = await act(id, p3.body);
    check("a grab 1.5 s after the deadline is refused", !r3.ok && (r3.error === "too_late" || r3.error === "round_over"), describe(r3));
    check("the late grab never reached the chain", (await chainPass()) === p3.passCount);
  }

  await sleep(3000);
  const endPusd = (await wallet.getBalances(provider)).pusd;
  const spent = accepted.reduce((s, p) => s + p, 0n);
  check("PUSD spent equals the accepted grabs only", startPusd - endPusd === spent, `spent ${startPusd - endPusd}, expected ${spent}`);
} catch (e) {
  failed++;
  console.log("STOPPED:", e instanceof Error ? e.message : e);
}
console.log(failed === 0 ? "\nAll live chaos checks passed." : `\n${failed} check(s) FAILED.`);
console.log("The keeper settles this round shortly; watch the server window.");
process.exit(failed === 0 ? 0 : 1);