// Swap BCH for PUSD against Cauldron pool contracts (src/lib/swap.ts) on CashScript's in-memory chain: the real
// Cauldron contract from CashLab, real signatures, every transaction checked by the BCH VM.   node scripts/test-swap.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { binToHex } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { lockToAddress } from "../src/lib/chain.ts";
import { newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";
import {
  buildSwap, poolAddress, poolLock, poolsFromIndexer, poolsOnChain, quote, sendSwap, SwapFailure,
} from "../src/lib/swap.ts";

const PUSD = "0123456789abcdef".repeat(4); // not symmetric: a byte-order mistake would show
const hex32 = () => randomBytes(32).toString("hex");

function setup(pools: [bigint, bigint][], walletSats: bigint[] = [20_000_000n]) {
  const chain = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
  const owner = randomBytes(20);
  for (const [sats, tokens] of pools) {
    chain.addUtxo(poolAddress(owner, "chipnet"), { txid: hex32(), vout: 0, satoshis: sats, token: { amount: tokens, category: PUSD } });
  }
  const wallet = walletFromMnemonic(newMnemonic());
  for (const s of walletSats) chain.addUtxo(lockToAddress(wallet.lock, false), { txid: hex32(), vout: 0, satoshis: s });
  // a token coin in the wallet must not be touched by a swap
  chain.addUtxo(lockToAddress(wallet.lock, true), { txid: hex32(), vout: 0, satoshis: 1_000n, token: { amount: 5n, category: PUSD } });
  return { chain, owner, wallet };
}

async function holdings(chain: MockNetworkProvider, lock: Uint8Array) {
  const coins = await chain.getUtxosForLockingBytecode(lock);
  return {
    sats: coins.reduce((s, u) => s + u.satoshis, 0n),
    pusd: coins.reduce((s, u) => s + (u.token?.category === PUSD ? u.token.amount : 0n), 0n),
  };
}

async function refused(p: Promise<unknown> | (() => unknown), code: string) {
  const run = typeof p === "function" ? Promise.resolve().then(p) : p;
  await assert.rejects(run, (e: unknown) => e instanceof SwapFailure && e.code === code);
}

// 1. Buy 20.00 PUSD from one pool (10,000.00 PUSD and 5 BCH: 500 sats per unit)
{
  const { chain, owner, wallet } = setup([[500_000_000n, 1_000_000n]]);
  const pools = await poolsOnChain(chain, owner, PUSD);
  assert.equal(pools.length, 1);
  const q = quote(pools, PUSD, 2_000n);
  assert.ok(q.pusd >= 2_000n, `got ${q.pusd}`);
  assert.ok(q.sats > 1_000_000n && q.sats < 1_010_000n, `cost ${q.sats}`); // 2000 x 500 plus the pool's 0.3% fee
  assert.ok(q.priceMove > 0 && q.priceMove < 0.01, `move ${q.priceMove}`);
  const before = await holdings(chain, wallet.lock);
  const tx = await buildSwap(chain, wallet, q);
  const txid = await sendSwap(chain, tx);
  assert.match(txid, /^[0-9a-f]{64}$/);
  const after = await holdings(chain, wallet.lock);
  assert.equal(after.pusd - before.pusd, q.pusd);
  const spent = before.sats - after.sats;
  assert.equal(spent, q.sats + tx.fee, "the wallet paid the price and the network fee, nothing more");
  const pool = await holdings(chain, poolLock(owner));
  assert.equal(pool.pusd, 1_000_000n - q.pusd);
  assert.equal(pool.sats, 500_000_000n + q.sats);
  const tokenCoin = (await chain.getUtxosForLockingBytecode(wallet.lock)).find((u) => u.token?.amount === 5n);
  assert.ok(tokenCoin, "the wallet's other token coin was not spent");
  console.log(`ok    20.00 PUSD for ${q.sats} sats (+${(q.priceMove * 100).toFixed(2)}%), network fee ${tx.fee} sats`);
}

// 2. Several pools: the trade spreads over them, in one transaction
{
  const { chain, owner, wallet } = setup([[1_000_000_000n, 2_000_000n], [1_000_000_000n, 2_000_000n], [1_000_000_000n, 2_000_000n]], [30_000_000n]);
  const pools = await poolsOnChain(chain, owner, PUSD);
  const q = quote(pools, PUSD, 30_000n);
  assert.ok(q.trade.entries.length >= 2, `used ${q.trade.entries.length} pool(s)`);
  const before = await holdings(chain, wallet.lock);
  await sendSwap(chain, await buildSwap(chain, wallet, q));
  assert.equal((await holdings(chain, wallet.lock)).pusd - before.pusd, q.pusd);
  console.log(`ok    300.00 PUSD from ${q.trade.entries.length} pools in one transaction (+${(q.priceMove * 100).toFixed(2)}%)`);
}

// 3. Refusals: more than 3% over the price, more than the pools hold, not enough BCH, no pools
{
  const { chain, owner, wallet } = setup([[10_000_000n, 20_000n]]); // a small pool: 200.00 PUSD
  const pools = await poolsOnChain(chain, owner, PUSD);
  const big = quote(pools, PUSD, 2_000n); // 10% of the pool
  assert.ok(big.priceMove > 0.03);
  await refused(buildSwap(chain, wallet, big), "price_move");
  await refused(() => quote(pools, PUSD, 20_000n), "too_big");
  await refused(() => quote([], PUSD, 100n), "no_pools");
  const poor = setup([[500_000_000n, 1_000_000n]], [50_000n]);
  const q = quote(await poolsOnChain(poor.chain, poor.owner, PUSD), PUSD, 2_000n);
  await refused(buildSwap(poor.chain, poor.wallet, q), "no_bch");
  console.log("ok    over 3%, more than the pools hold, not enough BCH, no pools");
}

// 4. Someone traded the pool first: ours is refused and nothing is spent; a fresh quote works
{
  const { chain, owner, wallet } = setup([[500_000_000n, 1_000_000n]]);
  const other = walletFromMnemonic(newMnemonic());
  chain.addUtxo(lockToAddress(other.lock, false), { txid: hex32(), vout: 0, satoshis: 20_000_000n });
  const pools = await poolsOnChain(chain, owner, PUSD);
  const mine = await buildSwap(chain, wallet, quote(pools, PUSD, 1_000n));
  await sendSwap(chain, await buildSwap(chain, other, quote(pools, PUSD, 1_000n))); // the other player is faster
  const before = await holdings(chain, wallet.lock);
  await assert.rejects(sendSwap(chain, mine));
  assert.deepEqual(await holdings(chain, wallet.lock), before, "nothing was spent");
  const fresh = quote(await poolsOnChain(chain, owner, PUSD), PUSD, 1_000n);
  await sendSwap(chain, await buildSwap(chain, wallet, fresh));
  assert.equal((await holdings(chain, wallet.lock)).pusd - before.pusd, fresh.pusd);
  console.log("ok    a pool traded first: refused, nothing spent, a fresh quote goes through");
}

// 5. Cauldron's pool list (mainnet): only well-formed rows of our token
{
  const owner = binToHex(randomBytes(20));
  const rows = [
    { owner_pkh: owner, owner_p2pkh_addr: "x", txid: hex32(), tx_pos: 1, sats: 1000000, tokens: 5000, token_id: PUSD },
    { owner_pkh: owner, owner_p2pkh_addr: "x", txid: hex32(), tx_pos: 0, sats: "2000000", tokens: "9000", token_id: "22".repeat(32) },
    { owner_pkh: "nothex", owner_p2pkh_addr: "x", txid: hex32(), tx_pos: 0, sats: 1, tokens: 1, token_id: PUSD },
  ];
  const pools = poolsFromIndexer(rows, PUSD);
  assert.equal(pools.length, 1);
  assert.equal(pools[0]!.output.amount, 1_000_000n);
  assert.equal(pools[0]!.outpoint.index, 1);
  console.log("ok    the mainnet pool list");
}

console.log("\nall swap tests passed");
