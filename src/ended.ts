import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import { decodeCommitment } from "./lib/commitment.ts";
import type { Game } from "./lib/game.ts";
import { retry } from "./lib/retry.ts";
import { scriptHash } from "./lib/chain.ts";

export type EndedRound = {
  settleTxid: string;
  winnerPkh: string;
  potPaid: bigint;
  passes: number;
  confirmed: boolean;
};

const notSettlement = new Set<string>(); // grabs never change, so each one is read once

// Returns the settled round's details, or null if no settlement is visible yet
export async function findEndedRound(game: Pick<Game, "state">, provider: ElectrumNetworkProvider): Promise<EndedRound | null> {
  const hash = await scriptHash(game.state.lockingBytecode);
  const history: unknown = await retry(() => provider.performRequest("blockchain.scripthash.get_history", hash));
  if (!Array.isArray(history) || history.length === 0) return null;

  // Unconfirmed transactions can be listed out of order, so check the newest ones for the settlement
  const recent = (history as { tx_hash?: string; height?: number }[]).slice(-50).reverse();
  for (const entry of recent) {
    const txid = entry.tx_hash;
    if (!txid || notSettlement.has(txid)) continue;

    const raw = await retry(() => provider.getRawTransaction(txid));
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === "string") continue;

    // A grab recreates the state contract output; a settlement does not
    if (tx.outputs.some((o) => binToHex(o.lockingBytecode) === game.state.lockingBytecode)) {
      notSettlement.add(txid);
      continue;
    }
    const [payout, trophy] = tx.outputs;
    if (!payout?.token || !trophy?.token?.nft || payout.lockingBytecode.length !== 25) {
      notSettlement.add(txid);
      continue;
    }
    return {
      settleTxid: txid,
      winnerPkh: binToHex(payout.lockingBytecode.slice(3, 23)), // P2PKH: 76 a9 14 <pkh> 88 ac
      potPaid: payout.token.amount,
      passes: decodeCommitment(binToHex(trophy.token.nft.commitment)).passCount,
      confirmed: (entry.height ?? 0) > 0,
    };
  }
  return null;
}