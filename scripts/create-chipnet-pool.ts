// Creates a practice Cauldron pool on chipnet, paid by the dev wallet (.wallet.chipnet.json). Chipnet only.
// Cauldron does not run on chipnet, so the game's "Get PUSD" swap trades with this pool there; on mainnet it uses
// Cauldron's real pools. It is the standard Cauldron pool contract: anyone may trade with it, and only the dev
// wallet may withdraw it. The price is whatever the two amounts make it (chipnet coins are free). Prints no key.
//   node scripts/create-chipnet-pool.ts                              shows what it would do, sends nothing
//   node scripts/create-chipnet-pool.ts --send                       7,500.00 test PUSD and 0.015 test BCH
//   node scripts/create-chipnet-pool.ts --send --pusd 5000 --bch 0.01  other amounts
// Afterwards: put the printed owner in src/config.ts (swap.chipnetPoolOwner). Running it again adds another pool
// for the same owner; the game trades with all of them.
import assert from "node:assert/strict";
import { binToHex } from "@bitauth/libauth";
import { TransactionBuilder } from "cashscript";
import { CONFIG, pusdCategory } from "../src/config.ts";
import { formatUnits } from "../src/lib/format.ts";
import { poolAddress, poolLock } from "../src/lib/swap.ts";
import { loadEnv } from "./env.ts";
import { retry } from "./helpers.ts";

const FEE_RATE = 2; // sats per byte; chipnet coins are free

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const toUnits = (text: string, decimals: number) => {
  const [whole, frac = ""] = text.split(".");
  assert.ok(/^\d+$/.test(whole!) && /^\d*$/.test(frac) && frac.length <= decimals, `Not an amount: ${text}`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
};

async function main() {
  assert.equal(CONFIG.network, "chipnet", "This script is for chipnet only");
  const send = process.argv.includes("--send");
  const pusd = toUnits(arg("--pusd", "7500"), CONFIG.pusdDecimals);
  const sats = toUnits(arg("--bch", "0.015"), 8);
  const category = pusdCategory();
  const { provider, tpl, lock, address, tokenAddress } = await loadEnv();
  const owner = lock.slice(3, 23); // the dev wallet's key hash: P2PKH is 76 a9 14 <20 bytes> 88 ac
  console.log("dev wallet :", address);
  console.log("pool       :", poolAddress(owner, "chipnet"));
  console.log("owner      :", binToHex(owner));
  console.log(`amounts    : ${formatUnits(pusd, CONFIG.pusdDecimals)} PUSD and ${formatUnits(sats, 8)} BCH`);
  console.log(`price      : ${(Number(sats) / Number(pusd)).toFixed(2)} sats per PUSD unit, so 20.00 PUSD costs about ${(Number(sats) / Number(pusd)) * 2000} sats`);

  const coins = await retry(() => provider.getUtxos(address));
  const pusdCoins = coins.filter((u) => u.token?.category === category && !u.token.nft);
  const bchCoins = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1)).slice(0, 30);
  const pusdHeld = pusdCoins.reduce((s, u) => s + u.token!.amount, 0n);
  const bchHeld = bchCoins.reduce((s, u) => s + u.satoshis, 0n);
  assert.ok(pusdHeld >= pusd, `The dev wallet holds ${formatUnits(pusdHeld, CONFIG.pusdDecimals)} test PUSD, less than the pool needs.`);
  const needed = sats + 5_000n + BigInt(bchCoins.length + pusdCoins.length) * 400n;
  assert.ok(bchHeld > needed, `The dev wallet needs more than ${needed} sats in BCH coins; it has ${bchHeld}.`);
  if (!send) {
    console.log("\nNothing sent. Run again with --send to create the pool.");
    return;
  }

  const tx = await new TransactionBuilder({ provider })
    .addInputs([...pusdCoins, ...bchCoins], tpl.unlockP2PKH())
    .addOutput({ to: poolLock(owner), amount: sats, token: { amount: pusd, category } })
    .addTokenChangeOutputIfNeeded({ category, to: tokenAddress }) // the rest of the PUSD back to the dev wallet
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("pool txid  :", tx.txid);
  console.log("\nPut this in src/config.ts (swap.chipnetPoolOwner):");
  console.log(binToHex(owner));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
