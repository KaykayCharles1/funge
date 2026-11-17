// Creates a new test PUSD token on chipnet, paid by the dev wallet (.wallet.chipnet.json). Chipnet only.
// The whole supply goes to the dev wallet, together with a minting NFT: whoever holds that NFT can mint more
// PUSD later, so the supply never runs out again. Prints no key.
//   node scripts/create-test-token.ts          shows what it would do, sends nothing
//   node scripts/create-test-token.ts --send   creates the token for real (two transactions)
// Afterwards: put the printed category in src/config.ts (pusdCategory.chipnet).
import assert from "node:assert/strict";
import { TransactionBuilder } from "cashscript";
import { CONFIG } from "../src/config.ts";
import { loadEnv } from "./env.ts";
import { retry } from "./helpers.ts";

const SUPPLY = 10_000_000n; // base units: 100,000.00 PUSD (2 decimals)
const FEE_RATE = 2; // sats per byte; chipnet coins are free
const PREP_SATS = 10_000n; // the spare output whose txid becomes the token category
const TOKEN_SATS = 1_000n; // BCH carried by each token output

async function main() {
  assert.equal(CONFIG.network, "chipnet", "This script is for chipnet only");
  const send = process.argv.includes("--send");
  const { provider, tpl, lock, lockHex, address, tokenAddress } = await loadEnv();
  console.log("dev wallet:", address);

  const utxos = await retry(() => provider.getUtxos(address));
  const funding = utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1)).slice(0, 30);
  const fundingSats = funding.reduce((sum, u) => sum + u.satoshis, 0n);
  const needed = PREP_SATS + 5_000n + BigInt(funding.length) * 400n;
  assert.ok(fundingSats > needed, `The dev wallet needs more than ${needed} sats in BCH coins; it has ${fundingSats}.`);
  console.log(`paying with ${funding.length} BCH coin(s), ${fundingSats} sats`);
  console.log(`would create ${SUPPLY} base units (${SUPPLY / 100n} PUSD) and a minting NFT, both to ${tokenAddress}`);
  if (!send) {
    console.log("\nNothing sent. Run again with --send to create the token.");
    return;
  }

  // Tx 1: a spare output at index 0. Its txid becomes the token category.
  const prep = await new TransactionBuilder({ provider })
    .addInputs(funding, tpl.unlockP2PKH())
    .addOutput({ to: lock, amount: PREP_SATS })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("prep txid   :", prep.txid);

  // Tx 2: spend that output to create the category: the supply in one output, the minting NFT in another
  const genesisInput = { txid: prep.txid, vout: 0, satoshis: PREP_SATS, lockingBytecode: lockHex };
  const genesis = await new TransactionBuilder({ provider })
    .addInput(genesisInput, tpl.unlockP2PKH())
    .addOutput({ to: tokenAddress, amount: TOKEN_SATS, token: { amount: SUPPLY, category: prep.txid } })
    .addOutput({ to: tokenAddress, amount: TOKEN_SATS, token: { amount: 0n, category: prep.txid, nft: { capability: "minting", commitment: "" } } })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("genesis txid:", genesis.txid);

  console.log("\nNew test PUSD category (put this in src/config.ts, pusdCategory.chipnet):");
  console.log(prep.txid);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
