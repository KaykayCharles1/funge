import assert from "node:assert/strict";
import { isValidMnemonic, newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";
import { makeVault } from "../src/wallet/vault.ts";
import type { VaultRecord, VaultStorage } from "../src/wallet/vault.ts";

function memoryStorage(): VaultStorage & { peek(): VaultRecord | undefined } {
  let record: VaultRecord | undefined;
  return {
    get: async () => record,
    put: async (r) => {
      record = r;
    },
    clear: async () => {
      record = undefined;
    },
    peek: () => record,
  };
}

async function main() {
  assert.equal(isValidMnemonic("not a real seed phrase at all"), false);

  // --- password mode ---
  {
    const storage = memoryStorage();
    const mnemonic = newMnemonic();
    assert.ok(isValidMnemonic(mnemonic));
    const expected = walletFromMnemonic(mnemonic).address;

    const v1 = makeVault(storage);
    assert.equal(await v1.init(), "none");
    await v1.create(mnemonic, "correct horse battery");
    assert.equal(v1.state(), "unlocked");
    assert.equal(v1.hasPassword(), true);
    assert.equal(v1.wallet()?.address, expected);

    // The stored bytes must not contain the phrase in readable form
    const stored = storage.peek()!;
    const asText = Buffer.from(stored.ciphertext).toString("latin1");
    assert.ok(!asText.includes(mnemonic.split(" ")[0] + " " + mnemonic.split(" ")[1]));
    console.log("ok    password mode: created and stored encrypted");

    // "Reload": a brand new vault object on the same storage starts locked
    const v2 = makeVault(storage);
    assert.equal(await v2.init(), "locked");
    assert.equal(v2.wallet(), null);
    assert.equal(await v2.unlock("wrong password"), false);
    assert.equal(v2.state(), "locked");
    assert.equal(await v2.unlock("correct horse battery"), true);
    assert.equal(v2.wallet()?.address, expected);
    assert.equal(v2.revealMnemonic(), mnemonic);
    console.log("ok    password mode: reload starts locked, wrong password fails, right password unlocks");

    v2.lock();
    assert.equal(v2.state(), "locked");
    assert.equal(v2.wallet(), null);
    assert.equal(v2.revealMnemonic(), null);
    console.log("ok    lock drops the wallet from memory");

    await v2.wipe();
    assert.equal(v2.state(), "none");
    assert.equal(storage.peek(), undefined);
    console.log("ok    wipe removes everything");
  }

  // --- device mode (no password) ---
  {
    const storage = memoryStorage();
    const mnemonic = newMnemonic();
    const v1 = makeVault(storage);
    await v1.create(mnemonic);
    assert.equal(v1.hasPassword(), false);
    const v2 = makeVault(storage);
    assert.equal(await v2.init(), "unlocked"); // opens by itself after a reload
    assert.equal(v2.wallet()?.address, walletFromMnemonic(mnemonic).address);
    console.log("ok    device mode: reopens automatically after a reload");
  }

  // --- guards ---
  {
    const v = makeVault(memoryStorage());
    await assert.rejects(() => v.create("not a valid phrase"), /not valid/);
    await assert.rejects(() => v.create(newMnemonic(), "short"), /at least 8/);
    await v.create(newMnemonic());
    await assert.rejects(() => v.create(newMnemonic()), /already exists/);
    console.log("ok    guards: invalid phrase, short password, and double-create are rejected");
  }

  console.log("\nAll vault tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });