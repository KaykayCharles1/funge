import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SignatureTemplate } from "cashscript";
import { TestNetWallet } from "mainnet-js";
import { binToHex } from "@bitauth/libauth";
import { CONFIG } from "../src/config.ts";
import { p2pkhLock, pkhOf } from "./helpers.ts";
import { makeProvider } from "../src/lib/provider.ts";

// The paying wallet. On a computer: the wif in .wallet.chipnet.json. On the GitHub robot: the seed phrase in
// FUNGE_DEPLOY_SEED (BCH's usual path m/44'/145'/0'/0/0, or FUNGE_DEPLOY_PATH), or a WIF in FUNGE_DEPLOY_WIF.
async function openWallet() {
  const seed = process.env.FUNGE_DEPLOY_SEED?.trim();
  if (seed) return TestNetWallet.fromSeed(seed, process.env.FUNGE_DEPLOY_PATH || "m/44'/145'/0'/0/0");
  const wif = process.env.FUNGE_DEPLOY_WIF?.trim() || JSON.parse(readFileSync(".wallet.chipnet.json", "utf8")).wif;
  return TestNetWallet.fromWIF(wif);
}

export async function loadEnv() {
  assert.equal(CONFIG.network, "chipnet", "These scripts are chipnet-only for now");
  const wallet = await openWallet();
  const tpl = new SignatureTemplate(wallet.privateKeyWif);
  const pkh = pkhOf(tpl.publicKey);
  const lock = p2pkhLock(pkh);
  return {
    tpl,
    pkh,
    pkhHex: binToHex(pkh),
    lock,
    lockHex: binToHex(lock),
    address: wallet.getDepositAddress(),
    tokenAddress: wallet.getTokenDepositAddress(),
    provider: makeProvider(),
  };
}