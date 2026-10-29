import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binToHex, decodeTransaction, encodeTransaction, hexToBin } from "@bitauth/libauth";
import type { Transaction } from "@bitauth/libauth";
import { executeAct, type Referee } from "../server/act.ts";
import type { ChainReader, ChainState } from "../server/chain.ts";
import { fakeClock } from "../server/clock.ts";
import type { ServerGame } from "../server/games.ts";
import { makeLocks } from "../server/lock.ts";
import { RoundManager } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { makeUnconfirmed } from "../server/unconfirmed.ts";
import { encodeCommitment } from "../src/lib/commitment.ts";
import { GRACE_SECONDS, RESET_SECONDS } from "../src/refereeParams.ts";

const hex32 = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const KING = "11".repeat(20);
const ALICE = "22".repeat(20);
const WALLET_LOCK = "76a914" + "33".repeat(20) + "88ac";
const RESET = RESET_SECONDS.steal * 1000;
const GRACE = GRACE_SECONDS * 1000;
const dir = mkdtempSync(join(tmpdir(), "funge-act-"));
let counter = 0;

const GAME: ServerGame = {
  gameId: hex32(0xa1), network: "chipnet", pusdCategory: hex32(0xb2), refereePubkey: "02" + "11".repeat(32),
  stateAddress: "state", potAddress: "pot",
  stateLockingBytecode: "aa20" + "01".repeat(32) + "87", potLockingBytecode: "aa20" + "02".repeat(32) + "87",
  basePrice: 100n, priceStep: 10n, fallbackBlocks: 12, waitingFallbackBlocks: 144,
};

async function setup(opts: { cap?: number } = {}) {
  const { store } = await Store.open(join(dir, `s${counter++}.json`));
  const clock = fakeClock();
  const manager = new RoundManager(store, clock);
  const world = { passCount: 0, stateTxid: hex32(1), potTxid: hex32(2), potAmount: 1000n, next: 10, broadcasts: [] as string[], fail: null as Error | null };
  const price = () => GAME.basePrice + GAME.priceStep * BigInt(world.passCount);
  const view = (): ChainState => ({
    live: true, passCount: world.passCount, holderPkh: KING, potAmount: world.potAmount,
    stateTxid: world.stateTxid, stateVout: 0, stale: false,
    stateUtxo: { txid: world.stateTxid, vout: 0, satoshis: 2000n,
      token: { amount: 0n, category: GAME.gameId, nft: { capability: "mutable", commitment: encodeCommitment(world.passCount, KING) } } },
    potUtxo: { txid: world.potTxid, vout: 0, satoshis: 2000n, token: { amount: world.potAmount, category: GAME.pusdCategory } },
  });
  const chain: ChainReader = { read: async () => view(), refresh: async () => view(), invalidate: () => undefined, last: () => view() };
  const referee: Referee = {
    sign: () => Uint8Array.of(1, 2, 3),
    broadcast: async (hex) => {
      if (world.fail) throw world.fail;
      world.broadcasts.push(hex);
      world.potAmount += price();
      world.passCount += 1;
      world.stateTxid = hex32(world.next++);
      world.potTxid = hex32(world.next++);
      return hex32(world.next++);
    },
  };
  const unconfirmed = makeUnconfirmed(opts.cap ?? 40);
  const deps = { manager, chain, clock, referee, locks: makeLocks(), unconfirmed, sleep: async () => undefined };
  return { manager, clock, world, unconfirmed, deps, price };
}
type World = Awaited<ReturnType<typeof setup>>["world"];

function steal(world: World, o: { potDelta?: bigint; unsigned?: boolean; badOut0?: boolean; stateTxid?: string; garbage?: boolean; action?: string } = {}) {
  const price = GAME.basePrice + GAME.priceStep * BigInt(world.passCount);
  const walletTxid = hex32(200);
  const input = (txid: string, bytes: Uint8Array) => ({ outpointTransactionHash: hexToBin(txid), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: bytes });
  const tx: Transaction = {
    version: 2, locktime: 0,
    inputs: [
      input(o.stateTxid ?? world.stateTxid, Uint8Array.of(0)),
      input(world.potTxid, Uint8Array.of(0)),
      input(walletTxid, o.unsigned ? new Uint8Array(0) : new Uint8Array(100).fill(7)),
    ],
    outputs: [
      { lockingBytecode: hexToBin(o.badOut0 ? GAME.potLockingBytecode : GAME.stateLockingBytecode), valueSatoshis: 2000n,
        token: { amount: 0n, category: hexToBin(GAME.gameId), nft: { capability: "mutable", commitment: hexToBin(encodeCommitment(world.passCount + 1, ALICE)) } } },
      { lockingBytecode: hexToBin(GAME.potLockingBytecode), valueSatoshis: 2000n,
        token: { amount: world.potAmount + price + (o.potDelta ?? 0n), category: hexToBin(GAME.pusdCategory) } },
      { lockingBytecode: hexToBin(WALLET_LOCK), valueSatoshis: 1000n },
    ],
  };
  return {
    action: o.action ?? "steal",
    txHex: o.garbage ? "00" : binToHex(encodeTransaction(tx)),
    walletInputs: [{ txid: walletTxid, vout: 0, satoshis: "5000", lockingBytecode: WALLET_LOCK, token: { amount: String(price), category: GAME.pusdCategory } }],
  };
}

async function fails(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    assert.equal((e as { code?: string }).code, code, `expected ${code}, got: ${(e as Error).message}`);
    return;
  }
  assert.fail(`expected ${code}, but the call succeeded`);
}

// 1. a good steal on a waiting round opens the clock and signs input 0
{
  const s = await setup();
  const res = await executeAct(s.deps, GAME, steal(s.world));
  assert.equal(res.passCount, 1);
  const r = s.manager.get(GAME.gameId);
  assert.equal(r.status, "open");
  assert.equal(r.deadline, s.clock.now() + RESET);
  assert.equal(r.events.at(-1)?.reason, "steal");
  assert.equal(r.events.at(-1)?.data?.txid, res.txid);
  const sent = decodeTransaction(hexToBin(s.world.broadcasts[0]!)) as Transaction;
  assert.deepEqual([...sent.inputs[0]!.unlockingBytecode], [1, 2, 3]);
  assert.equal(sent.inputs[2]!.unlockingBytecode.length, 100); // wallet signature untouched
  console.log("ok: good steal opens the clock; referee bytes in input 0, wallet input untouched");
}

// 2. duplicate submit
{
  const s = await setup();
  const body = steal(s.world);
  await executeAct(s.deps, GAME, body);
  await fails(executeAct(s.deps, GAME, body), "state_changed");
  console.log("ok: duplicate submit refused");
}

// 3. two at once: exactly one wins
{
  const s = await setup();
  const body = steal(s.world);
  const results = await Promise.allSettled([executeAct(s.deps, GAME, body), executeAct(s.deps, GAME, body)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(lost.reason.code, "state_changed");
  assert.equal(s.world.broadcasts.length, 1);
  console.log("ok: simultaneous submits, one winner");
}

// 4. deadline: accepted inside the grace, too_late after, then round_over
{
  const s = await setup();
  await executeAct(s.deps, GAME, steal(s.world));
  const d1 = s.manager.get(GAME.gameId).deadline!;
  s.clock.set(d1 + GRACE - 1);
  await executeAct(s.deps, GAME, steal(s.world)); // 999 ms late is inside the grace
  const d2 = s.manager.get(GAME.gameId).deadline!;
  assert.equal(d2, d1 + GRACE - 1 + RESET);
  s.clock.set(d2 + GRACE);
  await fails(executeAct(s.deps, GAME, steal(s.world)), "too_late");
  await fails(executeAct(s.deps, GAME, steal(s.world)), "round_over");
  assert.equal(s.world.broadcasts.length, 2);
  console.log("ok: grace accepted, then too_late, then round_over");
}

// 5. invalid requests
{
  const s = await setup();
  await fails(executeAct(s.deps, GAME, steal(s.world, { potDelta: 1n })), "invalid");
  await fails(executeAct(s.deps, GAME, steal(s.world, { unsigned: true })), "invalid");
  await fails(executeAct(s.deps, GAME, steal(s.world, { badOut0: true })), "invalid");
  await fails(executeAct(s.deps, GAME, steal(s.world, { garbage: true })), "invalid");
  await fails(executeAct(s.deps, GAME, steal(s.world, { action: "settle" })), "invalid");
  await fails(executeAct(s.deps, GAME, { nonsense: true }), "invalid");
  await fails(executeAct(s.deps, GAME, steal(s.world, { stateTxid: hex32(99) })), "state_changed");
  assert.equal(s.world.broadcasts.length, 0);
  console.log("ok: invalid and stale requests refused, nothing broadcast");
}

// 6. paused clock
{
  const s = await setup();
  s.manager.pause(GAME.gameId, "manual");
  await fails(executeAct(s.deps, GAME, steal(s.world)), "paused");
  console.log("ok: paused round refuses steals");
}

// 7. unconfirmed cap: refuse, pause, then recover on the next block
{
  const s = await setup({ cap: 2 });
  await executeAct(s.deps, GAME, steal(s.world));
  await executeAct(s.deps, GAME, steal(s.world));
  await fails(executeAct(s.deps, GAME, steal(s.world)), "network_busy");
  assert.equal(s.manager.get(GAME.gameId).paused?.reason, "network_busy");
  s.unconfirmed.resetAll();
  s.manager.resume(GAME.gameId, "network_ok");
  await executeAct(s.deps, GAME, steal(s.world));
  console.log("ok: cap pauses the round and a new block lifts it");
}

// 8. what the node can say at broadcast
{
  const s = await setup();
  s.world.fail = new Error("txn-mempool-conflict");
  await fails(executeAct(s.deps, GAME, steal(s.world)), "state_changed");
  s.world.fail = new Error("Failed to establish connection: WebSocket: 1006");
  await fails(executeAct(s.deps, GAME, steal(s.world)), "outcome_unknown");
  assert.equal(s.manager.get(GAME.gameId).deadline, null); // clock untouched
  s.world.fail = new Error("too-long-mempool-chain");
  await fails(executeAct(s.deps, GAME, steal(s.world)), "network_busy");
  assert.equal(s.manager.get(GAME.gameId).paused?.reason, "network_busy");
  console.log("ok: broadcast errors mapped");
}

// 9. our own last steal not yet visible on the chain view
{
  const s = await setup();
  s.manager.get(GAME.gameId).seenPassCount = 5;
  await fails(executeAct(s.deps, GAME, steal(s.world)), "chain_unavailable");
  console.log("ok: stale chain view refused");
}
console.log("\nAll act tests passed.");
process.exit(0);