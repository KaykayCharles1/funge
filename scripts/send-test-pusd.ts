import assert from "node:assert/strict";
import { TransactionBuilder } from "cashscript";
import { pusdCategory } from "../src/config.ts";
import { loadEnv } from "./env.ts";
import { retry } from "./helpers.ts";

const FEE_RATE = 2;

async function main() {
  const to = process.argv[2];
  const units = BigInt(process.argv[3] ?? "100000");
  assert.ok(
    to && to.startsWith("bchtest:z"),
    "Usage: npx tsx scripts/send-test-pusd.ts <token-aware chipnet address starting with bchtest:z> [units]",
  );

  const env = await loadEnv();
  const pusd = pusdCategory();
  const utxos = await retry(() => env.provider.getUtxos(env.address));
  const pusdUtxo = utxos.find((u) => u.token && u.token.category === pusd && !u.token.nft && u.token.amount >= units);
  const bchUtxo = utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  assert.ok(pusdUtxo, `No PUSD UTXO with at least ${units} units`);
  assert.ok(bchUtxo, "No BCH-only UTXO");

  // One output carries the tokens plus 20,000 sats, so the wallet can pay its own fees later
  const sent = await new TransactionBuilder({ provider: env.provider })
    .addInput(pusdUtxo, env.tpl.unlockP2PKH())
    .addInput(bchUtxo, env.tpl.unlockP2PKH())
    .addOutput({ to, amount: 20_000n, token: { amount: units, category: pusd } })
    .addTokenChangeOutputIfNeeded({ category: pusd, to: env.tokenAddress })
    .addBchChangeOutputIfNeeded({ to: env.lock, feeRate: FEE_RATE })
    .send();
  console.log(`Sent ${units} test units and 20,000 sats. txid: ${sent.txid}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });