import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Referee } from "../server/act.ts";
import type { ChainReader, ChainState } from "../server/chain.ts";
import { fakeClock } from "../server/clock.ts";
import { parseKingdomGameFile, type ServerGame } from "../server/games.ts";
import { createKeeper, settleRound } from "../server/keeper.ts";
import { makeLocks } from "../server/lock.ts";
import { RoundManager } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { makeUnconfirmed } from "../server/unconfirmed.ts";
import { NO_PREVIOUS, encodeKingdomCommitment, type KingdomState } from "../src/lib/kingdom.ts";
import { BELL_PRESETS, GRACE_SECONDS, KEEPER_DELAY_SECONDS } from "../src/refereeParams.ts";

const hex32 = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const KING = "11".repeat(20);
const GRACE = GRACE_SECONDS * 1000;
const KEEPER = KEEPER_DELAY_SECONDS * 1000;
const dir = mkdtempSync(join(tmpdir(), "funge-keeper-"));
let counter = 0;

const GAME: ServerGame = parseKingdomGameFile(
  {
    contractVersion: 3, network: "chipnet", gameCategory: hex32(0xa1), pusdCategory: hex32(0xb2), refereePubkey: "02" + "11".repeat(32),
    state: { address: "state", lockingBytecode: "aa20" + "01".repeat(32) + "87" },
    pot: { address: "pot", lockingBytecode: "aa20" + "02".repeat(32) + "87" },
    params: { openingPrice: "1000", feePercent: "2", cutPercent: "10", cap: "5000", protectsPerReign: 2, unit: "100", fallbackBlocks: 12 },
  },
  "chipnet",
);

async function setup(opts: { open?: boolean } = {}) {
  const { store } = await Store.open(join(dir, `s${counter++}.json`));
  const clock = fakeClock();
  const manager = new RoundManager(store, clock);
  manager.setBell(GAME.gameId, BELL_PRESETS.standard);
  const world = { passCount: 3, live: true, settles: 0, broadcasts: 0, fail: null as Error | null };
  const kingdomState = (): KingdomState => ({ passCount: world.passCount, holderPkh: KING, value: 1000n, protects: 0, previous: NO_PREVIOUS });
  const view = (): ChainState =>
    world.live
      ? {
          live: true, passCount: world.passCount, holderPkh: KING, potAmount: 1330n, stateTxid: hex32(1), stateVout: 0, stale: false, kingdom: kingdomState(),
          stateUtxo: { txid: hex32(1), vout: 0, satoshis: 2000n,
            token: { amount: 0n, category: GAME.gameId, nft: { capability: "mutable", commitment: encodeKingdomCommitment(kingdomState()) } } },
          potUtxo: { txid: hex32(2), vout: 0, satoshis: 2000n, token: { amount: 1330n, category: GAME.pusdCategory } },
        }
      : { live: false, passCount: world.passCount, holderPkh: KING, potAmount: null, stateTxid: null, stateVout: null, stateUtxo: null, potUtxo: null, stale: false, kingdom: null };
  const chain: ChainReader = { read: async () => view(), refresh: async () => view(), invalidate: () => undefined, last: () => view() };
  const referee: Referee = {
    sign: () => Uint8Array.of(1),
    settle: () => {
      world.settles++;
      return "00";
    },
    broadcast: async () => {
      if (world.fail) throw world.fail;
      world.broadcasts++;
      world.live = false;
      return hex32(77);
    },
  };
  const deps = { manager, chain, clock, referee, locks: makeLocks(), unconfirmed: makeUnconfirmed(40), sleep: async () => undefined };
  if (opts.open !== false) manager.applyKingdomAction(GAME.gameId, "conquer", 3);
  const deadline = () => manager.get(GAME.gameId).deadline!;
  const goOver = () => {
    clock.set(deadline() + GRACE);
    manager.observe(GAME.gameId, { live: true, passCount: 3 });
  };
  return { manager, clock, world, deps, deadline, goOver };
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

// 1. claim: refused while running, accepted once over, then the round is settled
{
  const s = await setup();
  await fails(settleRound(s.deps, GAME, "claim"), "not_over");
  s.clock.set(s.deadline() + GRACE - 1);
  await fails(settleRound(s.deps, GAME, "claim"), "not_over"); // still inside the grace
  s.goOver();
  const res = await settleRound(s.deps, GAME, "claim");
  assert.equal(res.cancelled, false);
  assert.equal(res.winner, KING);
  assert.equal(res.pot, "1330");
  const r = s.manager.get(GAME.gameId);
  assert.equal(r.status, "settled");
  const last = r.events.at(-1)!;
  assert.equal(last.type, "round_settled");
  assert.equal(last.reason, "claim");
  assert.equal(last.data?.txid, hex32(77));
  assert.deepEqual([last.data?.king, last.data?.treasury, last.data?.payout, last.data?.winner], [KING, "0", "1330", KING]); // empty after the payout; payout is what the winner got
  await fails(settleRound(s.deps, GAME, "claim"), "round_over");
  console.log("ok: claim waits for deadline + grace, then settles once");
}

// 2. two claims at once: one settles, one is told the round is over
{
  const s = await setup();
  s.goOver();
  const results = await Promise.allSettled([settleRound(s.deps, GAME, "claim"), settleRound(s.deps, GAME, "claim")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code, "round_over");
  assert.equal(s.world.broadcasts, 1);
  console.log("ok: simultaneous claims, one settlement");
}

// 3. keeper waits KEEPER_DELAY_SECONDS after the deadline
{
  const s = await setup();
  const keeper = createKeeper(s.deps, [GAME], () => undefined);
  s.goOver();
  await keeper.tick();
  assert.equal(s.world.settles, 0);
  s.clock.set(s.deadline() + KEEPER - 1);
  await keeper.tick();
  assert.equal(s.world.settles, 0);
  s.clock.set(s.deadline() + KEEPER);
  await keeper.tick();
  assert.equal(s.world.broadcasts, 1);
  assert.equal(s.manager.get(GAME.gameId).events.at(-1)?.reason, "keeper");
  console.log("ok: keeper settles after the delay, not before");
}

// 4. keeper retries after a failure, but not immediately
{
  const s = await setup();
  const keeper = createKeeper(s.deps, [GAME], () => undefined);
  s.goOver();
  s.clock.set(s.deadline() + KEEPER);
  s.world.fail = new Error("Failed to establish connection: WebSocket: 1006");
  await keeper.tick();
  assert.equal(s.world.settles, 1);
  s.clock.advance(5000);
  await keeper.tick();
  assert.equal(s.world.settles, 1); // waiting before the retry
  s.clock.advance(5001);
  s.world.fail = null;
  await keeper.tick();
  assert.equal(s.manager.get(GAME.gameId).status, "settled");
  console.log("ok: keeper retries after a pause");
}

// 5. a round nobody stole in has no deadline, so the keeper leaves it alone
{
  const s = await setup({ open: false });
  const keeper = createKeeper(s.deps, [GAME], () => undefined);
  s.clock.advance(10 * 60 * 60 * 1000);
  await keeper.tick();
  assert.equal(s.world.settles, 0);
  console.log("ok: waiting round is never auto-settled");
}

// 6. someone else already settled (fallback): typed error, round stays over for the watcher to settle in the record
{
  const s = await setup();
  s.goOver();
  s.world.fail = new Error("txn-mempool-conflict");
  await fails(settleRound(s.deps, GAME, "claim"), "state_changed");
  assert.equal(s.manager.get(GAME.gameId).status, "over");
  console.log("ok: lost settle race reported");
}
console.log("\nAll keeper tests passed.");
process.exit(0);