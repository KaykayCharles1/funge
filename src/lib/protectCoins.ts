import { binToHex } from "@bitauth/libauth";
import type { SpendableUtxo } from "cashscript";

const MIN_FEE_COIN_SATS = 6_000n; // the inputs together need at least this much BCH, or a plain BCH coin is added for the fee

export type ProtectCoinFailure = { ok: false; code: "no_funds" | "needs_bch" | "no_king_coin"; have: bigint };

// Chooses the wallet inputs of a protect. The contract wants INPUT 2 (the first wallet input) to sit at the king's address:
// that is the king's proof. It does not care what the coin holds. So the proof coin and the PUSD coin may be two
// different coins, which matters for a wallet (WizardConnect) that keeps its PUSD on several addresses.
// A coin carrying an NFT or another token is never chosen: spending it would burn that token (the trophy, say).
export function pickProtectCoins<T extends { utxo: SpendableUtxo; lock: Uint8Array }>(
  coins: T[],
  holderPkh: string,
  pusdCategory: string,
  amount: bigint,
): { ok: true; inputs: T[] } | ProtectCoinFailure {
  const holderLock = `76a914${holderPkh}88ac`;
  const plainPusd = (c: T) => !!c.utxo.token && c.utxo.token.category === pusdCategory && !c.utxo.token.nft;
  const bchOnly = (c: T) => !c.utxo.token;
  const byPusd = (a: T, b: T) => (a.utxo.token!.amount < b.utxo.token!.amount ? 1 : -1);
  const bySats = (a: T, b: T) => (a.utxo.satoshis < b.utxo.satoshis ? 1 : -1);

  const pusdCoins = coins.filter(plainPusd);
  const have = pusdCoins.reduce((sum, c) => sum + c.utxo.token!.amount, 0n);
  const pusdCoin = pusdCoins.filter((c) => c.utxo.token!.amount >= amount).sort(byPusd)[0];
  if (!pusdCoin) return { ok: false, code: "no_funds", have };

  // coins at the king's address that can be spent without burning anything
  const atKing = coins.filter((c) => binToHex(c.lock) === holderLock && (bchOnly(c) || plainPusd(c)));
  if (atKing.length === 0) return { ok: false, code: "no_king_coin", have };

  const kingPusd = atKing.filter((c) => plainPusd(c) && c.utxo.token!.amount >= amount).sort(byPusd)[0];
  let inputs: T[];
  if (kingPusd) {
    inputs = [kingPusd]; // one coin does both jobs
  } else {
    const proof = atKing.filter(bchOnly).sort(bySats)[0] ?? [...atKing].sort(bySats)[0]!;
    inputs = [proof, pusdCoin];
  }

  if (inputs.reduce((sum, c) => sum + c.utxo.satoshis, 0n) < MIN_FEE_COIN_SATS) {
    const extra = coins.filter((c) => bchOnly(c) && !inputs.includes(c)).sort(bySats)[0];
    if (!extra) return { ok: false, code: "needs_bch", have };
    inputs.push(extra);
  }
  return { ok: true, inputs };
}