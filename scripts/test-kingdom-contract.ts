import assert from "node:assert/strict";
import { Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from "cashscript";
import { binToHex, hexToBin } from "@bitauth/libauth";
import {
  NO_PREVIOUS, WAITING_STATE, conquestMoney, decodeKingdomCommitment, encodeKingdomCommitment, previousOf, protectAmounts,
} from "../src/lib/kingdom.ts";
import type { KingdomState } from "../src/lib/kingdom.ts";
import { loadArtifact, p2pkhLock, pkhOf, toVmCategory } from "./helpers.ts";

const seq = (start: number) => binToHex(Uint8Array.from({ length: 32 }, (_, i) => start + i));
const PUSD_ID = seq(1);
const GAME_ID = seq(33);
const OTHER_ID = seq(70);
const P = { openingPrice: 1000n, feePercent: 2n, cutPercent: 10n, cap: 5000n, protectsPerReign: 2n, unit: 100n, fallbackBlocks: 12 };
const FEE = 2_000n;
const DUST = 1_000n;

const keyBytes = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => ((n + i) % 255) + 1);
const referee = new SignatureTemplate(keyBytes(200));
const impostor = new SignatureTemplate(keyBytes(120));
type RefereeArg = "valid" | "wrong" | "missing";
const refereeArg = (kind: RefereeArg) => (kind === "valid" ? referee : kind === "wrong" ? impostor : new Uint8Array(0));

function person(n: number) {
  const tpl = new SignatureTemplate(keyBytes(n));
  const pkh = pkhOf(tpl.publicKey);
  const lock = p2pkhLock(pkh);
  return { tpl, pkh, pkhHex: binToHex(pkh), lock, lockHex: binToHex(lock) };
}
type Person = ReturnType<typeof person>;
const alice = person(1);
const bob = person(40);
const carol = person(90);

const kingState = (holder: Person, over: Partial<KingdomState> = {}): KingdomState => ({
  passCount: 1, holderPkh: holder.pkhHex, value: P.openingPrice, protects: 0, previous: NO_PREVIOUS, ...over,
});

function setup(state: KingdomState = WAITING_STATE, potAmount = 0n) {
  const provider = new MockNetworkProvider();
  const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(GAME_ID)], { provider });
  const kingdom = new Contract(
    loadArtifact("FungeKingdom"),
    [
      hexToBin(pot.lockingBytecode), toVmCategory(PUSD_ID), referee.publicKey,
      P.openingPrice, P.feePercent, P.cutPercent, P.cap, BigInt(P.protectsPerReign), P.unit, BigInt(P.fallbackBlocks),
    ],
    { provider },
  );
  const stateUtxo = provider.addUtxo(kingdom.lockingBytecode, randomUtxo({
    satoshis: 10_000n,
    token: { amount: 0n, category: GAME_ID, nft: { capability: "mutable" as const, commitment: encodeKingdomCommitment(state) } },
  }));
  // A waiting game has a BCH-only pot coin; an open game has a PUSD pot coin
  const potUtxo = provider.addUtxo(pot.lockingBytecode, randomUtxo(
    potAmount > 0n ? { satoshis: 10_000n, token: { amount: potAmount, category: PUSD_ID } } : { satoshis: 10_000n },
  ));
  return { provider, pot, kingdom, stateUtxo, potUtxo, state, potAmount };
}
type Game = ReturnType<typeof setup>;

async function refresh(g: Game): Promise<Game> {
  const [stateUtxo] = await g.kingdom.getUtxos();
  const [potUtxo] = await g.pot.getUtxos();
  return { ...g, stateUtxo, potUtxo, state: decodeKingdomCommitment(stateUtxo.token!.nft!.commitment), potAmount: potUtxo.token?.amount ?? 0n };
}

function fund(g: Game, who: Person, o: { pusd?: bigint; other?: bigint; nft?: "mutable" } = {}) {
  const token =
    o.pusd !== undefined
      ? { amount: o.pusd, category: PUSD_ID, ...(o.nft ? { nft: { capability: o.nft, commitment: "" } } : {}) }
      : o.other !== undefined
        ? { amount: o.other, category: OTHER_ID }
        : undefined;
  return g.provider.addUtxo(who.lockHex, randomUtxo({ satoshis: 100_000n, ...(token ? { token } : {}) }));
}

const stateOutput = (g: Game, commitment: string, sats?: bigint) => ({
  to: g.kingdom.tokenAddress,
  amount: sats ?? g.stateUtxo.satoshis,
  token: { amount: 0n, category: GAME_ID, nft: { capability: "mutable" as const, commitment } },
});

// ---------- open ----------
function openTx(g: Game, who: Person, t: {
  pay?: bigint; commitment?: string; referee?: RefereeArg; stateSats?: bigint; potSats?: bigint; potTo?: Person;
} = {}) {
  const pay = t.pay ?? P.openingPrice;
  const coin = fund(g, who, { pusd: 5_000n });
  const potSats = t.potSats ?? g.potUtxo.satoshis;
  const stateSats = t.stateSats ?? g.stateUtxo.satoshis;
  const tokenChange = 5_000n - pay;
  const change = g.stateUtxo.satoshis + g.potUtxo.satoshis + coin.satoshis - stateSats - potSats - (tokenChange > 0n ? DUST : 0n) - FEE;
  const next = kingState(who);
  const b = new TransactionBuilder({ provider: g.provider })
    .addInput(g.stateUtxo, g.kingdom.unlock.open(who.pkh, refereeArg(t.referee ?? "valid")))
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addInput(coin, who.tpl.unlockP2PKH())
    .addOutput(stateOutput(g, t.commitment ?? encodeKingdomCommitment(next), stateSats))
    .addOutput({ to: t.potTo ? t.potTo.lock : g.pot.tokenAddress, amount: potSats, token: { amount: g.potAmount + pay, category: PUSD_ID } });
    if (tokenChange > 0n) b.addOutput({ to: who.lock, amount: DUST, token: { amount: tokenChange, category: PUSD_ID } });
  return b.addOutput({ to: who.lock, amount: change });
}

// ---------- conquer ----------
function conquerTx(g: Game, who: Person, t: {
  value?: bigint; king?: bigint; pool?: bigint; payoutTo?: Person; payoutOther?: boolean; payoutNft?: boolean; payoutSats?: bigint;
  newHolder?: Person; commitment?: string; referee?: RefereeArg; stateSats?: bigint; potSats?: bigint; potTo?: Person;
} = {}) {
  const old = g.state;
  const money = conquestMoney(t.value ?? old.value, P);
  const kingAmt = t.king ?? money.kingGets;
  const poolAmt = t.pool ?? money.poolGets;
  const holder = t.newHolder ?? who;
  const oldLock = p2pkhLock(hexToBin(old.holderPkh));
  const stateSats = t.stateSats ?? g.stateUtxo.satoshis;
  const potSats = t.potSats ?? g.potUtxo.satoshis;
  const payoutSats = t.payoutSats ?? DUST;
  const coin = fund(g, who, { pusd: 5_000n, ...(t.payoutNft ? { nft: "mutable" as const } : {}) });
  const other = t.payoutOther ? fund(g, who, { other: kingAmt }) : undefined;
  const pusdChange = 5_000n - poolAmt - (t.payoutOther ? 0n : kingAmt);
  const next: KingdomState = { passCount: old.passCount + 1, holderPkh: holder.pkhHex, value: old.value, protects: 0, previous: previousOf(old.holderPkh) };
  const inSats = g.stateUtxo.satoshis + g.potUtxo.satoshis + coin.satoshis + (other?.satoshis ?? 0n);
  const outSats = stateSats + potSats + payoutSats + (pusdChange > 0n ? DUST : 0n);
  const b = new TransactionBuilder({ provider: g.provider })
    .addInput(g.stateUtxo, g.kingdom.unlock.conquer(holder.pkh, refereeArg(t.referee ?? "valid")))
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addInput(coin, who.tpl.unlockP2PKH());
  if (other) b.addInput(other, who.tpl.unlockP2PKH());
  b.addOutput(stateOutput(g, t.commitment ?? encodeKingdomCommitment(next), stateSats))
    .addOutput({ to: t.potTo ? t.potTo.lock : g.pot.tokenAddress, amount: potSats, token: { amount: g.potAmount + poolAmt, category: PUSD_ID } })
    .addOutput({
      to: t.payoutTo ? t.payoutTo.lock : oldLock,
      amount: payoutSats,
      token: {
        amount: kingAmt,
        category: t.payoutOther ? OTHER_ID : PUSD_ID,
        ...(t.payoutNft ? { nft: { capability: "mutable" as const, commitment: "" } } : {}),
      },
    });
  if (pusdChange > 0n) b.addOutput({ to: who.lock, amount: DUST, token: { amount: pusdChange, category: PUSD_ID } });
  return b.addOutput({ to: who.lock, amount: inSats - outSats - FEE });
}

// ---------- protect ----------
function protectTx(g: Game, at: Person, t: {
  amount?: bigint; potAdd?: bigint; commitment?: string; referee?: RefereeArg; signer?: Person; stateSats?: bigint;
} = {}) {
  const amount = t.amount ?? P.unit;
  const potAdd = t.potAdd ?? amount;
  const stateSats = t.stateSats ?? g.stateUtxo.satoshis;
  const coin = fund(g, at, { pusd: 5_000n }); // input 2: a coin at `at`'s address
  const next: KingdomState = { ...g.state, value: g.state.value + amount, protects: g.state.protects + 1 };
  const pusdChange = 5_000n - potAdd;
  const inSats = g.stateUtxo.satoshis + g.potUtxo.satoshis + coin.satoshis;
  const outSats = stateSats + g.potUtxo.satoshis + (pusdChange > 0n ? DUST : 0n);
  const b = new TransactionBuilder({ provider: g.provider })
    .addInput(g.stateUtxo, g.kingdom.unlock.protect(refereeArg(t.referee ?? "valid"), amount))
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addInput(coin, (t.signer ?? at).tpl.unlockP2PKH())
    .addOutput(stateOutput(g, t.commitment ?? encodeKingdomCommitment(next), stateSats))
    .addOutput({ to: g.pot.tokenAddress, amount: g.potUtxo.satoshis, token: { amount: g.potAmount + potAdd, category: PUSD_ID } });
  if (pusdChange > 0n) b.addOutput({ to: at.lock, amount: DUST, token: { amount: pusdChange, category: PUSD_ID } });
  return b.addOutput({ to: at.lock, amount: inSats - outSats - FEE });
}

// ---------- settle and fallback ----------
function settleTx(g: Game, bystander: Person, kind: "settle" | "fallback", t: {
  payout?: bigint; payoutTo?: Person; trophyCap?: "none" | "mutable"; commitment?: string; referee?: RefereeArg; sequence?: number;
} = {}) {
  const holderLock = p2pkhLock(hexToBin(g.state.holderPkh));
  const commitment = g.stateUtxo.token!.nft!.commitment;
  const unlocker = kind === "settle" ? g.kingdom.unlock.settle(refereeArg(t.referee ?? "valid")) : g.kingdom.unlock.settleFallback();
  const sequence = kind === "fallback" ? (t.sequence ?? P.fallbackBlocks) : undefined;
  const change = g.stateUtxo.satoshis + g.potUtxo.satoshis - 2n * DUST - FEE;
  return new TransactionBuilder({ provider: g.provider, allowImplicitFungibleTokenBurn: true })
    .addInput(g.stateUtxo, unlocker, sequence === undefined ? undefined : { sequence })
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addOutput({ to: t.payoutTo ? t.payoutTo.lock : holderLock, amount: DUST, token: { amount: t.payout ?? g.potAmount, category: PUSD_ID } })
    .addOutput({
      to: holderLock, amount: DUST,
      token: { amount: 0n, category: GAME_ID, nft: { capability: t.trophyCap ?? "none", commitment: t.commitment ?? commitment } },
    })
    .addOutput({ to: bystander.lock, amount: change });
}

// ---------- helpers ----------
async function expectFail(name: string, expected: string | null, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (expected !== null) assert.ok(msg.includes(expected), `${name}: rejected, but with the wrong error:\n${msg}`);
    console.log(`ok    ${name}${expected === null ? `  (rejected: ${msg.split("\n")[0]!.slice(0, 90)})` : ""}`);
    return;
  }
  assert.fail(`${name}: expected the transaction to be rejected, but it was accepted`);
}

async function pusdAt(g: Game, who: Person): Promise<bigint[]> {
  const utxos = await g.provider.getUtxosForLockingBytecode(who.lock);
  return utxos.filter((u) => u.token && !u.token.nft && u.token.category === PUSD_ID).map((u) => u.token!.amount);
}

async function main() {
  // --- the TypeScript module agrees with the contract's rule ---
  assert.deepEqual(conquestMoney(1000n, P), { fee: 20n, payment: 1020n, kingGets: 920n, poolGets: 100n });
  assert.deepEqual(conquestMoney(1005n, P), { fee: 20n, payment: 1025n, kingGets: 924n, poolGets: 101n });
  const sample: KingdomState = { passCount: 3, holderPkh: alice.pkhHex, value: 1500n, protects: 2, previous: previousOf(bob.pkhHex) };
  assert.deepEqual(decodeKingdomCommitment(encodeKingdomCommitment(sample)), sample);
  assert.equal(encodeKingdomCommitment(sample).length / 2, 40);
  assert.deepEqual(protectAmounts(100n), [100n, 500n, 1000n]);
  console.log("ok    layout and money helpers (the odd unit goes to the pool)");

  const sizeInfo = setup().kingdom as unknown as { bytesize?: number; opcount?: number };
  console.log(`info  compiled contract size: ${sizeInfo.bytesize ?? "?"} bytes, ${sizeInfo.opcount ?? "?"} operations`);

  // --- a whole round, with the money checked at every step ---
  let g = setup();
  await openTx(g, alice).send();
  g = await refresh(g);
  assert.deepEqual(g.state, kingState(alice));
  assert.equal(g.potAmount, 1000n);
  console.log("ok    open: alice pays 10.00, becomes king, value 10.00");

  await conquerTx(g, bob).send();
  const aliceGot = await pusdAt(g, alice);
  g = await refresh(g);
  assert.deepEqual(g.state, kingState(bob, { passCount: 2, previous: previousOf(alice.pkhHex) }));
  assert.equal(g.potAmount, 1100n);
  assert.ok(aliceGot.includes(920n), `alice should have received 920, has ${aliceGot}`);
  console.log("ok    conquer: bob pays 10.20, alice gets 9.20, pool +1.00, previous king = alice");

  await conquerTx(g, alice).send(); // alice takes her throne back: a normal conquest
  const bobGot = await pusdAt(g, bob);
  g = await refresh(g);
  assert.deepEqual(g.state, kingState(alice, { passCount: 3, previous: previousOf(bob.pkhHex) }));
  assert.equal(g.potAmount, 1200n);
  assert.ok(bobGot.includes(920n));
  console.log("ok    take back your throne: a normal conquest at the normal price");

  await protectTx(g, alice, { amount: 500n }).send();
  g = await refresh(g);
  assert.deepEqual(g.state, kingState(alice, { passCount: 3, value: 1500n, protects: 1, previous: previousOf(bob.pkhHex) }));
  assert.equal(g.potAmount, 1700n);
  await protectTx(g, alice, { amount: 100n }).send();
  g = await refresh(g);
  assert.equal(g.state.value, 1600n);
  assert.equal(g.state.protects, 2);
  assert.equal(g.potAmount, 1800n);
  console.log("ok    protect +5 then +1: value 16.00, pool 18.00, two protects used");

  await expectFail("a third protect in the same reign is refused", "No protects left this reign", async () => protectTx(g, alice).send());

  await conquerTx(g, bob).send(); // value 1600: fee 32, king 1472, pool 160
  const aliceGot2 = await pusdAt(g, alice);
  g = await refresh(g);
  assert.deepEqual(g.state, kingState(bob, { passCount: 4, value: 1600n, protects: 0, previous: previousOf(alice.pkhHex) }));
  assert.equal(g.potAmount, 1960n);
  assert.ok(aliceGot2.includes(1472n), `alice should have received 1472, has ${aliceGot2}`);
  console.log("ok    conquer at value 16.00: king gets 14.72, pool +1.60, protect counter reset, value kept");

  await settleTx(g, carol, "settle").send();
  const bobFinal = await pusdAt(g, bob);
  assert.ok(bobFinal.includes(1960n), `bob should have received the pool of 1960, has ${bobFinal}`);
  const trophy = (await g.provider.getUtxosForLockingBytecode(bob.lock)).find((u) => u.token?.nft?.capability === "none");
  assert.ok(trophy, "the trophy is missing");
  assert.equal(decodeKingdomCommitment(trophy.token!.nft!.commitment).passCount, 4);
  assert.equal((await g.kingdom.getUtxos()).length, 0);
  assert.equal((await g.pot.getUtxos()).length, 0);
  console.log("ok    settle: the last king takes the whole pool and the trophy");

  // --- opener only: the pool goes back ---
  {
    const s = setup(kingState(alice), 1000n);
    await settleTx(s, carol, "settle").send();
    assert.ok((await pusdAt(s, alice)).includes(1000n));
    console.log("ok    settle with only the opener: the pool returns to the opener");
  }

  // --- cancel: the same settle, with a coin of the king's as input 2 (the proof) and its change back ---
  {
    const s = setup(kingState(alice, { value: 1500n, protects: 1 }), 1500n);
    const holderLock = p2pkhLock(hexToBin(s.state.holderPkh));
    const kingCoin = s.provider.addUtxo(alice.lockHex, randomUtxo({ satoshis: 50_000n }));
    await new TransactionBuilder({ provider: s.provider })
      .addInput(s.stateUtxo, s.kingdom.unlock.settle(referee))
      .addInput(s.potUtxo, s.pot.unlock.release())
      .addInput(kingCoin, alice.tpl.unlockP2PKH())
      .addOutput({ to: holderLock, amount: DUST, token: { amount: 1500n, category: PUSD_ID } })
      .addOutput({ to: holderLock, amount: DUST, token: { amount: 0n, category: GAME_ID, nft: { capability: "none", commitment: s.stateUtxo.token!.nft!.commitment } } })
      .addOutput({ to: alice.lock, amount: s.stateUtxo.satoshis + s.potUtxo.satoshis + kingCoin.satoshis - 2n * DUST - FEE })
      .send();
    assert.ok((await pusdAt(s, alice)).includes(1500n));
    console.log("ok    cancel: settle with the king's own coin as input 2 pays the king the whole pool (no contract change)");
  }

  // --- open: adversarial ---
  await expectFail("open: underpay by one unit", "Opening price not paid", async () => openTx(setup(), alice, { pay: P.openingPrice - 1n }).send());
  await expectFail("open: wrong value in the new state", "Bad new commitment",
    async () => openTx(setup(), alice, { commitment: encodeKingdomCommitment(kingState(alice, { value: 999n })) }).send());
  await expectFail("open: pot sent elsewhere", "Output 1 must be the pot", async () => openTx(setup(), alice, { potTo: alice }).send());
  await expectFail("open: pot BCH shrank", "Pot BCH shrank", async () => openTx(setup(), alice, { potSats: 9_000n }).send());
  await expectFail("open: state BCH shrank", "State BCH shrank", async () => openTx(setup(), alice, { stateSats: 9_000n }).send());
  await expectFail("open: an already open round", "Round is already open", async () => openTx(setup(kingState(alice), 1000n), bob).send());
  await expectFail("open: a waiting pot that holds PUSD", "Waiting pot must hold no tokens", async () => openTx(setup(WAITING_STATE, 1000n), alice).send());
  await expectFail("open: wrong referee signature", "Referee signature missing or wrong", async () => openTx(setup(), alice, { referee: "wrong" }).send());
  await expectFail("open: missing referee signature", "Referee signature missing or wrong", async () => openTx(setup(), alice, { referee: "missing" }).send());

  // --- conquer: adversarial (alice is king at value 10.00, pool 10.00) ---
  const king = () => setup(kingState(alice), 1000n);
  await expectFail("conquer: king underpaid by one unit", "King not paid", async () => conquerTx(king(), bob, { king: 919n }).send());
  await expectFail("conquer: pool underpaid by one unit", "Pool share not paid", async () => conquerTx(king(), bob, { pool: 99n }).send());
  await expectFail("conquer: payout to the wrong address", "Output 2 must pay the dethroned king", async () => conquerTx(king(), bob, { payoutTo: carol }).send());
  await expectFail("conquer: payout in the wrong token", "Payout must be PUSD", async () => conquerTx(king(), bob, { payoutOther: true }).send());
  await expectFail("conquer: payout carrying a mutable NFT", "Payout must be PUSD", async () => conquerTx(king(), bob, { payoutNft: true }).send());
  await expectFail("conquer: payout output below the BCH minimum", "Payout needs BCH", async () => conquerTx(king(), bob, { payoutSats: 999n }).send());
  await expectFail("conquer: state BCH shrank", "State BCH shrank", async () => conquerTx(king(), bob, { stateSats: 9_000n }).send());
  await expectFail("conquer: pot BCH shrank", "Pot BCH shrank", async () => conquerTx(king(), bob, { potSats: 9_000n }).send());
  await expectFail("conquer: pot sent elsewhere", "Output 1 must be the pot", async () => conquerTx(king(), bob, { potTo: bob }).send());
  await expectFail("conquer: stale price (built for value 10.00, state is 15.00)", "Pool share not paid",
    async () => conquerTx(setup(kingState(alice, { value: 1500n }), 1500n), bob, { value: 1000n }).send());
  await expectFail("conquer: the same key cannot conquer its own throne", "The king cannot conquer their own throne", async () => conquerTx(king(), alice).send());
  await expectFail("conquer: protect counter not reset", "Bad new commitment",
    async () => conquerTx(setup(kingState(alice, { protects: 1 }), 1000n), bob,
      { commitment: encodeKingdomCommitment(kingState(bob, { passCount: 2, protects: 1, previous: previousOf(alice.pkhHex) })) }).send());
  await expectFail("conquer: previous king not recorded", "Bad new commitment",
    async () => conquerTx(king(), bob, { commitment: encodeKingdomCommitment(kingState(bob, { passCount: 2 })) }).send());
  await expectFail("conquer: value changed", "Bad new commitment",
    async () => conquerTx(king(), bob, { commitment: encodeKingdomCommitment(kingState(bob, { passCount: 2, value: 2000n, previous: previousOf(alice.pkhHex) })) }).send());
  await expectFail("conquer: wrong referee signature", "Referee signature missing or wrong", async () => conquerTx(king(), bob, { referee: "wrong" }).send());
  await expectFail("conquer: a waiting round", "Nobody has opened the round", async () => conquerTx(setup(WAITING_STATE, 1000n), bob).send());

  // --- protect: adversarial (alice is king at value 10.00) ---
  for (const amount of protectAmounts(P.unit)) {
    await protectTx(king(), alice, { amount }).send();
  }
  console.log("ok    protect: 1, 5 and 10 PUSD are accepted");
  await expectFail("protect: not the king (another address at input 2)", "Input 2 must be the king's", async () => protectTx(king(), bob).send());
  await expectFail("protect: the king's coin signed by someone else", null, async () => protectTx(king(), alice, { signer: bob }).send());
  await expectFail("protect: an amount that is not 1, 5 or 10", "Protect amount must be 1, 5 or 10", async () => protectTx(king(), alice, { amount: 200n }).send());
  await expectFail("protect: an amount of zero", "Protect amount must be 1, 5 or 10", async () => protectTx(king(), alice, { amount: 0n }).send());
  await expectFail("protect: over the cap (46.00 + 5.00)", "Walls at maximum",
    async () => protectTx(setup(kingState(alice, { value: 4600n }), 4600n), alice, { amount: 500n }).send());
  await protectTx(setup(kingState(alice, { value: 4500n }), 4500n), alice, { amount: 500n }).send();
  console.log("ok    protect: exactly the cap (45.00 + 5.00 = 50.00) is accepted");
  await expectFail("protect: a third protect", "No protects left this reign",
    async () => protectTx(setup(kingState(alice, { protects: 2 }), 1000n), alice).send());
  await expectFail("protect: pool underpaid by one unit", "Protect not paid", async () => protectTx(king(), alice, { potAdd: P.unit - 1n }).send());
  await expectFail("protect: counter not incremented", "Bad new commitment",
    async () => protectTx(king(), alice, { commitment: encodeKingdomCommitment(kingState(alice, { value: 1100n, protects: 0 })) }).send());
  await expectFail("protect: value not raised", "Bad new commitment",
    async () => protectTx(king(), alice, { commitment: encodeKingdomCommitment(kingState(alice, { value: 1000n, protects: 1 })) }).send());
  await expectFail("protect: previous king changed", "Bad new commitment",
    async () => protectTx(king(), alice, { commitment: encodeKingdomCommitment(kingState(alice, { value: 1100n, protects: 1, previous: previousOf(bob.pkhHex) })) }).send());
  await expectFail("protect: state BCH shrank", "State BCH shrank", async () => protectTx(king(), alice, { stateSats: 9_000n }).send());
  await expectFail("protect: wrong referee signature", "Referee signature missing or wrong", async () => protectTx(king(), alice, { referee: "wrong" }).send());
  await expectFail("protect: a waiting round", "Nobody has opened the round", async () => protectTx(setup(WAITING_STATE, 1000n), alice).send());

  // --- settle and fallback: adversarial ---
  const open2 = () => setup(kingState(bob, { passCount: 3, previous: previousOf(alice.pkhHex) }), 1500n);
  await expectFail("settle: pool underpaid", "Whole pot must be paid", async () => settleTx(open2(), carol, "settle", { payout: 1499n }).send());
  await expectFail("settle: pool sent to someone else", "Pot must go to the holder", async () => settleTx(open2(), carol, "settle", { payoutTo: carol }).send());
  await expectFail("settle: trophy not immutable", "Trophy must be immutable", async () => settleTx(open2(), carol, "settle", { trophyCap: "mutable" }).send());
  await expectFail("settle: trophy commitment changed", "Trophy commitment changed",
    async () => settleTx(open2(), carol, "settle", { commitment: encodeKingdomCommitment(kingState(bob, { passCount: 9 })) }).send());
  await expectFail("settle: wrong referee signature", "Referee signature missing or wrong", async () => settleTx(open2(), carol, "settle", { referee: "wrong" }).send());
  await expectFail("settle: a waiting round", "Nobody has opened the round", async () => settleTx(setup(WAITING_STATE, 1000n), carol, "settle").send());
  await expectFail("fallback: before the block count", null, async () => settleTx(open2(), carol, "fallback", { sequence: P.fallbackBlocks - 1 }).send());
  await settleTx(open2(), carol, "fallback").send();
  console.log("ok    fallback: anyone can settle at the block count, no referee needed");
  await expectFail("fallback: a waiting round", "Nobody has opened the round", async () => settleTx(setup(WAITING_STATE, 1000n), carol, "fallback").send());
  await expectFail("fallback: pool underpaid", "Whole pot must be paid", async () => settleTx(open2(), carol, "fallback", { payout: 1499n }).send());

  // --- paid from several small PUSD coins (refunds, change): what the page's coin pickers now build ---
  {
    let h = setup();
    await openTx(h, alice).send();
    h = await refresh(h);
    // bob holds 4 x 4.00 PUSD: no single coin pays 10.20, three together do
    const small = [0, 1, 2, 3].map(() => h.provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 1_000n, token: { amount: 400n, category: PUSD_ID } })));
    const fee = h.provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 100_000n }));
    const money = conquestMoney(h.state.value, P);
    const used = small.slice(0, 3);
    const change = 1200n - money.payment;
    const b = new TransactionBuilder({ provider: h.provider })
      .addInput(h.stateUtxo, h.kingdom.unlock.conquer(bob.pkh, referee))
      .addInput(h.potUtxo, h.pot.unlock.release());
    for (const c of [...used, fee]) b.addInput(c, bob.tpl.unlockP2PKH());
    const next: KingdomState = { passCount: 2, holderPkh: bob.pkhHex, value: h.state.value, protects: 0, previous: previousOf(alice.pkhHex) };
    const inSats = h.stateUtxo.satoshis + h.potUtxo.satoshis + 3_000n + fee.satoshis;
    const outSats = h.stateUtxo.satoshis + h.potUtxo.satoshis + DUST + DUST;
    await b
      .addOutput(stateOutput(h, encodeKingdomCommitment(next)))
      .addOutput({ to: h.pot.tokenAddress, amount: h.potUtxo.satoshis, token: { amount: h.potAmount + money.poolGets, category: PUSD_ID } })
      .addOutput({ to: alice.lock, amount: DUST, token: { amount: money.kingGets, category: PUSD_ID } })
      .addOutput({ to: bob.lock, amount: DUST, token: { amount: change, category: PUSD_ID } })
      .addOutput({ to: bob.lock, amount: inSats - outSats - FEE })
      .send();
    const aliceGot = await pusdAt(h, alice);
    h = await refresh(h);
    assert.equal(h.state.holderPkh, bob.pkhHex);
    assert.equal(h.potAmount, 1100n);
    assert.ok(aliceGot.includes(920n));
    assert.ok((await pusdAt(h, bob)).includes(change), "bob's PUSD change comes back");
    console.log("ok    conquer paid from three small PUSD coins plus a BCH coin: accepted, change back to the conqueror");

    // the king protects +1 from two small coins at the king's address
    const p1 = h.provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 1_000n, token: { amount: 60n, category: PUSD_ID } }));
    const p2 = h.provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 1_000n, token: { amount: 50n, category: PUSD_ID } }));
    const fee2 = h.provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 100_000n }));
    const pnext: KingdomState = { ...h.state, value: h.state.value + 100n, protects: 1 };
    const pIn = h.stateUtxo.satoshis + h.potUtxo.satoshis + 2_000n + fee2.satoshis;
    const pOut = h.stateUtxo.satoshis + h.potUtxo.satoshis + DUST;
    const pb = new TransactionBuilder({ provider: h.provider })
      .addInput(h.stateUtxo, h.kingdom.unlock.protect(referee, 100n))
      .addInput(h.potUtxo, h.pot.unlock.release());
    for (const c of [p1, p2, fee2]) pb.addInput(c, bob.tpl.unlockP2PKH());
    await pb
      .addOutput(stateOutput(h, encodeKingdomCommitment(pnext)))
      .addOutput({ to: h.pot.tokenAddress, amount: h.potUtxo.satoshis, token: { amount: h.potAmount + 100n, category: PUSD_ID } })
      .addOutput({ to: bob.lock, amount: DUST, token: { amount: 10n, category: PUSD_ID } })
      .addOutput({ to: bob.lock, amount: pIn - pOut - FEE })
      .send();
    h = await refresh(h);
    assert.equal(h.state.value, 1100n);
    assert.equal(h.potAmount, 1200n);
    console.log("ok    protect +1 paid from two small PUSD coins at the king's address: accepted");
  }

  console.log("\nAll Kingdom contract tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});