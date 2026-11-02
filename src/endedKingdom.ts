import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import { scriptHash } from "./lib/chain.ts";
import type { GameKingdom } from "./lib/game.ts";
import { decodeKingdomCommitment } from "./lib/kingdom.ts";
import { retry } from "./lib/retry.ts";

export type EndedKingdom = {
  settleTxid: string;
  winnerPkh: string;
  potPaid: bigint;
  passes: number; // kings crowned, including the opener
  value: bigint; // the throne's final value
  confirmed: boolean;
};

const notSettlement = new Set<string>(); // actions never change, so each transaction is read once

// Returns the settled Kingdom round's details, or null if no settlement is visible yet.
// A settlement does not recreate the state contract output; it pays the pool to the king (output 0) and sends the trophy (output 1).
export async function findEndedKingdom(game: Pick<GameKingdom, "state">, provider: ElectrumNetworkProvider): Promise<EndedKingdom | null> {
  const hash = await scriptHash(game.state.lockingBytecode);
  const history: unknown = await retry(() => provider.performRequest("blockchain.scripthash.get_history", hash));
  if (!Array.isArray(history) || history.length === 0) return null;

  const recent = (history as { tx_hash?: string; height?: number }[]).slice(-50).reverse();
  for (const entry of recent) {
    const txid = entry.tx_hash;
    if (!txid || notSettlement.has(txid)) continue;

    const raw = await retry(() => provider.getRawTransaction(txid));
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === "string") continue;

    if (tx.outputs.some((o) => binToHex(o.lockingBytecode) === game.state.lockingBytecode)) {
      notSettlement.add(txid);
      continue;
    }
    const [payout, trophy] = tx.outputs;
    if (!payout?.token || !trophy?.token?.nft || payout.lockingBytecode.length !== 25) {
      notSettlement.add(txid);
      continue;
    }
    const final = decodeKingdomCommitment(binToHex(trophy.token.nft.commitment)); // the trophy keeps the final state
    return {
      settleTxid: txid,
      winnerPkh: binToHex(payout.lockingBytecode.slice(3, 23)), // P2PKH: 76 a9 14 <pkh> 88 ac
      potPaid: payout.token.amount,
      passes: final.passCount,
      value: final.value,
      confirmed: (entry.height ?? 0) > 0,
    };
  }
  return null;
}