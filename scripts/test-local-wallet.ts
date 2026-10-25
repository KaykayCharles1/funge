import assert from "node:assert/strict";
import { makeProvider } from "../src/lib/provider.ts";
import { newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";

async function main() {
  const mnemonic = newMnemonic(); // never printed
  const a = walletFromMnemonic(mnemonic);

  // Restoring the same phrase gives the same wallet, even with messy spacing and capitals
  const b = walletFromMnemonic(`  ${mnemonic.toUpperCase().split(" ").join("   ")}  `);
  assert.equal(a.address, b.address);
  assert.equal(a.tokenAddress, b.tokenAddress);
  assert.equal(a.pkhHex, b.pkhHex);

  // A different phrase gives a different wallet
  assert.notEqual(a.address, walletFromMnemonic(newMnemonic()).address);

  assert.ok(a.address.startsWith("bchtest:q"), `unexpected address format: ${a.address}`);
  assert.ok(a.tokenAddress.startsWith("bchtest:z"), `unexpected token address format: ${a.tokenAddress}`);
  console.log("ok    create and restore give the same address");
  console.log("address:", a.address);

  // A fresh wallet is empty; this also proves the balance read works through the failover provider
  const balances = await a.getBalances(makeProvider());
  assert.equal(balances.sats, 0n);
  assert.equal(balances.pusd, 0n);
  console.log("ok    balance read works (empty wallet)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });