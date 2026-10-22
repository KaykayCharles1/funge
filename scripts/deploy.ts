import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Contract, TransactionBuilder } from "cashscript";
import { hexToBin } from "@bitauth/libauth";
import { CONFIG, pusdCategory } from "../src/config.ts";
import { loadEnv } from "./env.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, retry, toVmCategory } from "./helpers.ts";

const FEE_RATE = 2;
const OUT = `public/game.${CONFIG.network}.json`;

async function main() {
  assert.ok(!existsSync(OUT), `${OUT} already exists. Delete it first if you really want a new game.`);
  const env = await loadEnv();
  const { provider, tpl, lock, lockHex, tokenAddress, address } = env;
  const pusd = pusdCategory();
  assert.match(pusd, /^[0-9a-f]{64}$/, "pusdCategory in src/config.ts is not set");
  const contractSats = CONFIG.minSats * 2n;

  const utxos = await retry(() => provider.getUtxos(address));
  const funding = utxos
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  assert.ok(funding, "No BCH-only UTXO found");
  const pusdUtxo = utxos.find(
    (u) => u.token?.category === pusd && !u.token.nft && u.token.amount >= CONFIG.seedPot,
  );
  assert.ok(pusdUtxo, "No PUSD UTXO with enough tokens for the seed pot");

  // Tx 1 (prep): spare output at index 0. Its txid becomes the game NFT category.
  const prep = await new TransactionBuilder({ provider })
    .addInput(funding, tpl.unlockP2PKH())
    .addOutput({ to: lock, amount: 10_000n })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  const gameCategory = prep.txid;
  console.log("prep txid / game category:", gameCategory);

  // Both contract addresses are now computable
  const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(gameCategory)], { provider });
  const state = new Contract(
    loadArtifact("FungeState"),
    [hexToBin(pot.lockingBytecode), toVmCategory(pusd), CONFIG.basePrice, CONFIG.priceStep, BigInt(CONFIG.timeoutBlocks)],
    { provider },
  );
  console.log("state contract:", state.tokenAddress);
  console.log("pot contract  :", pot.tokenAddress);

  // Tx 2 (init): NFT straight into the state contract, seed PUSD into the pot
  const genesisInput = { txid: prep.txid, vout: 0, satoshis: 10_000n, lockingBytecode: lockHex };
  const init = await new TransactionBuilder({ provider })
    .addInput(genesisInput, tpl.unlockP2PKH())
    .addInput(pusdUtxo, tpl.unlockP2PKH())
    .addOutput({
      to: state.tokenAddress,
      amount: contractSats,
      token: {
        amount: 0n,
        category: gameCategory,
        nft: { capability: "mutable", commitment: encodeCommitment(0, env.pkhHex) },
      },
    })
    .addOutput({
      to: pot.tokenAddress,
      amount: contractSats,
      token: { amount: CONFIG.seedPot, category: pusd },
    })
    .addTokenChangeOutputIfNeeded({ category: pusd, to: tokenAddress })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("init txid:", init.txid);

  const game = {
    network: CONFIG.network,
    gameCategory,
    pusdCategory: pusd,
    state: { address: state.address, tokenAddress: state.tokenAddress, lockingBytecode: state.lockingBytecode },
    pot: { address: pot.address, tokenAddress: pot.tokenAddress, lockingBytecode: pot.lockingBytecode },
    params: {
      basePrice: CONFIG.basePrice.toString(),
      priceStep: CONFIG.priceStep.toString(),
      timeoutBlocks: CONFIG.timeoutBlocks,
      seedPot: CONFIG.seedPot.toString(),
    },
    creatorPkh: env.pkhHex,
    prepTxid: prep.txid,
    initTxid: init.txid,
  };
  mkdirSync("public", { recursive: true });
  writeFileSync(OUT, JSON.stringify(game, null, 2));
  console.log("wrote", OUT);

  // Soft check: wait until the state UTXO is visible and decode it
  for (let i = 0; i < 10; i++) {
    const [s] = await retry(() => state.getUtxos());
    if (s?.token?.nft) {
      console.log("state UTXO visible, commitment:", decodeCommitment(s.token.nft.commitment));
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("State UTXO not visible yet (server lag). Re-check in a minute.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });