// Merges the dev wallet's plain BCH coins into one coin at the same address, so deploy-kingdom.ts finds a coin
// big enough (it wants one BCH coin above 25,000 sats). Chipnet only. Token coins are never touched. Prints no key.
//   node scripts/merge-coins-chipnet.ts          shows what it would do, sends nothing
//   node scripts/merge-coins-chipnet.ts --send   merges for real
import assert from "node:assert/strict";
import { TransactionBuilder } from "cashscript";
import { CONFIG } from "../src/config.ts";
import { loadEnv } from "./env.ts";
import { retry } from "./helpers.ts";

const MAX_INPUTS = 100; // about 15 kB, far below the 100 kB standard limit
const FEE_RATE = 1.2; // sats per byte; chipnet relays at 1
const INPUT_BYTES = 148n; // a signed P2PKH input
const MIN_COIN = 1_000n; // smaller coins cost more to spend than they hold

async function main() {
  assert.equal(CONFIG.network, "chipnet", "Chipnet only.");
  const env = await loadEnv();
  const coins = (await retry(() => env.provider.getUtxos(env.address)))
    .filter((u) => !u.token && u.satoshis >= MIN_COIN)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))
    .slice(0, MAX_INPUTS);
  assert.ok(coins.length >= 2, "Nothing to merge: fewer than two plain BCH coins.");

  const total = coins.reduce((sum, u) => sum + u.satoshis, 0n);
  const bytes = 10n + INPUT_BYTES * BigInt(coins.length) + 34n;
  const fee = BigInt(Math.ceil(Number(bytes) * FEE_RATE));
  const out = total - fee;
  console.log(`address: ${env.address}`);
  console.log(`merging ${coins.length} plain BCH coins (${total} sats) into one coin of ${out} sats; fee ${fee} sats`);

  if (!process.argv.includes("--send")) {
    console.log("Nothing sent. Run again with --send to merge.");
    return;
  }
  const builder = new TransactionBuilder({ provider: env.provider });
  for (const c of coins) builder.addInput(c, env.tpl.unlockP2PKH());
  builder.addOutput({ to: env.lock, amount: out });
  const tx = await builder.send();
  console.log("merged, txid:", tx.txid);
  console.log("Wait a few seconds, then run: node scripts/deploy-kingdom.ts");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
