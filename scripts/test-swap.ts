// Swap BCH for PUSD against Cauldron pool contracts (src/lib/swap.ts) on CashScript's in-memory chain: the real
// Cauldron contract from CashLab, real signatures, every transaction checked by the BCH VM.   node scripts/test-swap.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { binToHex, encodeTransaction, hash160 } from "@bitauth/libauth";
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import type { SpendableUtxo } from "cashscript";
import { lockToAddress, p2pkhLock } from "../src/lib/chain.ts";
import { newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";
import {
  buildSwap, poolAddress, poolLock, poolsFromIndexer, poolsOnChain, poolWithdrawUnlocker, quote, sendSwap, SWAP_RESERVE, SwapFailure,
  MAX_PRICE_MOVE, type SwapWallet,
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

// 3. Refusals: past the price limit (MAX_PRICE_MOVE), more than the pools hold, not enough BCH, no pools
{
  const { chain, owner, wallet } = setup([[10_000_000n, 20_000n]]); // a small pool: 200.00 PUSD
  const pools = await poolsOnChain(chain, owner, PUSD);
  const big = quote(pools, PUSD, 9_000n); // 45% of the pool: far past the limit on either network
  assert.ok(big.priceMove > MAX_PRICE_MOVE);
  await refused(buildSwap(chain, wallet, big), "price_move");
  await refused(() => quote(pools, PUSD, 20_000n), "too_big");
  await refused(() => quote([], PUSD, 100n), "no_pools");
  const poor = setup([[500_000_000n, 1_000_000n]], [50_000n]);
  const q = quote(await poolsOnChain(poor.chain, poor.owner, PUSD), PUSD, 2_000n);
  await refused(buildSwap(poor.chain, poor.wallet, q), "no_bch");
  console.log("ok    over the price limit, more than the pools hold, not enough BCH, no pools");
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

// 5. "Sell this much BCH", and Max (all the plain BCH less the reserve)
{
  const { chain, owner, wallet } = setup([[500_000_000n, 1_000_000n]], [3_000_000n, 2_000_000n]);
  const pools = await poolsOnChain(chain, owner, PUSD);
  const q = quote(pools, PUSD, 1_000_000n, "sell");
  assert.ok(q.sats <= 1_000_000n && q.pusd > 1_900n && q.pusd < 2_000n, `${q.sats} sats -> ${q.pusd}`);
  assert.ok(q.poolFee > 2_000n && q.poolFee < 4_000n, `pool fee ${q.poolFee}`); // 0.3% of the BCH
  const before = await holdings(chain, wallet.lock);
  await sendSwap(chain, await buildSwap(chain, wallet, q));
  assert.equal((await holdings(chain, wallet.lock)).pusd - before.pusd, q.pusd);
  await refused(() => quote(pools, PUSD, 1n, "sell"), "too_small");

  const plain = (await chain.getUtxosForLockingBytecode(wallet.lock)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
  const max = quote(await poolsOnChain(chain, owner, PUSD), PUSD, plain - SWAP_RESERVE, "sell");
  const tx = await buildSwap(chain, wallet, max);
  await sendSwap(chain, tx);
  const left = (await chain.getUtxosForLockingBytecode(wallet.lock)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
  assert.ok(left < SWAP_RESERVE, `Max leaves only crumbs of plain BCH: ${left}`);
  console.log(`ok    sell an amount of BCH; Max spends all but ${left} sats (network fee ${tx.fee})`);
}

// 6. The other way: sell PUSD for BCH (by the PUSD given, and by the BCH wanted), even with no plain BCH at all
{
  const { chain, owner, wallet } = setup([[500_000_000n, 1_000_000n]], []);
  chain.addUtxo(lockToAddress(wallet.lock, true), { txid: hex32(), vout: 0, satoshis: 1_000n, token: { amount: 3_000n, category: PUSD } });
  const pools = await poolsOnChain(chain, owner, PUSD);
  const q = quote(pools, PUSD, 2_000n, "sell", "toBch"); // sell 20.00 PUSD
  assert.equal(q.pusd, 2_000n);
  assert.ok(q.sats > 990_000n && q.sats < 1_000_000n, `got ${q.sats} sats`); // 2000 x 500 less the 0.3% fee
  assert.ok(q.priceMove > 0 && q.priceMove < 0.01, `move ${q.priceMove}`);
  const before = await holdings(chain, wallet.lock);
  const tx = await buildSwap(chain, wallet, q);
  await sendSwap(chain, tx);
  const after = await holdings(chain, wallet.lock);
  assert.equal(before.pusd - after.pusd, 2_000n);
  assert.equal(after.sats - before.sats, q.sats - tx.fee, "the wallet got the BCH, less the network fee");
  const pool = await holdings(chain, poolLock(owner));
  assert.deepEqual(pool, { sats: 500_000_000n - q.sats, pusd: 1_000_000n + 2_000n });

  const want = quote(await poolsOnChain(chain, owner, PUSD), PUSD, 100_000n, "buy", "toBch"); // get 0.001 BCH
  assert.ok(want.sats >= 100_000n && want.sats < 101_000n, `got ${want.sats}`); // at least what was asked
  assert.ok(want.pusd > 200n && want.pusd < 205n, `costs ${want.pusd}`);
  await sendSwap(chain, await buildSwap(chain, wallet, want));
  await refused(buildSwap(chain, wallet, quote(await poolsOnChain(chain, owner, PUSD), PUSD, 5_000n, "sell", "toBch")), "no_pusd");
  await refused(() => quote(pools, PUSD, 500n, "buy", "toBch"), "too_small");
  console.log(`ok    sell 20.00 PUSD for ${q.sats} sats (network fee ${tx.fee}), with no plain BCH in the wallet`);
}

// 7. The owner takes a pool back (reset-chipnet-pool.ts); anyone else's signature is refused
{
  const chain = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
  const owner = new SignatureTemplate(randomBytes(32));
  const ownerPkh = hash160(owner.publicKey);
  chain.addUtxo(poolAddress(ownerPkh, "chipnet"), { txid: hex32(), vout: 0, satoshis: 1_500_000n, token: { amount: 750_000n, category: PUSD } });
  const [coin] = await chain.getUtxosForLockingBytecode(poolLock(ownerPkh));
  const home = p2pkhLock(ownerPkh);
  const stranger = new SignatureTemplate(randomBytes(32));
  await assert.rejects(
    new TransactionBuilder({ provider: chain }).addInput(coin!, poolWithdrawUnlocker(stranger))
      .addOutput({ to: home, amount: 1_000n, token: { amount: 750_000n, category: PUSD } })
      .addBchChangeOutputIfNeeded({ to: home, feeRate: 1 }).send(),
  );
  await new TransactionBuilder({ provider: chain }).addInput(coin!, poolWithdrawUnlocker(owner))
    .addOutput({ to: home, amount: 1_000n, token: { amount: 750_000n, category: PUSD } })
    .addBchChangeOutputIfNeeded({ to: home, feeRate: 1 }).send();
  assert.equal((await chain.getUtxosForLockingBytecode(poolLock(ownerPkh))).length, 0, "the pool is empty");
  const back = await holdings(chain, home);
  assert.equal(back.pusd, 750_000n);
  assert.ok(back.sats > 1_498_000n, `BCH back: ${back.sats}`);
  console.log("ok    the owner takes a pool back; a stranger cannot");
}

// 8. Cauldron's pool list (mainnet): only well-formed rows of our token
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

// 9. An own wallet (WizardConnect): coins on two of its addresses, each a placeholder that the wallet app signs later
{
  const { chain, owner } = setup([[500_000_000n, 1_000_000n]], []);
  const a = walletFromMnemonic(newMnemonic()), b = walletFromMnemonic(newMnemonic()); // two addresses of one own wallet
  chain.addUtxo(lockToAddress(a.lock, false), { txid: hex32(), vout: 0, satoshis: 600_000n });
  chain.addUtxo(lockToAddress(b.lock, false), { txid: hex32(), vout: 0, satoshis: 900_000n }); // neither pays 1.0M alone
  const key = (u: SpendableUtxo) => `${u.txid}:${u.vout}`;
  const where = new Map<string, string>();
  const coins: SpendableUtxo[] = [];
  for (const w of [a, b]) {
    for (const u of await chain.getUtxosForLockingBytecode(w.lock)) {
      coins.push(u);
      where.set(key(u), lockToAddress(w.lock, false));
    }
  }
  const own: SwapWallet = {
    lock: a.lock, tokenAddress: a.tokenAddress, unlockP2PKH: () => { throw new Error("the wallet signs"); },
    coins, unlockFor: (u) => placeholderP2PKHUnlocker(where.get(key(u))!), feeRate: 1.2,
  };
  const q = quote(await poolsOnChain(chain, owner, PUSD), PUSD, 2_000n);
  const tx = await buildSwap(chain, own, q);
  assert.equal(tx.firstWalletInput, 1, "the wallet's inputs come after the one pool input");
  assert.equal(tx.walletInputs.length, 2, "coins from both addresses");
  const wc = tx.builder.generateWcTransactionObject({ broadcast: false, userPrompt: "test" });
  assert.ok(wc.transaction.inputs[0]!.unlockingBytecode.length > 0, "the pool input carries its own script");
  for (const i of [1, 2]) assert.equal(wc.transaction.inputs[i]!.unlockingBytecode.length, 0, `input ${i} waits for the wallet`);
  const bought = wc.transaction.outputs.find((o) => o.token?.amount === q.pusd);
  assert.ok(bought && binToHex(bought.lockingBytecode) === binToHex(a.lock), "the PUSD goes to the wallet's first address");
  const signedSize = encodeTransaction(wc.transaction).length + 2 * 108; // a P2PKH signature and key are at most 108 bytes
  assert.ok(Number(tx.fee) >= signedSize, `fee ${tx.fee} covers 1 sat a byte once signed (${signedSize} bytes)`);
  console.log("ok    an own wallet: coins on two addresses, the wallet signs only its own inputs");
}

// 10. A tiny pool priced off the market does not make a small trade look expensive (the price is size-weighted)
{
  // a deep pool at 500 sats per unit, and a 3.00 PUSD pool at 520: a seller would get 4% "worse" than that pool
  const { chain, owner } = setup([[5_000_000_000n, 10_000_000n], [156_000n, 300n]], []);
  const pools = await poolsOnChain(chain, owner, PUSD);
  const sell = quote(pools, PUSD, 100n, "sell", "toBch"); // sell 1.00 PUSD
  assert.ok(sell.priceMove < 0.01, `selling 1.00 PUSD: ${(sell.priceMove * 100).toFixed(2)}%`);
  const buy = quote(pools, PUSD, 500n); // buy 5.00 PUSD
  assert.ok(buy.priceMove > 0 && buy.priceMove < 0.01, `buying 5.00 PUSD: ${(buy.priceMove * 100).toFixed(2)}%`);
  console.log(`ok    a tiny pool off the market: selling 1.00 PUSD ${(sell.priceMove * 100).toFixed(2)}%, buying 5.00 ${(buy.priceMove * 100).toFixed(2)}%`);
}

console.log("\nall swap tests passed");
