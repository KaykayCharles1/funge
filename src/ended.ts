import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import { decodeCommitment } from "./lib/commitment.ts";
import type { Game } from "./lib/game.ts";
import { retry } from "./lib/retry.ts";

export type EndedRound = {
  settleTxid: string;
  winnerPkh: string;
  potPaid: bigint;
  passes: number;
  confirmed: boolean;
};

// Electrum identifies a script by the reversed SHA-256 of its locking bytecode
async function scriptHash(lockingBytecodeHex: string): Promise<string> {
  const bytes = new Uint8Array(hexToBin(lockingBytecodeHex)); // copy into a plain ArrayBuffer for WebCrypto
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return binToHex(new Uint8Array(digest).reverse());
}

// Returns the settled round's details, or null if the last transaction is not a settlement
export async function findEndedRound(game: Game, provider: ElectrumNetworkProvider): Promise<EndedRound | null> {
  const hash = await scriptHash(game.state.lockingBytecode);
  const history: unknown = await retry(() => provider.performRequest("blockchain.scripthash.get_history", hash));
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1] as { tx_hash?: string; height?: number };
  if (!last.tx_hash) return null;

  const raw = await retry(() => provider.getRawTransaction(last.tx_hash!));
  const tx = decodeTransaction(hexToBin(raw));
  if (typeof tx === "string") return null;

  // A grab recreates the state contract output; a settlement does not
  if (tx.outputs.some((o) => binToHex(o.lockingBytecode) === game.state.lockingBytecode)) return null;

  const [payout, trophy] = tx.outputs;
  if (!payout?.token || !trophy?.token?.nft || payout.lockingBytecode.length !== 25) return null;

  return {
    settleTxid: last.tx_hash,
    winnerPkh: binToHex(payout.lockingBytecode.slice(3, 23)), // P2PKH: 76 a9 14 <pkh> 88 ac
    potPaid: payout.token.amount,
    passes: decodeCommitment(binToHex(trophy.token.nft.commitment)).passCount,
    confirmed: (last.height ?? 0) > 0,
  };
}