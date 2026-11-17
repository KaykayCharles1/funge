// The chipnet faucet (server/faucet.ts) on CashScript's in-memory chain: real signed transactions, checked by the
// BCH VM. Nothing touches a network.   node scripts/test-faucet.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { lockToAddress } from "../src/lib/chain.ts";
import { newMnemonic, walletFromMnemonic } from "../src/wallet/local.ts";
import { FaucetError, makeFaucet } from "../server/faucet.ts";
import { makeLocks } from "../server/lock.ts";
import { buildApp, type AppDeps } from "../server/app.ts";

const PUSD = "11".repeat(32);
const OTHER = "22".repeat(32);
const hex32 = () => randomBytes(32).toString("hex");
const pkh = () => randomBytes(20).toString("hex");
const LIMITS = { pusdUnits: 2_000n, sats: 20_000n, dayBlocks: 144, perIpPerDay: 3, perDay: 5 };

// The mock chain, plus the faucet address's history (what Electrum's get_history returns)
class Chain extends MockNetworkProvider {
  history: { txid: string; height: number }[] = [];
  constructor() {
    super({ updateUtxoSet: true, validateTransactions: true });
  }
  override async sendRawTransaction(txHex: string) {
    const txid = await super.sendRawTransaction(txHex);
    this.history.push({ txid, height: 0 });
    return txid;
  }
}

function setup(opts: { sats?: bigint[]; pusd?: bigint[] } = {}) {
  const chain = new Chain();
  chain.setBlockHeight(1000);
  const wallet = walletFromMnemonic(newMnemonic());
  const address = lockToAddress(wallet.lock, false);
  for (const s of opts.sats ?? [300_000n]) chain.addUtxo(address, { txid: hex32(), vout: 0, satoshis: s });
  for (const p of opts.pusd ?? [100_000n]) {
    chain.addUtxo(address, { txid: hex32(), vout: 0, satoshis: 1_000n, token: { amount: p, category: PUSD } });
  }
  let now = 1_800_000_000_000;
  const faucet = makeFaucet({
    provider: chain,
    history: async () => chain.history,
    wallet,
    pusdCategory: PUSD,
    addressOf: lockToAddress,
    locks: makeLocks(),
    now: () => now,
    limits: LIMITS,
  });
  return { chain, wallet, faucet, advance: (ms: number) => (now += ms) };
}

// What one transaction paid to a key hash: sats and PUSD
async function paidTo(chain: Chain, txid: string, toPkh: string) {
  const tx = decodeTransaction(hexToBin(await chain.getRawTransaction(txid)));
  assert.ok(typeof tx !== "string");
  const want = `76a914${toPkh}88ac`;
  const outs = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === want);
  return {
    sats: outs.reduce((s, o) => s + o.valueSatoshis, 0n),
    pusd: outs.reduce((s, o) => s + (o.token && binToHex(o.token.category) === PUSD ? o.token.amount : 0n), 0n),
  };
}

async function refused(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof FaucetError && e.code === code);
}

// 1. A claim pays 20.00 PUSD and 20,000 sats, and the faucet keeps the rest
{
  const { chain, faucet } = setup();
  const alice = pkh();
  const before = await faucet.status();
  assert.equal(before.pusd, "100000");
  assert.equal(before.claimsToday, 0);
  const r = await faucet.claim(alice, "1.1.1.1");
  assert.deepEqual(await paidTo(chain, r.txid, alice), { sats: 20_000n, pusd: 2_000n });
  assert.ok(r.address.startsWith("bchtest:z"), "the reply names the player's token-aware address");
  const after = await faucet.status();
  assert.equal(after.pusd, "98000");
  assert.equal(after.claimsToday, 1);
  assert.ok(BigInt(after.sats) < BigInt(before.sats) - 20_000n, "sats went down by the payout and the fee");
  console.log("ok    a claim pays 20.00 PUSD and 20,000 sats");

  // 2. The same wallet cannot claim again the same day, even from another connection
  await refused(faucet.claim(alice, "2.2.2.2"), "already_claimed");
  console.log("ok    once per wallet per day");

  // 3. Several claims in a row each spend fresh coins (no double spend while the change is unconfirmed)
  for (let i = 0; i < 3; i++) await faucet.claim(pkh(), `3.3.3.${i}`);
  assert.equal((await faucet.status()).claimsToday, 4);
  console.log("ok    claims in a row");
}

// 4. A connection gets at most 3 claims a day
{
  const { faucet } = setup();
  for (let i = 0; i < 3; i++) await faucet.claim(pkh(), "9.9.9.9");
  await refused(faucet.claim(pkh(), "9.9.9.9"), "ip_limit");
  console.log("ok    three claims per connection per day");
}

// 5. The daily total
{
  const { faucet } = setup();
  for (let i = 0; i < LIMITS.perDay; i++) await faucet.claim(pkh(), `5.5.5.${i}`);
  await refused(faucet.claim(pkh(), "5.5.6.1"), "daily_limit");
  assert.equal((await faucet.status()).claimsLeft, 0);
  console.log("ok    the daily total");
}

// 6. The limits come from the chain: a fresh faucet (a restarted referee) still refuses the same wallet,
//    and once the payout is more than a day of blocks old the wallet can claim again
{
  const { chain, wallet, faucet, advance } = setup();
  const alice = pkh();
  await faucet.claim(alice, "6.6.6.6");
  const restarted = makeFaucet({
    provider: chain, history: async () => chain.history, wallet, pusdCategory: PUSD,
    addressOf: lockToAddress, locks: makeLocks(), now: () => 1_800_000_000_000, limits: LIMITS,
  });
  await refused(restarted.claim(alice, "6.6.6.7"), "already_claimed");
  for (const h of chain.history) h.height = 1001; // mined
  chain.setBlockHeight(1001 + LIMITS.dayBlocks); // a day of blocks later
  advance(25 * 60 * 60 * 1000);
  const again = await faucet.claim(alice, "6.6.6.8");
  assert.deepEqual(await paidTo(chain, again.txid, alice), { sats: 20_000n, pusd: 2_000n });
  console.log("ok    the limits survive a restart and reset after a day of blocks");
}

// 7. A top-up (coins sent TO the faucet by someone else) is not counted as a payout
{
  const { chain, wallet, faucet } = setup();
  const donor = walletFromMnemonic(newMnemonic());
  const donorAddress = lockToAddress(donor.lock, false);
  chain.addUtxo(donorAddress, { txid: hex32(), vout: 0, satoshis: 50_000n, token: { amount: 5_000n, category: PUSD } });
  chain.addUtxo(donorAddress, { txid: hex32(), vout: 0, satoshis: 50_000n });
  const { TransactionBuilder } = await import("cashscript");
  const utxos = await chain.getUtxos(donorAddress);
  await new TransactionBuilder({ provider: chain })
    .addInputs(utxos, donor.unlockP2PKH())
    .addOutput({ to: wallet.lock, amount: 1_000n, token: { amount: 3_000n, category: PUSD } })
    .addTokenChangeOutputIfNeeded({ category: PUSD, to: lockToAddress(donor.lock, true) }) // PUSD back to the donor
    .addBchChangeOutputIfNeeded({ to: donor.lock, feeRate: 1.2 })
    .send();
  const s = await faucet.status();
  assert.equal(s.claimsToday, 0);
  assert.equal(s.pusd, "103000");
  console.log("ok    a top-up is not a payout");
}

// 8. Empty, other tokens, bad input
{
  const noPusd = setup({ pusd: [] });
  await refused(noPusd.faucet.claim(pkh(), "8.8.8.8"), "empty");
  const noSats = setup({ sats: [10_000n] });
  await refused(noSats.faucet.claim(pkh(), "8.8.8.8"), "empty");
  const { chain, faucet, wallet } = setup({ pusd: [1_000n, 1_500n] }); // 25.00 in two coins: both are used
  chain.addUtxo(lockToAddress(wallet.lock, false), { txid: hex32(), vout: 0, satoshis: 1_000n, token: { amount: 9_999n, category: OTHER } });
  const bob = pkh();
  const r = await faucet.claim(bob, "8.8.8.9");
  assert.deepEqual(await paidTo(chain, r.txid, bob), { sats: 20_000n, pusd: 2_000n });
  assert.equal((await faucet.status()).pusd, "500");
  await refused(faucet.claim("xyz", "8.8.8.8"), "invalid");
  await refused(faucet.claim(wallet.pkhHex, "8.8.8.8"), "invalid");
  console.log("ok    empty faucet, PUSD in several coins, other tokens untouched, bad input");
}

// 9. The routes: off without a seed; the status page and JSON; a claim; a refusal with its code
{
  const appWith = (faucet: AppDeps["faucet"]) =>
    buildApp({
      games: [], manager: { onEvent: () => () => {} } as unknown as AppDeps["manager"], chain: {} as AppDeps["chain"],
      clock: { now: () => 0 } as AppDeps["clock"], allowedOrigins: ["http://localhost:5173"], referee: {} as AppDeps["referee"],
      locks: makeLocks(), unconfirmed: {} as AppDeps["unconfirmed"], sleep: async () => {}, faucet,
    });
  const off = await appWith(null);
  assert.equal((await off.inject({ method: "GET", url: "/faucet" })).statusCode, 404);
  assert.equal((await off.inject({ method: "POST", url: "/faucet/claim", payload: { pkh: pkh() } })).json().error, "faucet_off");
  await off.close();

  const { faucet, chain } = setup();
  const app = await appWith(faucet);
  const page = await app.inject({ method: "GET", url: "/faucet", headers: { accept: "text/html" } });
  assert.match(String(page.headers["content-type"]), /text\/html/);
  assert.match(page.body, /bchtest:z/);
  assert.match(page.body, /1,000\.00/); // the PUSD balance
  const json = (await app.inject({ method: "GET", url: "/faucet" })).json();
  assert.equal(json.perClaim.pusd, "2000");
  const carol = pkh();
  const ok = (await app.inject({ method: "POST", url: "/faucet/claim", payload: { pkh: carol } })).json();
  assert.equal(ok.ok, true);
  assert.deepEqual(await paidTo(chain, ok.txid, carol), { sats: 20_000n, pusd: 2_000n });
  const again = await app.inject({ method: "POST", url: "/faucet/claim", payload: { pkh: carol } });
  assert.equal(again.statusCode, 429);
  assert.equal(again.json().error, "already_claimed");
  await app.close();
  console.log("ok    the routes");
}

console.log("\nall faucet tests passed");
