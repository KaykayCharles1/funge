import { KEEPER_DELAY_SECONDS } from "../src/refereeParams.ts";
import { ActError, mapBroadcastError, type ActDeps } from "./act.ts";
import type { ChainState } from "./chain.ts";
import type { ServerGame } from "./games.ts";

export type SettleResult = {
  txid: string;
  winner: string | null;
  passCount: number;
  pot: string | null;
  cancelled: boolean; // pass count 0: nobody stole, the seed went back to the creator
  serverNow: number;
  lastSeq: number;
};

// Settles a round that is over. Used by the Claim button and by the keeper. The contract pays the holder
// whoever asks, so no login is needed. Nothing is signed before the round is "over" (deadline + grace).
export async function settleRound(deps: ActDeps, game: ServerGame, by: "claim" | "keeper"): Promise<SettleResult> {
  const id = game.gameId;
  return deps.locks(id, async () => {
    const { manager, chain, clock } = deps;
    if (manager.get(id).status === "settled") throw new ActError("round_over", "The round is already settled.");
    let c: ChainState;
    try {
      c = await chain.refresh(game);
    } catch {
      throw new ActError("chain_unavailable", "Could not read the chain. Try again in a moment.");
    }
    const round = manager.observe(id, { live: c.live, passCount: c.passCount });
    if (round.status === "settled" || !c.live) throw new ActError("round_over", "The round is already settled.");
    if (round.status !== "over") throw new ActError("not_over", "The round is still running.");
    if (round.paused) throw new ActError("paused", "The clock is paused. Try again shortly.");

    const hex = deps.referee.settle(game, c);
    let txid: string;
    try {
      txid = await deps.referee.broadcast(hex);
    } catch (e) {
      const err = mapBroadcastError(e, deps, id, false); // the round is over; never pause it
      if (err.code === "state_changed") chain.invalidate(id);
      throw err;
    }
    const r = manager.markSettled(id, txid, by, {
      winner: c.holderPkh,
      passCount: c.passCount,
      pot: c.potAmount === null ? null : c.potAmount.toString(),
      cancelled: c.passCount === 0,
    });
    chain.invalidate(id);
    return {
      txid, winner: c.holderPkh, passCount: c.passCount,
      pot: c.potAmount === null ? null : c.potAmount.toString(),
      cancelled: c.passCount === 0, serverNow: clock.now(), lastSeq: r.nextSeq - 1,
    };
  });
}

// Settles by itself once a round has been over for KEEPER_DELAY_SECONDS.
export function createKeeper(deps: ActDeps, games: ServerGame[], log: (m: string) => void = console.log) {
  const retryAt = new Map<string, number>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const g of games) {
        const r = deps.manager.get(g.gameId);
        const now = deps.clock.now();
        if (r.status !== "over" || r.deadline === null || r.paused) continue;
        if (now < r.deadline + KEEPER_DELAY_SECONDS * 1000) continue;
        if (now < (retryAt.get(g.gameId) ?? 0)) continue;
        try {
          const res = await settleRound(deps, g, "keeper");
          retryAt.delete(g.gameId);
          log(`keeper settled round ${g.gameId.slice(0, 8)}…: ${res.txid}`);
        } catch (e) {
          if (e instanceof ActError && e.code === "round_over") continue;
          retryAt.set(g.gameId, now + 10_000);
          log(`keeper could not settle ${g.gameId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(): () => void {
      const timer = setInterval(() => void tick(), 1000);
      return () => clearInterval(timer);
    },
  };
}