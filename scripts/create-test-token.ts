import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from "cashscript";
import { TestNetWallet } from "mainnet-js";
import { binToHex } from "@bitauth/libauth";
import { p2pkhLock, pkhOf } from "./helpers.ts";
import { CONFIG } from "../src/config.ts";

const SUPPLY = 1_000_000n; // test token base units
const FEE_RATE = 2; // sats/byte, chipnet coins are free

async function main() {
  assert.equal(CONFIG.network, "chipnet", "This script is for chipnet only");

  const { wif } = JSON.parse(readFileSync(".wallet.chipnet.json", "utf8"));
  const wallet = await TestNetWallet.fromWIF(wif);
  const address = wallet.getDepositAddress();
  const tokenAddress = wallet.getTokenDepositAddress();

  const tpl = new SignatureTemplate(wif);
  const lock = p2pkhLock(pkhOf(tpl.publicKey));
  const lockHex = binToHex(lock);

  const provider = new ElectrumNetworkProvider("chipnet");

  // Pick the biggest BCH-only UTXO
  const utxos = await provider.getUtxos(address);
  const funding = utxos
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  assert.ok(funding, "No BCH-only UTXO found. Fund the wallet first.");
  assert.equal(funding.lockingBytecode, lockHex, "SignatureTemplate key does not match the wallet address");

  // Tx 1: make a spare output at index 0. Its txid becomes the token category.
  const prep = await new TransactionBuilder({ provider })
    .addInput(funding, tpl.unlockP2PKH())
    .addOutput({ to: lock, amount: 10_000n })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("prep txid   :", prep.txid);

  // Tx 2: spend that output (vout 0) to create the fungible token category
  const genesisInput = { txid: prep.txid, vout: 0, satoshis: 10_000n, lockingBytecode: lockHex };
  const genesis = await new TransactionBuilder({ provider })
    .addInput(genesisInput, tpl.unlockP2PKH())
    .addOutput({ to: tokenAddress, amount: 1_000n, token: { amount: SUPPLY, category: prep.txid } })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("genesis txid:", genesis.txid);

  console.log("\nTest PUSD category (put this in src/config.ts, chipnet):");
  console.log(prep.txid);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });