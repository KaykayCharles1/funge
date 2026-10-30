import { readFileSync } from "node:fs";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import { makeProvider } from "../src/lib/provider.ts";
import { getRound } from "../src/referee/api.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, toVmCategory } from "./helpers.ts";

export const game = JSON.parse(readFileSync(new URL("../public/game.chipnet.v2.json", import.meta.url), "utf8"));
const mnemonic = process.env.SPIKE_MNEMONIC;
if (!mnemonic) throw new Error("Set SPIKE_MNEMONIC first.");
export const wallet = walletFromMnemonic(mnemonic);
export const provider = makeProvider();
export const id: string = game.gameCategory;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(game.gameCategory)], { provider });
const state = new Contract(
  loadArtifact("FungeStateV2"),
  [hexToBin(pot.lockingBytecode), toVmCategory(game.pusdCategory), BigInt(game.params.basePrice), BigInt(game.params.priceStep),
    hexToBin(game.refereePubkey), BigInt(game.params.fallbackBlocks), BigInt(game.params.waitingFallbackBlocks)],
  { provider },
);

export const results = { failed: 0 };
export const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) results.failed++;
};
export const describe = (r: { ok: boolean; error?: string }) => (r.ok ? "accepted" : `refused: ${r.error}`);

export async function chainPass(): Promise<number> {
  const [u] = await provider.getUtxos(game.state.address);
  if (!u?.token?.nft) throw new Error("no live round");
  return decodeCommitment(u.token.nft.commitment).passCount;
}

export async function waitForPass(n: number) {
  for (let i = 0; i < 40; i++) {
    if ((await chainPass()) >= n) return;
    await sleep(1000);
  }
  throw new Error(`The network never showed pass ${n}.`);
}

// A signed grab for the current state, with a placeholder where the server puts the referee signature
export async function buildBody() {
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
export async function serverView() {
  const t0 = Date.now();
  const res = await getRound(id);
  const t1 = Date.now();
  if (!res.ok) throw new Error(`The server did not answer: ${res.error}`);
  return { round: res.round, offset: res.round.serverNow - (t0 + t1) / 2 };
}
export const sleepUntilServer = (serverMs: number, offset: number) => sleep(Math.max(0, serverMs - offset - Date.now()));