// Finding an own wallet's coins along its receive and change paths (src/lib/walletCoins.ts), on a fake chain.
//   node scripts/test-wallet-coins.ts
import assert from "node:assert/strict";
import { binToHex, hash160, secp256k1, sha256 } from "@bitauth/libauth";
import type { SpendableUtxo } from "cashscript";
import { p2pkhLock } from "../src/lib/chain.ts";
import { scanWalletCoins } from "../src/lib/walletCoins.ts";

// A fake wallet per test (family f): a fixed key for each (path, index)
const keyAt = (f: number) => (child: number, index: bigint) => {
  const priv = sha256.hash(new TextEncoder().encode(`test ${f} ${child} ${index}`));
  return secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
};
const lockAt = (f: number, child: number, index: number) => p2pkhLock(hash160(keyAt(f)(child, BigInt(index))));
const scripthash = (lock: Uint8Array) => binToHex(sha256.hash(lock).slice().reverse());

// A fake chain for wallet f: which addresses have history, and which hold coins. Counts requests and rounds
// (a round: requests sent together before any answer is awaited).
function chain(f: number, used: [number, number][], coins: [number, number, bigint][]) {
  const history = new Set(used.map(([c, i]) => scripthash(lockAt(f, c, i))));
  const utxos = new Map<string, SpendableUtxo[]>();
  for (const [c, i, sats] of coins) {
    const k = binToHex(lockAt(f, c, i));
    utxos.set(k, [...(utxos.get(k) ?? []), { txid: "ab".repeat(32), vout: utxos.size, satoshis: sats } as SpendableUtxo]);
    history.add(scripthash(lockAt(f, c, i)));
  }
  let requests = 0, rounds = 0, open = false;
  const tick = async () => {
    requests++;
    if (!open) {
      open = true;
      rounds++;
      queueMicrotask(() => setTimeout(() => (open = false), 0));
    }
    await new Promise((r) => setTimeout(r, 1));
  };
  return {
    get requests() { return requests; },
    get rounds() { return rounds; },
    provider: {
      async performRequest(_name: string, hash: string) {
        await tick();
        return history.has(String(hash)) ? [{ tx_hash: "cd".repeat(32), height: 1 }] : [];
      },
      async getUtxosForLockingBytecode(lock: Uint8Array) {
        await tick();
        return utxos.get(binToHex(lock)) ?? [];
      },
    } as unknown as Parameters<typeof scanWalletCoins>[0],
  };
}

// 1. Coins far along the receive path (index 34) and on the change path; used addresses with no coins left between
{
  const c = chain(1, [[0, 0], [0, 15], [1, 0]], [[0, 34, 50_000n], [1, 2, 7_000n], [0, 0, 1_000n]]);
  const coins = await scanWalletCoins(c.provider, keyAt(1));
  assert.deepEqual(coins.map((x) => `${x.path}/${x.index}`).sort(), ["change/2", "receive/0", "receive/34"]);
  assert.equal(coins.reduce((n, x) => n + x.utxo.satoshis, 0n), 58_000n);
  console.log("ok    coins far along the receive path and on the change path are found");
}

// 2. The gap rule, as in wallet apps: after 20 unused addresses in a row the search stops
{
  const near = chain(2, [[0, 0]], [[0, 20, 9_000n]]); // 19 unused (1 to 19), then a coin: found
  assert.equal((await scanWalletCoins(near.provider, keyAt(2))).length, 1);
  const far = chain(3, [[0, 0]], [[0, 22, 9_000n]]); // 21 unused (1 to 21), then a coin: not looked for
  assert.equal((await scanWalletCoins(far.provider, keyAt(3))).length, 0);
  console.log("ok    a coin within 20 unused addresses is found; past 20 in a row the search stops");
}

// 3. Another wallet's coins are never counted
{
  const c = chain(4, [[0, 0]], [[0, 3, 9_000n]]);
  assert.equal((await scanWalletCoins(c.provider, keyAt(5))).length, 0);
  console.log("ok    another wallet's coins are not counted");
}

// 4. The second look asks for everything in one round (the first needs several, as it walks along the paths)
{
  const c = chain(6, [[0, 0], [0, 15]], [[0, 34, 50_000n], [0, 50, 1_000n]]);
  const first = await scanWalletCoins(c.provider, keyAt(6));
  const firstRounds = c.rounds;
  const second = await scanWalletCoins(c.provider, keyAt(6));
  assert.equal(second.length, first.length);
  assert.equal(second.length, 2);
  assert.ok(firstRounds > 1, `first look: ${firstRounds} rounds`);
  assert.equal(c.rounds - firstRounds, 1, `second look: ${c.rounds - firstRounds} rounds`);
  console.log(`ok    the second look takes one round (the first took ${firstRounds})`);
}

console.log("\nall wallet coin tests passed");
