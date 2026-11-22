// Withdraw from the game wallet (src/lib/withdraw.ts) on CashScript's in-memory chain: real signed transactions,
// checked by the BCH VM. Nothing touches a network.   node scripts/test-withdraw.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { lockToAddress } from "../src/lib/chain.ts";
import { newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";
import { planWithdraw, readAmount, readDestination, sendWithdraw, WithdrawFailure } from "../src/lib/withdraw.ts";

const PUSD = "11".repeat(32);
const OTHER = "22".repeat(32);
const TROPHY = "33".repeat(32);
const hex32 = () => randomBytes(32).toString("hex");

function setup() {
  const chain = new MockNetworkProvider({ updateUtxoSet: true, validateTransactions: true });
  const wallet = walletFromMnemonic(newMnemonic());
  const address = lockToAddress(wallet.lock, false);
  const add = (satoshis: bigint, token?: { amount: bigint; category: string; nft?: { capability: "none"; commitment: string } }) =>
    chain.addUtxo(address, { txid: hex32(), vout: 0, satoshis, token });
  const friend = walletFromMnemonic(newMnemonic());
  return { chain, wallet, add, friend, to: friend.lock };
}

// What one transaction paid to a locking bytecode
async function paid(chain: MockNetworkProvider, txid: string, lock: Uint8Array) {
  const tx = decodeTransaction(hexToBin(await chain.getRawTransaction(txid)));
  assert.ok(typeof tx !== "string");
  const outs = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === binToHex(lock));
  const amountOf = (cat: string) =>
    outs.reduce((s, o) => s + (o.token && binToHex(o.token.category) === cat && !o.token.nft ? o.token.amount : 0n), 0n);
  return {
    sats: outs.reduce((s, o) => s + o.valueSatoshis, 0n),
    pusd: amountOf(PUSD),
    other: amountOf(OTHER),
    nfts: outs.filter((o) => o.token?.nft).length,
  };
}

async function refused(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof WithdrawFailure && e.code === code);
}

// 1. Reading what the player types
{
  const me = walletFromMnemonic(newMnemonic());
  const them = walletFromMnemonic(newMnemonic());
  const z = lockToAddress(them.lock, true);
  const q = lockToAddress(them.lock, false);
  for (const text of [z, q, q.replace("bchtest:", ""), `  ${z.toUpperCase()} `]) {
    const d = readDestination(text, "chipnet", me.pkhHex);
    assert.ok(d.ok, text);
    assert.equal(d.address, z, "always the token-aware form of the same wallet");
    assert.equal(binToHex(d.lock), binToHex(them.lock));
  }
  const err = (text: string, own = me.pkhHex) => {
    const d = readDestination(text, "chipnet", own);
    return d.ok ? "ok" : d.error;
  };
  assert.equal(err(""), "empty");
  assert.equal(err("hello"), "invalid");
  assert.equal(err(z.slice(0, -1) + (z.endsWith("q") ? "p" : "q")), "invalid", "a typo fails the checksum");
  assert.equal(err(z.replace("bchtest:", "bitcoincash:")), "invalid", "the checksum covers the prefix");
  assert.equal(readDestination(lockToAddress(them.lock, true), "mainnet", me.pkhHex).ok, false, "a chipnet address on mainnet");
  assert.equal(err(lockToAddress(me.lock, true)), "self");
  const p2sh = lockToAddress(Uint8Array.from([0xa9, 0x14, ...randomBytes(20), 0x87]), true);
  assert.equal(err(p2sh), "script");

  assert.equal(readAmount("12.5", 2), 1250n);
  assert.equal(readAmount("1,000", 2), 100000n);
  assert.equal(readAmount(".5", 2), 50n);
  assert.equal(readAmount("", 2), 0n);
  assert.equal(readAmount("0.00012345", 8), 12345n);
  for (const bad of ["1.234", "-1", "abc", "1e5", ".", "1.2.3"]) assert.equal(readAmount(bad, 2), null, bad);
  console.log("ok    addresses and amounts");
}

// 2. Everything: all PUSD, all BCH, the trophy. Other tokens stay home.
{
  const { chain, wallet, add, to } = setup();
  add(50_000n);
  add(30_000n);
  add(1_000n, { amount: 1_500n, category: PUSD });
  add(1_000n, { amount: 2_500n, category: PUSD });
  add(1_000n, { amount: 7n, category: OTHER });
  add(1_000n, { amount: 0n, category: TROPHY, nft: { capability: "none", commitment: "01" } });
  const plan = await planWithdraw(chain, wallet, PUSD, { to, pusd: 4_000n, sats: "all", nfts: true });
  const txid = await sendWithdraw(plan);
  const them = await paid(chain, txid, to);
  assert.deepEqual({ pusd: them.pusd, nfts: them.nfts, other: them.other }, { pusd: 4_000n, nfts: 1, other: 0n });
  assert.equal(them.sats, plan.sats);
  const home = await paid(chain, txid, wallet.lock);
  assert.equal(home.other, 7n, "the other token stays in the game wallet");
  assert.equal(home.pusd, 0n);
  assert.ok(home.sats <= 1_000n, "only the dust that carries the other token");
  assert.equal(84_000n - plan.sats - home.sats, plan.fee);
  assert.ok(plan.fee > 0n && plan.fee < 3_000n, `fee ${plan.fee}`);
  console.log(`ok    send everything (fee ${plan.fee} sats)`);
}

// 3. Some PUSD and some BCH: the rest comes back; the trophy stays when not ticked
{
  const { chain, wallet, add, to } = setup();
  add(100_000n);
  add(1_000n, { amount: 10_000n, category: PUSD });
  add(1_000n, { amount: 0n, category: TROPHY, nft: { capability: "none", commitment: "" } });
  const plan = await planWithdraw(chain, wallet, PUSD, { to, pusd: 2_550n, sats: 20_000n, nfts: false });
  const txid = await sendWithdraw(plan);
  const them = await paid(chain, txid, to);
  assert.deepEqual(them, { sats: 21_000n, pusd: 2_550n, other: 0n, nfts: 0 }); // 20,000 plus the 1,000 that carries the PUSD
  const home = await paid(chain, txid, wallet.lock);
  assert.equal(home.pusd, 7_450n);
  assert.equal(home.nfts, 1);
  const left = await chain.getUtxosForLockingBytecode(wallet.lock);
  assert.equal(left.reduce((n, u) => n + (u.token?.category === PUSD ? u.token.amount : 0n), 0n), 7_450n);
  console.log("ok    some PUSD and some BCH; the rest stays");
}

// 4. Only BCH, from a wallet with no PUSD
{
  const { chain, wallet, add, to } = setup();
  add(40_000n);
  const plan = await planWithdraw(chain, wallet, PUSD, { to, pusd: 0n, sats: "all", nfts: false });
  const them = await paid(chain, await sendWithdraw(plan), to);
  assert.equal(them.sats, 40_000n - plan.fee);
  console.log("ok    only BCH");
}

// 5. Refusals
{
  const { chain, wallet, add, to } = setup();
  add(5_000n);
  add(1_000n, { amount: 100n, category: PUSD });
  await refused(planWithdraw(chain, wallet, PUSD, { to, pusd: 0n, sats: 0n, nfts: false }), "nothing");
  await refused(planWithdraw(chain, wallet, PUSD, { to, pusd: 101n, sats: 0n, nfts: false }), "no_pusd");
  await refused(planWithdraw(chain, wallet, PUSD, { to, pusd: 0n, sats: 100n, nfts: false }), "too_small");
  await refused(planWithdraw(chain, wallet, PUSD, { to, pusd: 0n, sats: 6_000n, nfts: false }), "no_bch");
  const empty = setup();
  await refused(planWithdraw(empty.chain, empty.wallet, PUSD, { to, pusd: 0n, sats: "all", nfts: false }), "no_bch");
  // PUSD with too little BCH left for the fee: refused before anything is sent
  const tight = setup();
  tight.add(1_000n, { amount: 500n, category: PUSD });
  await refused(planWithdraw(tight.chain, tight.wallet, PUSD, { to, pusd: 500n, sats: "all", nfts: false }), "no_bch");
  console.log("ok    nothing to send, too much, too small, not enough for the fee");
}

// 6. An own wallet (WizardConnect): coins on two of its addresses, each input signed with its own address's key (the
//    wallet app does this); what is not sent goes back to its first address
{
  const { chain, wallet: first, friend } = setup();
  const second = walletFromMnemonic(newMnemonic()); // stands in for the wallet's next address
  const at = (w: typeof first, satoshis: bigint, token?: { amount: bigint; category: string }) => {
    const u = { txid: hex32(), vout: 0, satoshis, token };
    chain.addUtxo(lockToAddress(w.lock, false), u);
    return u;
  };
  at(first, 40_000n);
  const pusdCoin = at(second, 1_000n, { amount: 500n, category: PUSD });
  at(second, 30_000n);
  const firstCoins = await chain.getUtxos(lockToAddress(first.lock, false));
  const coins = [...firstCoins, ...(await chain.getUtxos(lockToAddress(second.lock, false)))];
  const onFirst = (u: { txid: string }) => firstCoins.some((c) => c.txid === u.txid);
  const own = {
    pkhHex: first.pkhHex, lock: first.lock, tokenAddress: lockToAddress(first.lock, true),
    unlockP2PKH: () => { throw new Error("an own wallet signs per coin"); },
    coins, unlockFor: (u: { txid: string }) => (onFirst(u) ? first.unlockP2PKH() : second.unlockP2PKH()), feeRate: 1.2,
  };
  const plan = await planWithdraw(chain, own, PUSD, { to: friend.lock, pusd: 300n, sats: 0n, nfts: false });
  assert.equal(plan.inputs.length, 3, "every coin of the wallet, on both addresses");
  assert.ok(plan.inputs.some((u) => u.txid === pusdCoin.txid));
  const txid = await sendWithdraw(plan);
  assert.equal((await paid(chain, txid, friend.lock)).pusd, 300n);
  const back = await paid(chain, txid, first.lock);
  assert.equal(back.pusd, 200n, "the rest of the PUSD goes back to the first address");
  assert.ok(back.sats > 60_000n, "and the BCH change");
  assert.equal((await paid(chain, txid, second.lock)).sats, 0n, "nothing is left on the other address");
  console.log("ok    an own wallet: coins on several addresses, change back to its first address");
}


console.log("\nall withdraw tests passed");
