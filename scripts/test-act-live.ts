// Run: read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC; node scripts/test-act-live.ts
import { readFileSync } from "node:fs";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import { makeProvider } from "../src/lib/provider.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, toVmCategory } from "./helpers.ts";

const SERVER = process.env.FUNGE_SERVER ?? "http://127.0.0.1:8787";
const COUNT = Number(process.env.ACT_COUNT ?? 3);
const game = JSON.parse(readFileSync(new URL("../public/game.chipnet.v2.json", import.meta.url), "utf8"));
const mnemonic = process.env.SPIKE_MNEMONIC;
if (!mnemonic) throw new Error("Set SPIKE_MNEMONIC first.");
const wallet = walletFromMnemonic(mnemonic);
const provider = makeProvider();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(game.gameCategory)], { provider });
const state = new Contract(
  loadArtifact("FungeStateV2"),
  [hexToBin(pot.lockingBytecode), toVmCategory(game.pusdCategory), BigInt(game.params.basePrice), BigInt(game.params.priceStep),
    hexToBin(game.refereePubkey), BigInt(game.params.fallbackBlocks), BigInt(game.params.waitingFallbackBlocks)],
  { provider },
);

async function once(n: number) {
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

  const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32))); // the server replaces this
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
      token: u.token ? { amount: String(u.token.amount), category: u.token.category } : undefined,
    })),
  };
  const res = await fetch(`${SERVER}/rounds/${game.gameCategory}/act`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  console.log(`#${n} pass ${passCount}->${passCount + 1}: HTTP ${res.status}`, await res.text());
}

for (let i = 1; i <= COUNT; i++) {
  await once(i).catch((e) => console.log(`#${i} client error:`, e instanceof Error ? e.message : e));
  if (i < COUNT) await sleep(5000);
}
process.exit(0);