// Step 3 spike: can the referee signature be inserted AFTER the wallet signed its inputs?
// Run: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/spike-patch-sig.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { binToHex, hexToBin, decodeTransaction, encodeTransaction } from "@bitauth/libauth";
import { Contract, SignatureTemplate, SighashType, TransactionBuilder } from "cashscript";
import { makeProvider } from "../src/lib/provider.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, toVmCategory } from "./helpers.ts";

const FEE_RATE = 2;
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const game = JSON.parse(rd("../public/game.chipnet.v2.json"));
assert(game.contractVersion === 2 && game.network === "chipnet");

const mnemonic = process.env.SPIKE_MNEMONIC;
if (!mnemonic) throw new Error("Set SPIKE_MNEMONIC (a funded chipnet game-wallet seed) first.");
const wallet = walletFromMnemonic(mnemonic);
const provider = makeProvider();

// Referee key: find the 32-byte hex in .referee.chipnet.json whose public key matches the game. Never printed.
function findRefereeKey(): Uint8Array {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && /^[0-9a-f]{64}$/i.test(v)) found.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(JSON.parse(rd("../.referee.chipnet.json")));
  for (const hex of found) {
    const k = hexToBin(hex);
    if (binToHex(new SignatureTemplate(k).publicKey) === game.refereePubkey) return k;
  }
  throw new Error("No key in .referee.chipnet.json matches refereePubkey in the game file.");
}
const refereeKey = findRefereeKey();

const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(game.gameCategory)], { provider });
const state = new Contract(
  loadArtifact("FungeStateV2"),
  [
    hexToBin(pot.lockingBytecode), toVmCategory(game.pusdCategory),
    BigInt(game.params.basePrice), BigInt(game.params.priceStep),
    hexToBin(game.refereePubkey), BigInt(game.params.fallbackBlocks), BigInt(game.params.waitingFallbackBlocks),
  ],
  { provider },
);
assert.equal(state.lockingBytecode, game.state.lockingBytecode, "state contract does not match the deployed game");
assert.equal(pot.lockingBytecode, game.pot.lockingBytecode, "pot contract does not match the deployed game");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function context() {
  const [[stateUtxo], [potUtxo]] = await Promise.all([
    provider.getUtxos(game.state.address), provider.getUtxos(game.pot.address),
  ]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) throw new Error("no live round found");
  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);
  const coins = await provider.getUtxosForLockingBytecode(wallet.lock);
  const pusdCoin = coins
    .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft && u.token.amount >= price)
    .sort((a, b) => (a.token!.amount < b.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) throw new Error(`wallet has no single PUSD coin >= ${price}`);
  const bchCoin = pusdCoin.satoshis < 6_000n
    ? coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0]
    : undefined;
  if (pusdCoin.satoshis < 6_000n && !bchCoin) throw new Error("wallet needs a BCH coin for the fee");
  // inputs in the exact order the builder gets them
  const all = [stateUtxo, potUtxo, pusdCoin, ...(bchCoin ? [bchCoin] : [])];
  const lockHexes = [state.lockingBytecode, pot.lockingBytecode, ...all.slice(2).map(() => binToHex(wallet.lock))];
  return { stateUtxo, potUtxo, pusdCoin, bchCoin, passCount, price, all, lockHexes };
}
type Ctx = Awaited<ReturnType<typeof context>>;

// Same transaction as src/steal.ts, but through V2 and with a chosen referee signature template.
function buildHex(ctx: Ctx, refereeSig: SignatureTemplate): string {
  const b = new TransactionBuilder({ provider })
    .addInput(ctx.stateUtxo, state.unlock.pass(hexToBin(wallet.pkhHex), refereeSig))
    .addInput(ctx.potUtxo, pot.unlock.release());
  for (const c of ctx.all.slice(2)) b.addInput(c, wallet.unlockP2PKH()); // wallet signs via its capability
  b.addOutput({
    to: state.tokenAddress, amount: ctx.stateUtxo.satoshis,
    token: { amount: 0n, category: game.gameCategory,
      nft: { capability: "mutable", commitment: encodeCommitment(ctx.passCount + 1, wallet.pkhHex) } },
  })
    .addOutput({
      to: pot.tokenAddress, amount: ctx.potUtxo.satoshis,
      token: { amount: ctx.potUtxo.token!.amount + ctx.price, category: game.pusdCategory },
    })
    .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
    .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE });
  return b.build();
}

// The "server" half: takes only hex + chain data, never the wallet.
function patchReferee(hex: string, ctx: Ctx, refereeSig: SignatureTemplate): string {
  const decoded = decodeTransaction(hexToBin(hex));
  if (typeof decoded === "string") throw new Error(`decode failed: ${decoded}`);
  const tx = decoded;
  assert.equal(tx.inputs.length, ctx.all.length, "input count differs");
  tx.inputs.forEach((inp, i) => {
    assert.equal(binToHex(inp.outpointTransactionHash), ctx.all[i].txid, `input ${i} txid/order mismatch`);
    assert.equal(inp.outpointIndex, ctx.all[i].vout, `input ${i} vout mismatch`);
  });
  const sourceOutputs = ctx.all.map((u, i) => ({
    lockingBytecode: hexToBin(u.lockingBytecode ?? ctx.lockHexes[i]),
    valueSatoshis: u.satoshis,
    token: u.token ? {
      amount: u.token.amount,
      category: hexToBin(u.token.category),
      nft: u.token.nft
        ? { capability: u.token.nft.capability, commitment: hexToBin(u.token.nft.commitment) }
        : undefined,
    } : undefined,
  }));
  const unlocker = state.unlock.pass(hexToBin(wallet.pkhHex), refereeSig);
  tx.inputs[0].unlockingBytecode = unlocker.generateUnlockingBytecode({ transaction: tx, sourceOutputs, inputIndex: 0 });
  return binToHex(encodeTransaction(tx));
}

// Step 4: keep stealing without waiting for blocks until the node refuses.
const MAX = Number(process.env.SPIKE_MAX ?? 60);
const sighash = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS;
const real = new SignatureTemplate(refereeKey, sighash);
const t0 = Date.now();
let expected: number | undefined;
let sent = 0;
let stopReason = `reached the cap of ${MAX}`;

for (let i = 0; i < MAX; i++) {
  let ctx: Ctx | undefined;
  try {
    for (let t = 0; t < 8; t++) {
      ctx = await context();
      if (expected === undefined || ctx.passCount >= expected) break;
      await sleep(1000); // the server has not shown our last tx yet
    }
  } catch (e) {
    stopReason = `could not build: ${e instanceof Error ? e.message : e}`;
    break;
  }
  if (!ctx) break;
  const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)), sighash);
  const hex = patchReferee(buildHex(ctx, placeholder), ctx, real);
  try {
    const txid = await provider.sendRawTransaction(hex);
    sent++;
    expected = ctx.passCount + 1;
    console.log(`#${sent} ok  pass ${ctx.passCount}->${expected}  price ${ctx.price}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${txid.slice(0, 12)}…`);
  } catch (e) {
    stopReason = `node refused at #${sent + 1}: ${e instanceof Error ? e.message : e}`;
    break;
  }
}
console.log(`\nChained ${sent} steals in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`Stopped: ${stopReason}`);
process.exit(0);