import type { ElectrumNetworkProvider, Utxo } from "cashscript";
import { decodeKingdomCommitment, type KingdomState } from "../src/lib/kingdom.ts";
import { retry } from "../src/lib/retry.ts";
import type { Clock } from "./clock.ts";
import type { ServerGame } from "./games.ts";

export type ChainState = {
  live: boolean; // the state coin exists
  passCount: number;
  holderPkh: string | null;
  potAmount: bigint | null;
  stateTxid: string | null;
  stateVout: number | null;
  stateUtxo: Utxo | null;
  potUtxo: Utxo | null;
  stale: boolean; // true when this is the last good answer because a fresh read failed
  kingdom: KingdomState | null; // the decoded 40-byte state; null once the state coin is gone
};

export type ChainReader = {
  read: (game: ServerGame) => Promise<ChainState>; // cached for a short time
  refresh: (game: ServerGame) => Promise<ChainState>; // always asks the network
  invalidate: (gameId: string) => void;
  last: (gameId: string) => ChainState | undefined;
};

export function makeChainReader(provider: ElectrumNetworkProvider, clock: Clock, ttlMs = 2000): ChainReader {
  const good = new Map<string, ChainState>();
  const fetchedAt = new Map<string, number>();
  const inflight = new Map<string, Promise<ChainState>>();
  const emptyStreak = new Map<string, number>();

  async function fetchOnce(game: ServerGame): Promise<ChainState> {
    const id = game.gameId;
    const [states, pots] = await Promise.all([
      retry(() => provider.getUtxos(game.stateAddress)),
      retry(() => provider.getUtxos(game.potAddress)),
    ]);
    const s = states.find((u) => u.token?.nft && u.token.category === game.gameId);
    // While waiting the pot holds no PUSD, and strangers can send coins to the pot address, so the pot is exactly
    // output 1 of the transaction that created the state coin.
    const p = s && pots.find((u) => u.txid === s.txid && u.vout === 1);
    const prev = good.get(id);
    if (!s || !s.token?.nft) {
      // A missing state coin must be seen twice before we believe it (flaky servers)
      const streak = (emptyStreak.get(id) ?? 0) + 1;
      emptyStreak.set(id, streak);
      if (streak < 2) {
        if (prev) return { ...prev, stale: true };
        throw new Error("state coin not found yet, confirming");
      }
      return {
        live: false, passCount: prev?.passCount ?? 0, holderPkh: prev?.holderPkh ?? null,
        potAmount: null, stateTxid: null, stateVout: null, stateUtxo: null, potUtxo: null, stale: false, kingdom: null,
      };
    }
    emptyStreak.set(id, 0);
    const k = decodeKingdomCommitment(s.token.nft.commitment);
    return {
      live: true, passCount: k.passCount, holderPkh: k.passCount > 0 ? k.holderPkh : null,
      potAmount: p ? (p.token?.amount ?? 0n) : null, // a waiting pot is a BCH-only coin: 0 PUSD
      stateTxid: s.txid, stateVout: s.vout, stateUtxo: s, potUtxo: p ?? null, stale: false, kingdom: k,
    };
  }

  const store = (id: string, v: ChainState) => {
    good.set(id, v);
    fetchedAt.set(id, clock.now());
    return v;
  };

  return {
    async read(game) {
      const id = game.gameId;
      const cached = good.get(id);
      const at = fetchedAt.get(id);
      if (cached && at !== undefined && clock.now() - at < ttlMs) return cached;
      let p = inflight.get(id);
      if (!p) {
        p = fetchOnce(game)
          .then((v) => store(id, v))
          .finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
      try {
        return await p;
      } catch (e) {
        if (cached) return { ...cached, stale: true };
        throw e;
      }
    },
    async refresh(game) {
      return store(game.gameId, await fetchOnce(game));
    },
    invalidate: (gameId) => void fetchedAt.delete(gameId),
    last: (gameId) => good.get(gameId),
  };
}