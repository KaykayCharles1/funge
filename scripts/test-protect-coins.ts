import assert from "node:assert/strict";
import { hexToBin } from "@bitauth/libauth";
import { pickProtectCoins } from "../src/lib/protectCoins.ts";

const KING = "11".repeat(20);
const OTHER = "22".repeat(20);
const PUSD = "aa".repeat(32);
const lockOf = (pkh: string) => hexToBin(`76a914${pkh}88ac`);
let n = 0;
const coin = (at: string, sats: bigint, token?: { amount?: bigint; category?: string; nft?: boolean }) => ({
  id: `coin${n++}`,
  lock: lockOf(at),
  utxo: {
    txid: String(n).padStart(64, "0"), vout: 0, satoshis: sats, lockingBytecode: "",
    ...(token ? { token: { amount: token.amount ?? 0n, category: token.category ?? PUSD, ...(token.nft ? { nft: { capability: "none", commitment: "" } } : {}) } } : {}),
  },
}) as any;
const pick = (coins: any[], amount = 100n) => pickProtectCoins(coins, KING, PUSD, amount);
const ids = (r: any) => r.inputs.map((c: any) => c.id);
const ok = (name: string) => console.log(`ok    ${name}`);

{ // a PUSD coin at the king address does both jobs
  const k = coin(KING, 8000n, { amount: 5000n });
  const r: any = pick([coin(OTHER, 8000n, { amount: 9000n }), k]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [k.id]); ok("PUSD at the king address: one coin, first");
}
{ // PUSD elsewhere, a BCH coin at the king address proves it: the proof coin comes FIRST
  const proof = coin(KING, 7000n);
  const p = coin(OTHER, 1000n, { amount: 9000n });
  const r: any = pick([p, proof]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [proof.id, p.id]); ok("PUSD elsewhere: the king-address coin goes first");
}
{ // nothing at the king address
  const r: any = pick([coin(OTHER, 9000n, { amount: 9000n })]);
  assert.deepEqual([r.ok, r.code], [false, "no_king_coin"]); ok("no coin at the king address: no_king_coin");
}
{ // the only coin at the king address carries the trophy NFT: it must not be spent
  const r: any = pick([coin(KING, 5000n, { nft: true }), coin(OTHER, 9000n, { amount: 9000n })]);
  assert.deepEqual([r.ok, r.code], [false, "no_king_coin"]); ok("a coin with an NFT is never chosen as the proof");
}
{ // a coin with some other token is never chosen either
  const r: any = pick([coin(KING, 5000n, { amount: 50n, category: "bb".repeat(32) }), coin(OTHER, 9000n, { amount: 9000n })]);
  assert.deepEqual([r.ok, r.code], [false, "no_king_coin"]); ok("a coin with another token is never chosen");
}
{ // not enough PUSD anywhere: no_funds with the total
  const r: any = pick([coin(KING, 9000n), coin(OTHER, 1000n, { amount: 60n }), coin(OTHER, 1000n, { amount: 30n })]);
  assert.deepEqual([r.ok, r.code, r.have], [false, "no_funds", 90n]); ok("not enough PUSD: no_funds");
}
{ // low BCH on the chosen coins: a plain BCH coin is added for the fee
  const k = coin(KING, 1000n, { amount: 500n });
  const extra = coin(OTHER, 20000n);
  const r: any = pick([k, extra, coin(OTHER, 3000n)]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [k.id, extra.id]); ok("low BCH: the biggest plain BCH coin is added after");
}
{ // low BCH and no spare coin
  const r: any = pick([coin(KING, 1000n, { amount: 500n })]);
  assert.deepEqual([r.ok, r.code], [false, "needs_bch"]); ok("low BCH and nothing to add: needs_bch");
}
{ // a small PUSD coin at the king address is a fine proof; the big PUSD coin is elsewhere
  const small = coin(KING, 7000n, { amount: 10n });
  const big = coin(OTHER, 1000n, { amount: 9000n });
  const r: any = pick([big, small]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [small.id, big.id]); ok("a small PUSD coin at the king address can be the proof");
}
{ // the biggest suitable coin is picked
  const a = coin(KING, 8000n, { amount: 200n });
  const b = coin(KING, 8000n, { amount: 900n });
  const r: any = pick([a, b]);
  assert.deepEqual(ids(r), [b.id]); ok("the largest suitable PUSD coin is used");
}
// ---- PUSD split across several small coins (refunds, change): combined, largest first ----
{ // protect: no single coin covers it, two coins at the king address do; one of them is also the proof
  const a = coin(KING, 1000n, { amount: 60n });
  const b = coin(KING, 1000n, { amount: 50n });
  const fee = coin(OTHER, 20000n);
  const r: any = pick([b, a, fee]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [a.id, b.id, fee.id]); ok("protect: split PUSD at the king address is combined, proof first");
}
{ // protect: PUSD split elsewhere, a BCH coin at the king address is the proof and comes first
  const proof = coin(KING, 9000n);
  const a = coin(OTHER, 1000n, { amount: 70n });
  const b = coin(OTHER, 1000n, { amount: 40n });
  const r: any = pick([a, b, proof]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [proof.id, a.id, b.id]); ok("protect: split PUSD elsewhere, the king-address coin goes first");
}
{ // protect: only the coins that are needed are used, the largest first
  const big = coin(KING, 9000n, { amount: 80n });
  const mid = coin(KING, 1000n, { amount: 30n });
  const small = coin(KING, 1000n, { amount: 5n });
  const r: any = pick([small, mid, big]);
  assert.ok(r.ok); assert.deepEqual(ids(r), [big.id, mid.id]); ok("protect: only as many coins as needed, largest first");
}
{ // protect: more small coins than one move may carry: no_funds, with the real total
  const many = Array.from({ length: 12 }, () => coin(KING, 1000n, { amount: 10n })); // 12 x 10 = 120, but at most 8 PUSD coins
  const r: any = pick([...many, coin(OTHER, 20000n)]);
  assert.deepEqual([r.ok, r.code, r.have], [false, "no_funds", 120n]); ok("protect: too many tiny coins for one move: no_funds");
}

{ // game wallet (open, conquer, protect): the same rule through pickWalletCoins
  const { pickWalletCoins } = await import("../src/referee/kingdomActions.ts");
  const u = (sats: bigint, amount?: bigint) => coin(KING, sats, amount === undefined ? undefined : { amount }).utxo;
  { // one coin covers it: exactly as before
    const a = u(8000n, 3000n);
    const r: any = pickWalletCoins([u(8000n, 1000n), a], PUSD, 2040n);
    assert.ok(r.ok); assert.deepEqual(r.inputs, [a]); ok("wallet: one coin covers it, one coin used");
  }
  { // the case from the chipnet test: plenty of PUSD in total, no single coin covers 20.40
    const coins = [u(1000n, 920n), u(1000n, 920n), u(1000n, 920n), u(1000n, 500n), u(20000n)];
    const r: any = pickWalletCoins(coins, PUSD, 2040n);
    assert.ok(r.ok);
    assert.equal(r.inputs.filter((c: any) => c.token).reduce((s: bigint, c: any) => s + c.token.amount, 0n), 2760n);
    assert.equal(r.inputs.length, 4); // three refunds of 9.20 cover 20.40, then a BCH coin for the fee
    assert.equal(r.inputs[3].token, undefined);
    ok("wallet: split refunds are combined (3 x 9.20 for 20.40), plus a BCH coin for the fee");
  }
  { // enough BCH on the PUSD coins themselves: no extra BCH coin
    const r: any = pickWalletCoins([u(9000n, 1500n), u(9000n, 1500n), u(50000n)], PUSD, 2040n);
    assert.ok(r.ok); assert.equal(r.inputs.length, 2); ok("wallet: no fee coin when the PUSD coins carry enough BCH");
  }
  { // not enough PUSD in total: no_funds with the total, so the page says how much is missing
    const r: any = pickWalletCoins([u(1000n, 900n), u(1000n, 900n), u(20000n)], PUSD, 2040n);
    assert.deepEqual([r.ok, r.code, r.have], [false, "no_funds", 1800n]); ok("wallet: not enough PUSD in total: no_funds");
  }
  { // never more wallet inputs than the referee accepts
    const coins = [...Array.from({ length: 30 }, () => u(1000n, 100n)), u(90000n)];
    const r: any = pickWalletCoins(coins, PUSD, 800n);
    assert.ok(r.ok); assert.ok(r.inputs.length <= 10); ok("wallet: never more than 10 wallet inputs");
    const tooMany: any = pickWalletCoins(coins, PUSD, 2000n); // would need 20 coins
    assert.deepEqual([tooMany.ok, tooMany.code], [false, "no_funds"]); ok("wallet: more coins than one move may carry: no_funds");
  }
}
console.log("All protect coin tests passed.");