import { TestNetWallet, Wallet } from "mainnet-js";
import { existsSync, writeFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { loadEnv } from "./env.ts";

// The deploy wallet in .wallet.<network>.json (git ignores it): creates it the first time, then shows its addresses
// and balance. Never prints the key or the seed phrase.
// Chipnet: a WIF. Mainnet: a seed phrase, because the GitHub robot takes the same wallet as a seed phrase
// (secret FUNGE_DEPLOY_SEED_MAINNET), on BCH's usual path m/44'/145'/0'/0/0 (scripts/env.ts).
//   VITE_FUNGE_NETWORK=mainnet node scripts/wallet.ts
const FILE = `.wallet.${CONFIG.network}.json`;

async function main() {
  if (!existsSync(FILE)) {
    if (CONFIG.network === "mainnet") {
      const { mnemonic } = await Wallet.newRandom();
      writeFileSync(FILE, JSON.stringify({ seed: mnemonic }, null, 2));
    } else {
      writeFileSync(FILE, JSON.stringify({ wif: (await TestNetWallet.newRandom()).privateKeyWif }, null, 2));
    }
    console.log(`Created ${FILE} (git ignores it). Never share or commit it.`);
  }
  const env = await loadEnv({ mainnet: true });
  const sats = (await env.provider.getUtxos(env.address)).reduce((n, u) => n + (u.token ? 0n : u.satoshis), 0n);
  console.log(`Network      : ${CONFIG.network}`);
  console.log(`BCH address  : ${env.address}`);
  console.log(`Token address: ${env.tokenAddress}`);
  console.log(`Balance      : ${sats} sats (${Number(sats) / 1e8} BCH)`);
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
