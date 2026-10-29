// Run with the server OFF: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/test-fallback-live.ts
// Settles a live round with no referee, using the contract's settleFallback after enough blocks.
import { readFileSync } from "node:fs";
import { hexToBin } from "@bitauth/libauth";
import { Contract, TransactionBuilder } from "cashscript";
import { findEndedRound } from "../src/ended.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { getHealth } from "../src/referee/api.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { decodeCommitment, loadArtifact, p2pkhLock, toVmCategory } from "./helpers.ts";

const game = JSON.parse(readFileSync(new URL("../public/game.chipnet.v2.json", import.meta.url), "utf8"));
const mnemonic = process.env.SPIKE_MNEMONIC;
if (!mnemonic) throw new Error("Set SPIKE_MNEMONIC first.");
const wallet = walletFromMnemonic(mnemonic);
const provider = makeProvider();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT_MS = 120 * 60 * 1000;
const TRY_EVERY_MS = 30_000;

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
const shorten = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 220);

// A settlement that needs no referee: the only requirement is the input's relative time lock
async function prepare(sequence: number) {
  const [[stateUtxo], [potUtxo]] = await Promise.all([provider.getUtxos(game.state.address), provider.getUtxos(game.pot.address)]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) throw new Error("ROUND_GONE");
  const { passCount, holderPkh } = decodeCommitment(stateUtxo.token.nft.commitment);
  const limit = passCount === 0 ? game.params.waitingFallbackBlocks : game.params.fallbackBlocks;
  const holderLock = p2pkhLock(hexToBin(holderPkh));
  const coins = await provider.getUtxosForLockingBytecode(wallet.lock);
  const feeCoin = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  if (!feeCoin) throw new Error("The wallet needs a little BCH to pay the fee.");
  const tx = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
    .addInput(stateUtxo, state.unlock.settleFallback(), { sequence })
    .addInput(potUtxo, pot.unlock.release())
    .addInput(feeCoin, wallet.unlockP2PKH())
    .addOutput({ to: holderLock, amount: 1_000n, token: { amount: potUtxo.token.amount, category: game.pusdCategory } })
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: { amount: 0n, category: game.gameCategory, nft: { capability: "none", commitment: stateUtxo.token.nft.commitment } },
    })
    .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: 2 });
  return { limit, passCount, holderPkh, potAmount: potUtxo.token.amount, send: () => tx.send() };
}

try {
  check("the game server is OFF (nothing here needs it)", (await getHealth()) === null, "stop it with Ctrl+C first if this fails");
  const first = await prepare(1);
  console.log(`Round at pass ${first.passCount}, holder ${first.holderPkh}, pot ${first.potAmount}. Fallback after ${first.limit} blocks.`);
  console.log(`Chain height now: ${await provider.getBlockHeight()}`);

  // Too early by one block must never work
  try {
    await (await prepare(first.limit - 1)).send();
    check("settling with a too-short wait is refused", false, "it was accepted!");
  } catch (e) {
    check("settling with a too-short wait is refused", true, shorten(e));
  }

  console.log(`\nWaiting for enough blocks. Trying every ${TRY_EVERY_MS / 1000} s, up to ${MAX_WAIT_MS / 60000} minutes…`);
  const started = Date.now();
  let lastMessage = "";
  let done: { txid: string } | null = null;
  while (Date.now() - started < MAX_WAIT_MS) {
    try {
      done = await (await prepare(first.limit)).send();
      break;
    } catch (e) {
      const m = shorten(e);
      if (m.includes("ROUND_GONE")) throw new Error("The round was settled by someone else.");
      if (m !== lastMessage) console.log(`[${Math.round((Date.now() - started) / 60000)} min, height ${await provider.getBlockHeight()}] not yet: ${m}`);
      lastMessage = m;
    }
    await sleep(TRY_EVERY_MS);
  }
  if (!done) throw new Error("Still not accepted after the time limit.");
  check("anyone settled the round without the referee", true, `txid ${done.txid}, height ${await provider.getBlockHeight()}`);

  let ended = null;
  for (let i = 0; i < 15 && !ended; i++) {
    ended = await findEndedRound({ state: game.state }, provider).catch(() => null);
    if (!ended) await sleep(3000);
  }
  check("the settlement is found on the chain", ended !== null);
  if (ended) {
    check("the last holder got the whole pot", ended.winnerPkh === first.holderPkh && ended.potPaid === first.potAmount, `pot ${ended.potPaid}`);
    check("the trophy records the right pass count", ended.passes === first.passCount, `passes ${ended.passes}`);
  }
} catch (e) {
  failed++;
  console.log("STOPPED:", e instanceof Error ? e.message : e);
}
console.log(failed === 0 ? "\nFallback settle works with the server off." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);