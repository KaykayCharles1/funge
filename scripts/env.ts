import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ElectrumNetworkProvider, SignatureTemplate } from "cashscript";
import { TestNetWallet } from "mainnet-js";
import { binToHex } from "@bitauth/libauth";
import { CONFIG } from "../src/config.ts";
import { p2pkhLock, pkhOf } from "./helpers.ts";

export async function loadEnv() {
  assert.equal(CONFIG.network, "chipnet", "These scripts are chipnet-only for now");
  const { wif } = JSON.parse(readFileSync(".wallet.chipnet.json", "utf8"));
  const wallet = await TestNetWallet.fromWIF(wif);
  const tpl = new SignatureTemplate(wif);
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
    provider: new ElectrumNetworkProvider("chipnet"),
  };
}