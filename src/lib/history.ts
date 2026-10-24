import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import { scriptHash } from "./chain.ts";
import { decodeCommitment } from "./commitment.ts";
import type { Game } from "./game.ts";
import { retry } from "./retry.ts";

export type Frame = { txid: string; passCount: number; holderPkh: string; pot: bigint };

const cache = new Map<string, Frame | null>(); // transactions never change, so cache them

export async function loadRecentFrames(game: Game, provider: ElectrumNetworkProvider, limit = 6): Promise<Frame[]> {
  const hash = await scriptHash(game.state.lockingBytecode);
  const history: unknown = await retry(() => provider.performRequest("blockchain.scripthash.get_history", hash));
  if (!Array.isArray(history)) return [];
  const txids = (history as { tx_hash?: string }[])
    .map((h) => h.tx_hash)
    .filter((t): t is string => !!t)
    .slice(-limit);

  await Promise.all(
    txids
      .filter((t) => !cache.has(t))
      .map(async (txid) => {
        const tx = decodeTransaction(hexToBin(await retry(() => provider.getRawTransaction(txid))));
        if (typeof tx === "string") return void cache.set(txid, null);
        const stateOut = tx.outputs.find((o) => binToHex(o.lockingBytecode) === game.state.lockingBytecode && o.token?.nft);
        const potOut = tx.outputs.find((o) => binToHex(o.lockingBytecode) === game.pot.lockingBytecode && o.token);
        if (!stateOut?.token?.nft || !potOut?.token) return void cache.set(txid, null); // e.g. the settlement
        const c = decodeCommitment(binToHex(stateOut.token.nft.commitment));
        cache.set(txid, { txid, passCount: c.passCount, holderPkh: c.holderPkh, pot: potOut.token.amount });
      }),
  );
  return txids.map((t) => cache.get(t)).filter((f): f is Frame => !!f);
}