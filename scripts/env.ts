import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SignatureTemplate } from "cashscript";
import { TestNetWallet, Wallet } from "mainnet-js";
import { binToHex } from "@bitauth/libauth";
import { CONFIG } from "../src/config.ts";
import { p2pkhLock, pkhOf } from "./helpers.ts";
import { makeProvider } from "../src/lib/provider.ts";

// The paying wallet. On the GitHub robot: the seed phrase in FUNGE_DEPLOY_SEED (BCH's usual path m/44'/145'/0'/0/0,
// or FUNGE_DEPLOY_PATH), or a WIF in FUNGE_DEPLOY_WIF. On a computer: .wallet.<network>.json (scripts/wallet.ts),
// which holds a seed phrase (mainnet) or a WIF (chipnet).
async function openWallet() {
  const W = CONFIG.network === "mainnet" ? Wallet : TestNetWallet;
  const path = process.env.FUNGE_DEPLOY_PATH || "m/44'/145'/0'/0/0";
  const envSeed = process.env.FUNGE_DEPLOY_SEED?.trim();
  if (envSeed) return W.fromSeed(envSeed, path);
  const envWif = process.env.FUNGE_DEPLOY_WIF?.trim();
  if (envWif) return W.fromWIF(envWif);
  const file = JSON.parse(readFileSync(`.wallet.${CONFIG.network}.json`, "utf8")) as { seed?: string; wif?: string };
  return file.seed ? W.fromSeed(file.seed, path) : W.fromWIF(String(file.wif));
}

// Most scripts are chipnet tools (test token, practice pool, test coins). Only deploying rounds
// (deploy-kingdom.ts, and the robot through it) may run on mainnet, and says so with { mainnet: true }.
export async function loadEnv(o: { mainnet?: boolean } = {}) {
  if (!o.mainnet) assert.equal(CONFIG.network, "chipnet", "This script is chipnet-only");
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