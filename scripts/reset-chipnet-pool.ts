// Re-prices the chipnet practice pool to Cauldron's live mainnet price, so a chipnet swap shows about the same rate
// as a real one. In one transaction it takes the dev wallet's practice pools back (only their owner can) and puts a
// new pool on the same contract at that price. Paid by the dev wallet (.wallet.chipnet.json). Chipnet only. Prints no key.
//   node scripts/reset-chipnet-pool.ts                 shows what it would do, sends nothing (0.5 test BCH in the pool)
//   node scripts/reset-chipnet-pool.ts --bch 0.3       another pool size
//   node scripts/reset-chipnet-pool.ts --send          does it
// The bigger the pool, the bigger a swap can be before its price impact passes 3%: about 1.3% of the pool's BCH.
// The pool's PUSD side follows from the price (0.5 test BCH is about 100 test PUSD). Run it again later to follow
// the mainnet price.
import assert from "node:assert/strict";
import { binToHex, hash160 } from "@bitauth/libauth";
import { TransactionBuilder } from "cashscript";
import { CONFIG, pusdCategory } from "../src/config.ts";
import { formatUnits } from "../src/lib/format.ts";
import { poolLock, poolWithdrawUnlocker, quote } from "../src/lib/swap.ts";
import { loadEnv } from "./env.ts";
import { retry } from "./helpers.ts";

const FEE_RATE = 2; // sats per byte; chipnet coins are free

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  assert.equal(CONFIG.network, "chipnet", "This script is for chipnet only");
  const send = process.argv.includes("--send");
  const bchText = arg("--bch", "0.5");
  assert.ok(/^\d+(\.\d{1,8})?$/.test(bchText), `Not an amount: ${bchText}`);
  const [whole, frac = ""] = bchText.split(".");
  const poolSats = BigInt(whole!) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  const category = pusdCategory();
  const { provider, tpl, address, tokenAddress, lock } = await loadEnv();
  const owner = hash160(tpl.publicKey);
  assert.equal(binToHex(owner), CONFIG.swap.chipnetPoolOwner, "The dev wallet is not the owner in src/config.ts (swap.chipnetPoolOwner)");

  // Cauldron's live price of real PUSD: sats per base unit
  const res = await fetch(`${CONFIG.swap.indexerUrl}/cauldron/price/${CONFIG.pusdCategory.mainnet}/current`);
  const price = ((await res.json()) as { price?: unknown }).price;
  assert.ok(typeof price === "number" && price > 0, "Could not read Cauldron's price");
  const poolUnits = BigInt(Math.round(Number(poolSats) / price));
  const perPusd = (price * 10 ** CONFIG.pusdDecimals) / 1e8;
  console.log(`mainnet price : 1 PUSD = ${perPusd.toFixed(8)} BCH (Cauldron, now)`);
  console.log(`new pool      : ${formatUnits(poolSats, 8)} test BCH and ${formatUnits(poolUnits, CONFIG.pusdDecimals)} test PUSD`);

  const old = await retry(() => provider.getUtxosForLockingBytecode(poolLock(owner)));
  const oldSats = old.reduce((n, u) => n + u.satoshis, 0n);
  const oldUnits = old.reduce((n, u) => n + (u.token?.category === category ? u.token.amount : 0n), 0n);
  console.log(`old pool(s)   : ${old.length}, holding ${formatUnits(oldSats, 8)} test BCH and ${formatUnits(oldUnits, CONFIG.pusdDecimals)} test PUSD (back to the dev wallet)`);

  const coins = await retry(() => provider.getUtxos(address));
  const bchCoins = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1)).slice(0, 30);
  const pusdCoins = coins.filter((u) => u.token?.category === category && !u.token.nft);
  const haveSats = oldSats + bchCoins.reduce((n, u) => n + u.satoshis, 0n) + pusdCoins.reduce((n, u) => n + u.satoshis, 0n);
  const haveUnits = oldUnits + pusdCoins.reduce((n, u) => n + u.token!.amount, 0n);
  const needSats = poolSats + 5_000n + BigInt(old.length + bchCoins.length + pusdCoins.length) * 300n;
  console.log(`dev wallet    : ${address}`);
  assert.ok(haveSats >= needSats, `Not enough test BCH: the old pool and the dev wallet hold ${formatUnits(haveSats, 8)}, the new pool needs about ${formatUnits(needSats, 8)}. Top up the dev wallet, or use a smaller --bch.`);
  assert.ok(haveUnits >= poolUnits, "Not enough test PUSD for the new pool.");

  // What a player would see from the new pool
  const fake = [{ version: "0" as const, parameters: { withdraw_pubkey_hash: owner }, outpoint: { txhash: new Uint8Array(32), index: 0 },
    output: { locking_bytecode: poolLock(owner), amount: poolSats, token: { amount: poolUnits, token_id: category } } }];
  for (const bch of [200_000n, 1_000_000n]) {
    try {
      const q = quote(fake, category, bch, "sell");
      console.log(`  selling ${formatUnits(bch, 8)} BCH gets ${formatUnits(q.pusd, CONFIG.pusdDecimals)} PUSD (price impact ${(q.priceMove * 100).toFixed(2)}%)`);
    } catch {
      console.log(`  selling ${formatUnits(bch, 8)} BCH: too big for this pool`);
    }
  }
  if (!send) {
    console.log("\nNothing sent. Run again with --send to re-price the pool.");
    return;
  }

  const builder = new TransactionBuilder({ provider });
  for (const u of old) builder.addInput(u, poolWithdrawUnlocker(tpl));
  builder
    .addInputs([...pusdCoins, ...bchCoins], tpl.unlockP2PKH())
    .addOutput({ to: poolLock(owner), amount: poolSats, token: { amount: poolUnits, category } })
    .addTokenChangeOutputIfNeeded({ category, to: tokenAddress }) // the rest of the test PUSD back to the dev wallet
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE });
  const tx = await builder.send();
  console.log("txid          :", tx.txid);
  console.log("\nDone. The game's chipnet swap now trades at the mainnet price.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
