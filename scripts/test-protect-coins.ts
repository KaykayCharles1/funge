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
console.log("All protect coin tests passed.");