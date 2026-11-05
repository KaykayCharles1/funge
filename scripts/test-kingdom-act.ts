import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binToHex, decodeTransaction, encodeTransaction, hexToBin } from "@bitauth/libauth";
import type { Transaction } from "@bitauth/libauth";
import type { ElectrumNetworkProvider, Utxo } from "cashscript";
import { describeRound } from "../server/app.ts";
import { executeAct, type Referee } from "../server/act.ts";
import type { SignCall } from "../server/actTypes.ts";
import { makeChainReader, type ChainReader, type ChainState } from "../server/chain.ts";
import { fakeClock } from "../server/clock.ts";
import { parseKingdomGameFile, type ServerGame } from "../server/games.ts";
import { makeLocks } from "../server/lock.ts";
import { RoundManager } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { makeUnconfirmed } from "../server/unconfirmed.ts";
import {
  NO_PREVIOUS, WAITING_STATE, conquestMoney, decodeKingdomCommitment, encodeKingdomCommitment, previousOf, type KingdomState,
} from "../src/lib/kingdom.ts";
import { BELL_PRESETS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../src/refereeParams.ts";

const hex32 = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const ALICE = "11".repeat(20);
const BOB = "22".repeat(20);
const CAROL = "33".repeat(20);
const p2pkh = (pkh: string) => `76a914${pkh}88ac`;
const GRACE = GRACE_SECONDS * 1000;
const LOCK = PROTECT_LOCKOUT_SECONDS * 1000;
const bell = BELL_PRESETS.standard;
const dir = mkdtempSync(join(tmpdir(), "funge-kact-"));
let counter = 0;

const FILE = {
  contractVersion: 3, network: "chipnet", gameCategory: hex32(0xa1), pusdCategory: hex32(0xb2), refereePubkey: "02" + "11".repeat(32),
  state: { address: "state", lockingBytecode: "aa20" + "01".repeat(32) + "87" },
  pot: { address: "pot", lockingBytecode: "aa20" + "02".repeat(32) + "87" },
  params: { openingPrice: "1000", feePercent: "2", cutPercent: "10", cap: "5000", protectsPerReign: 2, unit: "100", fallbackBlocks: 12 },
};
const GAME: ServerGame = parseKingdomGameFile(FILE, "chipnet");
const PARAMS = GAME.kingdom!;

// ---------------------------------------------------------------- the game file
{
  assert.equal(GAME.kingdom?.openingPrice, 1000n);
  assert.equal(GAME.kingdom?.protectsPerReign, 2);
  assert.equal(GAME.fallbackBlocks, 12);
  const bad = (change: (f: any) => void, re: RegExp) => {
    const f = JSON.parse(JSON.stringify(FILE));
    change(f);
    assert.throws(() => parseKingdomGameFile(f, "chipnet"), re);
  };
  bad((f) => (f.contractVersion = 2), /Kingdom/);
  bad((f) => (f.network = "mainnet"), /Kingdom/);
  bad((f) => (f.refereePubkey = "02"), /refereePubkey/);
  bad((f) => (f.gameCategory = "zz"), /64 hex/);
  bad((f) => delete f.params.cap, /params.cap/);
  bad((f) => (f.params.cutPercent = "101"), /percent/);
  bad((f) => (f.params.cap = "999"), /cap/);
  bad((f) => (f.params.unit = "0"), /above zero/);
  bad((f) => (f.params.fallbackBlocks = 0), /fallbackBlocks/);
  bad((f) => delete f.pot, /addresses/);
  console.log("ok: the Kingdom game file is read and checked");
}

// ---------------------------------------------------------------- the world: a chain that follows the Kingdom rules
type SignRecord = SignCall;
async function setup(opts: { state?: KingdomState; pot?: bigint; cap?: number } = {}) {
  const { store } = await Store.open(join(dir, `s${counter++}.json`));
  const clock = fakeClock();
  const manager = new RoundManager(store, clock);
  manager.setBell(GAME.gameId, bell);
  const state = opts.state ?? WAITING_STATE;
  const world = {
    state, potAmount: opts.pot ?? 0n, stateTxid: hex32(1), potTxid: hex32(1), next: 10,
    broadcasts: [] as string[], signs: [] as SignRecord[], fail: null as Error | null,
  };
  const view = (): ChainState => {
    const k = world.state;
    return {
      live: true, passCount: k.passCount, holderPkh: k.passCount > 0 ? k.holderPkh : null, potAmount: world.potAmount,
      stateTxid: world.stateTxid, stateVout: 0, stale: false, kingdom: k,
      stateUtxo: { txid: world.stateTxid, vout: 0, satoshis: 2000n,
        token: { amount: 0n, category: GAME.gameId, nft: { capability: "mutable", commitment: encodeKingdomCommitment(k) } } },
      potUtxo: { txid: world.potTxid, vout: 1, satoshis: 2000n,
        ...(world.potAmount > 0n ? { token: { amount: world.potAmount, category: GAME.pusdCategory } } : {}) },
    };
  };
  const chain: ChainReader = { read: async () => view(), refresh: async () => view(), invalidate: () => undefined, last: () => view() };
  const referee: Referee = {
    settle: () => "00",
    sign: (_g, _tx, _src, call) => {
      world.signs.push(call);
      return Uint8Array.of(1, 2, 3);
    },
    broadcast: async (hex) => {
      if (world.fail) throw world.fail;
      world.broadcasts.push(hex);
      const tx = decodeTransaction(hexToBin(hex)) as Transaction;
      world.state = decodeKingdomCommitment(binToHex(tx.outputs[0]!.token!.nft!.commitment));
      world.potAmount = tx.outputs[1]!.token!.amount;
      world.stateTxid = hex32(world.next++);
      world.potTxid = world.stateTxid; // state and pot are outputs 0 and 1 of the same transaction
      return world.stateTxid;
    },
  };
  const unconfirmed = makeUnconfirmed(opts.cap ?? 40);
  const deps = { manager, chain, clock, referee, locks: makeLocks(), unconfirmed, sleep: async () => undefined };
  // an already-running round: start its clock the way a real open or conquest would have
  if (state.passCount === 1) manager.applyKingdomAction(GAME.gameId, "open", 1);
  else if (state.passCount > 1) manager.applyKingdomAction(GAME.gameId, "conquer", state.passCount);
  return { manager, clock, world, unconfirmed, deps, view };
}
type World = Awaited<ReturnType<typeof setup>>["world"];

// ---------------------------------------------------------------- transaction builders
const input = (txid: string, bytes: Uint8Array, vout = 0) => ({ outpointTransactionHash: hexToBin(txid), outpointIndex: vout, sequenceNumber: 0, unlockingBytecode: bytes });
const stateOut = (next: KingdomState) => ({
  lockingBytecode: hexToBin(FILE.state.lockingBytecode), valueSatoshis: 2000n,
  token: { amount: 0n, category: hexToBin(GAME.gameId), nft: { capability: "mutable" as const, commitment: hexToBin(encodeKingdomCommitment(next)) } },
});
const potOut = (amount: bigint, lock = FILE.pot.lockingBytecode) => ({
  lockingBytecode: hexToBin(lock), valueSatoshis: 2000n, token: { amount, category: hexToBin(GAME.pusdCategory) },
});

type Common = { stateTxid?: string; unsigned?: boolean; garbage?: boolean; action?: string; next?: Partial<KingdomState>; potDelta?: bigint; potLock?: string };
type Extra = {
  payer?: string; // key hash of the first wallet input
  walletLock?: string;
  payoutTo?: string; payoutAmount?: bigint; payoutCategory?: string; payoutNft?: boolean; payoutSats?: bigint; noPayout?: boolean;
  amount?: bigint;
};

function body(world: World, kind: "open" | "conquer" | "protect", o: Common & Extra = {}) {
  const cur = world.state;
  const payer = o.payer ?? (kind === "protect" ? cur.holderPkh : kind === "open" ? ALICE : BOB);
  const walletLock = o.walletLock ?? p2pkh(payer);
  const money = conquestMoney(cur.value, PARAMS);
  let next: KingdomState;
  let pot: bigint;
  if (kind === "open") {
    next = { passCount: 1, holderPkh: payer, value: PARAMS.openingPrice, protects: 0, previous: NO_PREVIOUS };
    pot = world.potAmount + PARAMS.openingPrice;
  } else if (kind === "conquer") {
    next = { passCount: cur.passCount + 1, holderPkh: payer, value: cur.value, protects: 0, previous: previousOf(cur.holderPkh) };
    pot = world.potAmount + money.poolGets;
  } else {
    const amount = o.amount ?? PARAMS.unit;
    next = { ...cur, value: cur.value + amount, protects: cur.protects + 1 };
    pot = world.potAmount + amount;
  }
  next = { ...next, ...(o.next ?? {}) };
  pot += o.potDelta ?? 0n;
  const walletTxid = hex32(200);
  const outputs = [
    stateOut(next),
    potOut(pot, o.potLock),
  ];
  if (kind === "conquer" && !o.noPayout) {
    outputs.push({
      lockingBytecode: hexToBin(p2pkh(o.payoutTo ?? cur.holderPkh)), valueSatoshis: o.payoutSats ?? 1000n,
      token: {
        amount: o.payoutAmount ?? money.kingGets, category: hexToBin(o.payoutCategory ?? GAME.pusdCategory),
        ...(o.payoutNft ? { nft: { capability: "none" as const, commitment: new Uint8Array(0) } } : {}),
      },
    } as (typeof outputs)[number]);
  }
  outputs.push({ lockingBytecode: hexToBin(walletLock), valueSatoshis: 1000n } as (typeof outputs)[number]);
  const tx: Transaction = {
    version: 2, locktime: 0,
    inputs: [
      input(o.stateTxid ?? world.stateTxid, Uint8Array.of(0)),
      input(world.potTxid, Uint8Array.of(0), 1),
      input(walletTxid, o.unsigned ? new Uint8Array(0) : new Uint8Array(100).fill(7)),
    ],
    outputs,
  };
  return {
    action: o.action ?? kind,
    txHex: o.garbage ? "00" : binToHex(encodeTransaction(tx)),
    walletInputs: [{ txid: walletTxid, vout: 0, satoshis: "50000", lockingBytecode: walletLock, token: { amount: "5000", category: GAME.pusdCategory } }],
  };
}

async function fails(p: Promise<unknown>, code: string, label = "") {
  try {
    await p;
  } catch (e) {
    assert.equal((e as { code?: string }).code, code, `${label} expected ${code}, got ${(e as { code?: string }).code}: ${(e as Error).message}`);
    return;
  }
  assert.fail(`${label} expected ${code}, but the call succeeded`);
}

const kingdomOf = (s: Awaited<ReturnType<typeof setup>>) => s.world.state;
const open1: KingdomState = { passCount: 1, holderPkh: ALICE, value: 1000n, protects: 0, previous: NO_PREVIOUS };
const conquered: KingdomState = { passCount: 2, holderPkh: BOB, value: 1000n, protects: 0, previous: previousOf(ALICE) };

// ---------------------------------------------------------------- the chain reader
{
  const clock = fakeClock();
  const stateCoin = (txid: string, commitment: string): Utxo => ({
    txid, vout: 0, satoshis: 2000n, token: { amount: 0n, category: GAME.gameId, nft: { capability: "mutable", commitment } },
  });
  const run = async (states: Utxo[], pots: Utxo[]) => {
    const provider = { getUtxos: async (addr: string) => (addr === "state" ? states : pots) } as unknown as ElectrumNetworkProvider;
    return makeChainReader(provider, clock);
  };
  const T = hex32(7);
  // waiting: a BCH-only pot coin, output 1 of the state's transaction
  let reader = await run([stateCoin(T, encodeKingdomCommitment(WAITING_STATE))], [{ txid: T, vout: 1, satoshis: 2000n }]);
  let c = await reader.refresh(GAME);
  assert.equal(c.live, true);
  assert.equal(c.passCount, 0);
  assert.equal(c.holderPkh, null);
  assert.equal(c.potAmount, 0n);
  assert.equal(c.potUtxo?.vout, 1);
  assert.deepEqual(c.kingdom, WAITING_STATE);
  // strangers' coins at the pot address are ignored: other transaction, other output, even with PUSD
  const stray: Utxo[] = [
    { txid: hex32(9), vout: 1, satoshis: 5000n, token: { amount: 999_999n, category: GAME.pusdCategory } },
    { txid: T, vout: 0, satoshis: 5000n, token: { amount: 777n, category: GAME.pusdCategory } },
    { txid: T, vout: 1, satoshis: 2000n },
  ];
  reader = await run([stateCoin(T, encodeKingdomCommitment(WAITING_STATE))], stray);
  c = await reader.refresh(GAME);
  assert.equal(c.potAmount, 0n);
  assert.equal(c.potUtxo?.satoshis, 2000n);
  // open round: the pot holds PUSD
  reader = await run(
    [stateCoin(T, encodeKingdomCommitment(conquered))],
    [{ txid: T, vout: 1, satoshis: 2000n, token: { amount: 1100n, category: GAME.pusdCategory } }, ...stray.slice(0, 2)],
  );
  c = await reader.refresh(GAME);
  assert.equal(c.passCount, 2);
  assert.equal(c.holderPkh, BOB);
  assert.equal(c.potAmount, 1100n);
  assert.equal(c.kingdom?.previous, previousOf(ALICE));
  // no pot output 1 yet (the view is behind): no pot, not a wrong one
  reader = await run([stateCoin(T, encodeKingdomCommitment(conquered))], stray.slice(0, 2));
  c = await reader.refresh(GAME);
  assert.equal(c.potUtxo, null);
  assert.equal(c.potAmount, null);
  // a commitment that is not 40 bytes is an error, not a guess
  reader = await run([stateCoin(T, "aabb")], []);
  await assert.rejects(() => reader.refresh(GAME), /40 bytes/);
  // the state coin disappearing must be seen twice
  let states = [stateCoin(T, encodeKingdomCommitment(conquered))];
  const provider = { getUtxos: async (addr: string) => (addr === "state" ? states : []) } as unknown as ElectrumNetworkProvider;
  reader = makeChainReader(provider, clock);
  await reader.refresh(GAME);
  states = [];
  assert.equal((await reader.refresh(GAME)).stale, true);
  const gone = await reader.refresh(GAME);
  assert.equal(gone.live, false);
  console.log("ok: chain reader: Kingdom state decoded; the pot is output 1 of the state's transaction; stray coins ignored; waiting pot is 0 PUSD");
}

// ---------------------------------------------------------------- open
{
  const s = await setup();
  const res = await executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE }));
  assert.equal(res.passCount, 1);
  assert.equal(res.king, ALICE);
  const r = s.manager.get(GAME.gameId);
  assert.equal(r.status, "open");
  assert.equal(r.deadline, s.clock.now() + bell.startSeconds * 1000);
  const ev = r.events.at(-1)!;
  assert.deepEqual([ev.type, ev.reason, ev.data?.clockSeconds, ev.data?.nextClockSeconds, ev.data?.king], ["deadline_changed", "open", 600, 570, ALICE]);
  assert.deepEqual(s.world.signs, [{ fn: "open", newHolder: ALICE }]);
  assert.deepEqual(kingdomOf(s), open1);
  assert.equal(s.world.potAmount, 1000n);
  const sent = decodeTransaction(hexToBin(s.world.broadcasts[0]!)) as Transaction;
  assert.deepEqual([...sent.inputs[0]!.unlockingBytecode], [1, 2, 3]);
  assert.equal(sent.inputs[2]!.unlockingBytecode.length, 100); // the wallet's signature is untouched
  console.log("ok: open: the first player pays 10.00, becomes king, the clock starts at 10:00, the referee signs 'open'");
}
{
  const bad = async (label: string, o: Common & Extra, code: string) => {
    const s = await setup();
    await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE, ...o })), code, label);
    assert.equal(s.world.broadcasts.length, 0, `${label}: nothing may be broadcast`);
    assert.equal(s.manager.get(GAME.gameId).deadline, null, `${label}: the clock must stay off`);
  };
  await bad("underpaid by one unit", { potDelta: -1n }, "invalid");
  await bad("overpaid by one unit", { potDelta: 1n }, "invalid");
  await bad("wrong pass count", { next: { passCount: 2 } }, "invalid");
  await bad("wrong opening value", { next: { value: 999n } }, "invalid");
  await bad("protects already used", { next: { protects: 1 } }, "invalid");
  await bad("previous king invented", { next: { previous: "ab".repeat(11) } }, "invalid");
  await bad("an empty king address", { next: { holderPkh: "00".repeat(20) } }, "invalid");
  await bad("pot sent elsewhere", { potLock: FILE.state.lockingBytecode }, "invalid");
  await bad("unsigned wallet input", { unsigned: true }, "invalid");
  await bad("unreadable transaction", { garbage: true }, "invalid");
  await bad("stale state coin", { stateTxid: hex32(99) }, "state_changed");
  const open = await setup({ state: open1, pot: 1000n });
  await fails(executeAct(open.deps, GAME, body(open.world, "open", { payer: BOB })), "state_changed", "open on an open round");
  console.log("ok: open: every wrong shape is refused with nothing broadcast and the clock untouched");
}

// ---------------------------------------------------------------- conquer
{
  const s = await setup({ state: open1, pot: 1000n });
  s.clock.advance(100_000); // 500 s left on the open's clock
  const res = await executeAct(s.deps, GAME, body(s.world, "conquer"));
  assert.equal(res.passCount, 2);
  assert.equal(res.king, BOB);
  const r = s.manager.get(GAME.gameId);
  assert.equal(r.deadline, s.clock.now() + 570_000); // the bell, not what was left
  const ev = r.events.at(-1)!;
  assert.deepEqual([ev.reason, ev.data?.clockSeconds, ev.data?.nextClockSeconds, ev.data?.passCount], ["conquer", 570, 540, 2]);
  assert.deepEqual(s.world.signs, [{ fn: "conquer", newHolder: BOB }]);
  assert.deepEqual(kingdomOf(s), conquered);
  assert.equal(s.world.potAmount, 1100n); // +1.00 for the pool: 10.20 paid, 9.20 to the king
  // the dethroned king takes the throne back: a normal conquest at the normal price, the previous king is now bob
  s.clock.advance(1000);
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: ALICE }));
  assert.deepEqual(kingdomOf(s), { passCount: 3, holderPkh: ALICE, value: 1000n, protects: 0, previous: previousOf(BOB) });
  assert.equal(s.manager.get(GAME.gameId).deadline, s.clock.now() + 540_000);
  console.log("ok: conquer: the clock resets to the bell (9:30, then 9:00), the pool grows by the pool share, take-back works");
}
{
  // a conquest at value 16.00 pays the king 14.72 and the pool 1.60
  const s = await setup({ state: { ...conquered, value: 1600n, protects: 2 }, pot: 1800n });
  const m = conquestMoney(1600n, PARAMS);
  assert.deepEqual([m.fee, m.payment, m.kingGets, m.poolGets], [32n, 1632n, 1472n, 160n]);
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL }));
  assert.equal(s.world.potAmount, 1960n);
  assert.deepEqual(kingdomOf(s), { passCount: 3, holderPkh: CAROL, value: 1600n, protects: 0, previous: previousOf(BOB) });
  console.log("ok: conquer at value 16.00: pool +1.60, protect counter back to zero, value kept");
}
{
  const bad = async (label: string, o: Common & Extra, code: string) => {
    const s = await setup({ state: open1, pot: 1000n });
    await fails(executeAct(s.deps, GAME, body(s.world, "conquer", o)), code, label);
    assert.equal(s.world.broadcasts.length, 0, `${label}: nothing may be broadcast`);
    assert.equal(s.manager.get(GAME.gameId).deadline, s.clock.now() + 600_000, `${label}: the clock must not move`);
  };
  await bad("king underpaid by one unit", { payoutAmount: 919n }, "invalid");
  await bad("pool underpaid by one unit", { potDelta: -1n }, "invalid");
  await bad("pool overpaid by one unit", { potDelta: 1n }, "invalid");
  await bad("payout to the wrong address", { payoutTo: CAROL }, "invalid");
  await bad("no payout output at all", { noPayout: true }, "invalid");
  await bad("payout in another token", { payoutCategory: hex32(0xcc) }, "invalid");
  await bad("payout carrying an NFT", { payoutNft: true }, "invalid");
  await bad("payout below the BCH minimum", { payoutSats: 999n }, "invalid");
  await bad("previous king not recorded", { next: { previous: NO_PREVIOUS } }, "invalid");
  await bad("protect counter not reset", { next: { protects: 1 } }, "invalid");
  await bad("value changed", { next: { value: 2000n } }, "state_changed");
  await bad("pass count skipped", { next: { passCount: 3 } }, "state_changed");
  await bad("an empty king address", { next: { holderPkh: "00".repeat(20) } }, "invalid");
  await bad("the king conquers their own throne", { payer: ALICE }, "already_king");
  await bad("unsigned wallet input", { unsigned: true }, "invalid");
  await bad("stale state coin", { stateTxid: hex32(99) }, "state_changed");
  await bad("an action of the old game", { action: "steal" }, "invalid");
  await bad("an action that is not a player action", { action: "settle" }, "invalid");
  const waiting = await setup();
  await fails(executeAct(waiting.deps, GAME, body(waiting.world, "conquer", { next: { passCount: 1 } })), "not_open", "conquer on a waiting round");
  console.log("ok: conquer: every wrong shape is refused with nothing broadcast and the clock untouched");
}
{
  // timing
  const s = await setup({ state: open1, pot: 1000n });
  const d = s.manager.get(GAME.gameId).deadline!;
  s.clock.set(d + GRACE - 1);
  await executeAct(s.deps, GAME, body(s.world, "conquer")); // 999 ms late is inside the grace
  const d2 = s.manager.get(GAME.gameId).deadline!;
  assert.equal(d2, d + GRACE - 1 + 570_000);
  s.clock.set(d2 + GRACE);
  await fails(executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL })), "too_late");
  await fails(executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL })), "round_over");
  const lock = await setup({ state: open1, pot: 1000n });
  lock.clock.set(lock.manager.get(GAME.gameId).deadline! - 5_000);
  await executeAct(lock.deps, GAME, body(lock.world, "conquer")); // the protect lockout does not apply to conquest
  const paused = await setup({ state: open1, pot: 1000n });
  paused.manager.pause(GAME.gameId, "manual");
  await fails(executeAct(paused.deps, GAME, body(paused.world, "conquer")), "paused");
  console.log("ok: conquer: grace accepted, then too_late, then round_over; allowed in the last 5 s; refused while paused");
}

// ---------------------------------------------------------------- protect
{
  const s = await setup({ state: conquered, pot: 1100n });
  const deadline = s.manager.get(GAME.gameId).deadline!;
  s.clock.advance(60_000);
  const res = await executeAct(s.deps, GAME, body(s.world, "protect", { amount: 500n }));
  assert.equal(res.passCount, 2);
  assert.equal(res.king, BOB);
  assert.equal(res.deadline, deadline); // protect does not touch the clock
  assert.equal(s.manager.get(GAME.gameId).deadline, deadline);
  const ev = s.manager.get(GAME.gameId).events.at(-1)!;
  assert.deepEqual([ev.type, ev.reason, ev.data?.amount, ev.data?.value, ev.data?.protectsUsed, ev.data?.deadline], ["protect_applied", "protect", "500", "1500", 1, deadline]);
  assert.deepEqual(s.world.signs, [{ fn: "protect", amount: 500n }]);
  assert.deepEqual(kingdomOf(s), { ...conquered, value: 1500n, protects: 1 });
  assert.equal(s.world.potAmount, 1600n);
  await executeAct(s.deps, GAME, body(s.world, "protect", { amount: 100n }));
  assert.deepEqual(kingdomOf(s), { ...conquered, value: 1600n, protects: 2 });
  assert.equal(s.world.potAmount, 1700n);
  assert.equal(s.manager.get(GAME.gameId).deadline, deadline);
  await fails(executeAct(s.deps, GAME, body(s.world, "protect")), "no_protects_left");
  // a conquest resets the counter, and the new king can protect again
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL }));
  assert.equal(kingdomOf(s).protects, 0);
  await executeAct(s.deps, GAME, body(s.world, "protect", { amount: 1000n }));
  assert.equal(kingdomOf(s).value, 2600n);
  console.log("ok: protect: +5 then +1 never move the clock, a third is refused, a conquest resets the counter");
}
{
  const bad = async (label: string, o: Common & Extra, code: string, state: KingdomState = conquered) => {
    const s = await setup({ state, pot: 1100n });
    const before = s.manager.get(GAME.gameId).deadline;
    await fails(executeAct(s.deps, GAME, body(s.world, "protect", o)), code, label);
    assert.equal(s.world.broadcasts.length, 0, `${label}: nothing may be broadcast`);
    assert.equal(s.manager.get(GAME.gameId).deadline, before, `${label}: the clock must not move`);
  };
  await bad("not the king (another address at input 2)", { walletLock: p2pkh(CAROL) }, "not_king");
  await bad("the previous king tries", { payer: ALICE }, "not_king");
  await bad("an amount that is not 1, 5 or 10", { amount: 200n }, "invalid");
  await bad("an amount of zero", { amount: 0n }, "invalid");
  await bad("pool underpaid", { potDelta: -1n }, "invalid");
  await bad("pool overpaid", { potDelta: 1n }, "invalid");
  await bad("counter not incremented", { next: { protects: 0 } }, "invalid");
  await bad("the king changed", { next: { holderPkh: CAROL } }, "invalid");
  await bad("the pass count changed", { next: { passCount: 3 } }, "invalid");
  await bad("the previous king changed", { next: { previous: NO_PREVIOUS } }, "invalid");
  await bad("value over the cap", { amount: 500n }, "walls_at_maximum", { ...conquered, value: 4600n });
  await bad("a third protect", {}, "no_protects_left", { ...conquered, protects: 2 });
  await bad("stale state coin", { stateTxid: hex32(99) }, "state_changed");
  await bad("unsigned wallet input", { unsigned: true }, "invalid");
  const atCap = await setup({ state: { ...conquered, value: 4500n }, pot: 1100n });
  await executeAct(atCap.deps, GAME, body(atCap.world, "protect", { amount: 500n }));
  assert.equal(kingdomOf(atCap).value, 5000n);
  await fails(executeAct(atCap.deps, GAME, body(atCap.world, "protect", { amount: 100n })), "walls_at_maximum", "above the cap by one unit");
  const waiting = await setup();
  await fails(executeAct(waiting.deps, GAME, body(waiting.world, "protect", { next: { passCount: 1 } })), "not_open", "protect on a waiting round");
  console.log("ok: protect: not the king, bad amounts, wrong pool, wrong state, the cap (exactly 50.00 allowed), no protects left");
}
{
  // the lockout: judged by when the request arrived
  const at = async (msLeft: number) => {
    const s = await setup({ state: open1, pot: 1000n });
    s.clock.set(s.manager.get(GAME.gameId).deadline! - msLeft);
    return s;
  };
  let s = await at(LOCK + 1);
  await executeAct(s.deps, GAME, body(s.world, "protect")); // 30.001 s left: open
  for (const left of [LOCK, LOCK - 1, 10_000, 1]) {
    s = await at(left);
    await fails(executeAct(s.deps, GAME, body(s.world, "protect")), "protect_locked", `${left} ms left`);
    assert.equal(s.world.broadcasts.length, 0);
  }
  s = await at(-500); // 0.5 s after the deadline, inside the grace
  await fails(executeAct(s.deps, GAME, body(s.world, "protect")), "protect_locked", "inside the grace");
  s = await at(-(GRACE + 10));
  await fails(executeAct(s.deps, GAME, body(s.world, "protect")), "too_late", "after the grace");
  s = await setup({ state: open1, pot: 1000n });
  s.manager.pause(GAME.gameId, "network_busy");
  await fails(executeAct(s.deps, GAME, body(s.world, "protect")), "paused");
  console.log("ok: protect lockout: 30.001 s left is open; 30.000 s and less is closed; paused and late are refused with their own codes");
}

// ---------------------------------------------------------------- races
{
  const s = await setup({ state: open1, pot: 1000n });
  const a = body(s.world, "conquer");
  const b = body(s.world, "conquer", { payer: CAROL });
  const results = await Promise.allSettled([executeAct(s.deps, GAME, a), executeAct(s.deps, GAME, b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code, "state_changed");
  assert.equal(s.world.broadcasts.length, 1);
  const k = await setup({ state: open1, pot: 1000n });
  const conquer = body(k.world, "conquer");
  const protect = body(k.world, "protect");
  const mixed = await Promise.allSettled([executeAct(k.deps, GAME, conquer), executeAct(k.deps, GAME, protect)]);
  assert.equal(mixed.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(((mixed.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code, "state_changed");
  console.log("ok: two moves built on the same state: exactly one wins, the other is told the game moved on");
}

// ---------------------------------------------------------------- only the three Kingdom moves are accepted
{
  const s = await setup();
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE, action: "pass" })), "invalid");
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE, action: "steal" })), "invalid");
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE, action: "settle" })), "invalid");
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE, action: "constructor" })), "invalid");
  assert.equal(s.world.broadcasts.length, 0);
  console.log("ok: only open, conquer and protect are accepted (the old pass and steal, and settle, are refused)");
}

// ---------------------------------------------------------------- unconfirmed cap and broadcast errors still apply
{
  const s = await setup({ state: open1, pot: 1000n, cap: 1 });
  await executeAct(s.deps, GAME, body(s.world, "conquer"));
  await fails(executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL })), "network_busy");
  assert.equal(s.manager.get(GAME.gameId).paused?.reason, "network_busy");
  const f = await setup({ state: open1, pot: 1000n });
  f.world.fail = new Error("txn-mempool-conflict");
  await fails(executeAct(f.deps, GAME, body(f.world, "conquer")), "state_changed");
  assert.equal(f.manager.get(GAME.gameId).events.at(-1)?.reason, "open"); // no new clock event: the broadcast failed
  console.log("ok: network-busy pause and broadcast errors behave as before");
}

// ---------------------------------------------------------------- timing and error cases carried over from the old game's tests
{
  // the same move sent twice, one after the other and at the same time
  const s = await setup();
  const b = body(s.world, "open", { payer: ALICE });
  await executeAct(s.deps, GAME, b);
  await fails(executeAct(s.deps, GAME, b), "state_changed");
  const t = await setup();
  const same = body(t.world, "open", { payer: ALICE });
  const both = await Promise.allSettled([executeAct(t.deps, GAME, same), executeAct(t.deps, GAME, same)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code, "state_changed");
  assert.equal(t.world.broadcasts.length, 1);
  console.log("ok: the same move sent twice: one wins, the other is told the game moved on");
}
{
  // an in-time request stays in time even when the network checks are slow; a late one is still refused
  const s = await setup({ state: open1, pot: 1000n });
  const d1 = s.manager.get(GAME.gameId).deadline!;
  const slowChain: ChainReader = {
    ...s.deps.chain,
    refresh: async (g) => {
      s.clock.set(s.clock.now() + 1500); // the network check takes 1.5 s
      return s.deps.chain.refresh(g);
    },
  };
  const slow = { ...s.deps, chain: slowChain };
  s.clock.set(d1 - 300);
  await executeAct(slow, GAME, body(s.world, "conquer")); // arrived 300 ms early, finished 1.2 s after the deadline
  assert.equal(s.world.broadcasts.length, 1);
  const r = s.manager.get(GAME.gameId);
  assert.equal(r.status, "open");
  assert.equal(r.deadline, d1 + 1200 + 570_000);
  s.clock.set(r.deadline! + GRACE + 10);
  await fails(executeAct(slow, GAME, body(s.world, "conquer", { payer: CAROL })), "too_late"); // arrived late: still refused
  assert.equal(s.world.broadcasts.length, 1);
  console.log("ok: arrival time decides: slow checks cannot make an in-time move late");
}
{
  // the cap pauses the round and a new block lifts it
  const s = await setup({ state: open1, pot: 1000n, cap: 2 });
  await executeAct(s.deps, GAME, body(s.world, "conquer"));
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: CAROL }));
  await fails(executeAct(s.deps, GAME, body(s.world, "conquer", { payer: BOB })), "network_busy");
  assert.equal(s.manager.get(GAME.gameId).paused?.reason, "network_busy");
  s.unconfirmed.resetAll();
  s.manager.resume(GAME.gameId, "network_ok");
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: BOB }));
  console.log("ok: the unconfirmed cap pauses the round and a new block lifts it");
}
{
  // what the node can say at broadcast
  const s = await setup();
  s.world.fail = new Error("Failed to establish connection: WebSocket: 1006");
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE })), "outcome_unknown");
  assert.equal(s.manager.get(GAME.gameId).deadline, null); // clock untouched
  s.world.fail = new Error("too-long-mempool-chain");
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE })), "network_busy");
  assert.equal(s.manager.get(GAME.gameId).paused?.reason, "network_busy");
  assert.equal(s.world.broadcasts.length, 0);
  console.log("ok: broadcast errors mapped (unknown outcome, network busy)");
}
{
  // our own last move not yet visible on the chain view; nothing accepted after settlement
  const s = await setup();
  s.manager.get(GAME.gameId).seenPassCount = 5;
  await fails(executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE })), "chain_unavailable");
  const t = await setup({ state: open1, pot: 1000n });
  t.manager.markSettled(GAME.gameId, "t", "claim");
  await fails(executeAct(t.deps, GAME, body(t.world, "conquer")), "round_over");
  console.log("ok: a stale chain view is refused; a settled round accepts nothing");
}

// ---------------------------------------------------------------- every event carries what a scene needs
{
  const s = await setup();
  const id = GAME.gameId;
  await executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE }));
  await executeAct(s.deps, GAME, body(s.world, "protect", { amount: PARAMS.unit * 5n }));
  await executeAct(s.deps, GAME, body(s.world, "conquer", { payer: BOB }));
  const r = s.manager.get(id);
  const [opened, protectedEv, conquered2] = r.events;
  const scene = (e: typeof opened) => e!.data;
  // the envelope
  for (const e of r.events) {
    assert.equal(e.roundId, id);
    assert.equal(typeof e.at, "number");
    assert.equal(typeof e.seq, "number");
  }
  // open
  assert.deepEqual(
    { ...scene(opened), deadline: "x", txid: "x" },
    { king: ALICE, previousKing: null, passCount: 1, conquests: 0, value: "1000", treasury: "1000", protectsLeft: 2,
      deadline: "x", clockSeconds: 600, nextClockSeconds: 570, action: "open", txid: "x", actor: ALICE, paid: "1000", refunded: "0", toTreasury: "1000" },
    "open event",
  );
  // protect +5.00 on a throne of 10.00: nothing is refunded, the clock numbers are the king's current ones
  assert.deepEqual(
    { ...scene(protectedEv), deadline: "x", txid: "x" },
    { king: ALICE, previousKing: null, passCount: 1, conquests: 0, value: "1500", treasury: "1500", protectsLeft: 1,
      deadline: "x", clockSeconds: 600, nextClockSeconds: 570, txid: "x", actor: ALICE, paid: "500", refunded: "0", toTreasury: "500", amount: "500", protectsUsed: 1 },
    "protect event",
  );
  assert.equal(scene(protectedEv)!.deadline, scene(opened)!.deadline); // protect never moves the clock
  // conquest of a throne worth 15.00: pays 15.30, the old king gets 13.80, the pool gets 1.50
  assert.deepEqual(
    { ...scene(conquered2), deadline: "x", txid: "x" },
    { king: BOB, previousKing: ALICE, passCount: 2, conquests: 1, value: "1500", treasury: "1650", protectsLeft: 2,
      deadline: "x", clockSeconds: 570, nextClockSeconds: 540, action: "conquer", txid: "x", actor: BOB, paid: "1530", refunded: "1380", toTreasury: "150" },
    "conquest event",
  );
  // the events that no move causes carry the same picture
  s.manager.pause(id, "network_busy");
  s.manager.resume(id, "network_ok");
  s.clock.set(s.manager.get(id).deadline! + GRACE);
  s.manager.observe(id, { live: true, passCount: 2 });
  const [paused, resumed, over] = r.events.slice(3);
  for (const e of [paused, resumed, over]) {
    const d = e!.data!;
    assert.deepEqual([d.king, d.previousKing, d.passCount, d.conquests, d.value, d.treasury, d.protectsLeft, d.clockSeconds], [BOB, ALICE, 2, 1, "1500", "1650", 2, 570]);
    assert.equal(typeof d.deadline, "number");
  }
  assert.deepEqual([paused!.type, resumed!.type, over!.type], ["clock_paused", "clock_resumed", "round_over"]);
  // the wire shape of a stored old event: a missing roundId is filled in when events are sent out
  const old = s.manager.get(id).events[0]!;
  delete (old as { roundId?: string }).roundId;
  assert.equal(s.manager.eventsAfter(id, 0).events[0]!.roundId, id);
  console.log("ok: events carry the round id, who acted, previous king, paid, refunded, to treasury, value and treasury after, protects left, conquests, bell and deadline");
}

// ---------------------------------------------------------------- what the page is told
{
  const s = await setup();
  const desc = () => {
    const c = s.view();
    s.manager.observe(GAME.gameId, { live: c.live, passCount: c.passCount });
    return describeRound(GAME, s.manager.get(GAME.gameId), c, s.clock.now(), s.manager.bellInfo(GAME.gameId, c.passCount));
  };
  let d = desc();
  assert.equal(d.kind, "kingdom");
  assert.equal(d.status, "waiting");
  assert.equal(d.price, "1000"); // the opening price
  assert.equal(d.king, null);
  assert.equal(d.kingdom?.holder, null);
  assert.equal(d.kingdom?.conquest, null);
  assert.deepEqual([d.kingdom?.protectsLeft, d.kingdom?.protectAmounts, d.kingdom?.nextClockSeconds, d.kingdom?.clockSeconds], [0, [], 600, null]);

  await executeAct(s.deps, GAME, body(s.world, "open", { payer: ALICE }));
  d = desc();
  assert.equal(d.king, ALICE);
  assert.equal(d.price, "1020"); // value + the 2% fee
  assert.deepEqual(d.kingdom?.conquest, { pay: "1020", fee: "20", kingGets: "920", poolGets: "100" });
  assert.deepEqual([d.kingdom?.clockSeconds, d.kingdom?.nextClockSeconds, d.kingdom?.floorSeconds], [600, 570, 120]);
  assert.deepEqual(d.kingdom?.protectAmounts, ["100", "500", "1000"]);
  assert.equal(d.kingdom?.protectsLeft, 2);
  assert.equal(d.kingdom?.previousKing, null);
  assert.equal(d.kingdom?.protectClosesInMs, 600_000 - LOCK);

  s.clock.advance(100_000);
  await executeAct(s.deps, GAME, body(s.world, "conquer"));
  d = desc();
  assert.equal(d.kingdom?.previousKing, previousOf(ALICE));
  assert.deepEqual([d.kingdom?.clockSeconds, d.kingdom?.nextClockSeconds], [570, 540]);

  await executeAct(s.deps, GAME, body(s.world, "protect", { amount: 1000n }));
  d = desc();
  assert.equal(d.kingdom?.value, "2000");
  assert.equal(d.kingdom?.protectsLeft, 1);
  assert.deepEqual(d.kingdom?.conquest, { pay: "2040", fee: "40", kingGets: "1840", poolGets: "200" });
  s.clock.advance(500_000); // 70 s left: protect closes in 40 s
  assert.equal(desc().kingdom?.protectClosesInMs, 40_000);
  s.clock.advance(60_000);
  assert.equal(desc().kingdom?.protectClosesInMs, 0);

  const maxed = await setup({ state: { ...conquered, value: 4950n }, pot: 3000n });
  const mc = maxed.view();
  const md = describeRound(GAME, maxed.manager.get(GAME.gameId), mc, maxed.clock.now(), maxed.manager.bellInfo(GAME.gameId, mc.passCount));
  assert.equal(md.kingdom?.wallsAtMaximum, true);
  assert.deepEqual(md.kingdom?.protectAmounts, []);
  const near = await setup({ state: { ...conquered, value: 4500n }, pot: 3000n });
  const nc = near.view();
  const nd = describeRound(GAME, near.manager.get(GAME.gameId), nc, near.clock.now(), near.manager.bellInfo(GAME.gameId, nc.passCount));
  assert.deepEqual(nd.kingdom?.protectAmounts, ["100", "500"]);
  assert.equal(nd.kingdom?.wallsAtMaximum, false);
  console.log("ok: the round description: prices, shares, protects left, allowed protect amounts, clocks, previous king, walls at maximum");
}

console.log("\nAll Kingdom act tests passed.");
process.exit(0);