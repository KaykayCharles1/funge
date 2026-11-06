import { binToHex } from "@bitauth/libauth";
import type { SpendableUtxo } from "cashscript";

const MIN_FEE_COIN_SATS = 6_000n; // the inputs together need at least this much BCH, or a plain BCH coin is added for the fee
const SATS_PER_EXTRA_INPUT = 300n; // each extra input adds about 150 bytes, at 2 sats a byte
export const MAX_WALLET_INPUTS = 10; // the referee refuses a move with more wallet inputs than this (server/act.ts)

// The PUSD coins that pay `need`: the largest single coin when one is enough (as before), otherwise several, largest
// first, so that a wallet whose PUSD is split into small coins (refunds, change) can still play. At most `max` coins.
// Returns null when even `max` coins do not reach `need`.
export function pickPusd<T>(coins: T[], amountOf: (c: T) => bigint, need: bigint, max: number): T[] | null {
  const sorted = [...coins].sort((a, b) => (amountOf(a) < amountOf(b) ? 1 : -1));
  if (sorted.length > 0 && amountOf(sorted[0]!) >= need) return [sorted[0]!];
  const out: T[] = [];
  let sum = 0n;
  for (const c of sorted) {
    if (out.length >= max) break;
    out.push(c);
    sum += amountOf(c);
    if (sum >= need) return out;
  }
  return null;
}

// Whether coins carry enough BCH for the fee: the old one-coin rule, plus a little for each extra input
export const enoughBch = (sats: bigint, inputs: number) => sats >= MIN_FEE_COIN_SATS + SATS_PER_EXTRA_INPUT * BigInt(Math.max(0, inputs - 1));

export type ProtectCoinFailure = { ok: false; code: "no_funds" | "needs_bch" | "no_king_coin"; have: bigint };

// Chooses the wallet inputs of a protect. The contract wants INPUT 2 (the first wallet input) to sit at the king's address:
// that is the king's proof. It does not care what the coin holds. So the proof coin and the PUSD coins may be different
// coins, which matters for a wallet (WizardConnect) that keeps its PUSD on several addresses.
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
  const atKingAddress = (c: T) => binToHex(c.lock) === holderLock;
  const pusdOf = (c: T) => c.utxo.token!.amount;
  const bySats = (a: T, b: T) => (a.utxo.satoshis < b.utxo.satoshis ? 1 : -1);

  const pusdCoins = coins.filter(plainPusd);
  const have = pusdCoins.reduce((sum, c) => sum + pusdOf(c), 0n);
  // Room for the proof coin and a fee coin besides the PUSD coins
  const pusd = pickPusd(pusdCoins, pusdOf, amount, MAX_WALLET_INPUTS - 2);
  if (!pusd) return { ok: false, code: "no_funds", have };

  // coins at the king's address that can be spent without burning anything
  const atKing = coins.filter((c) => atKingAddress(c) && (bchOnly(c) || plainPusd(c)));
  if (atKing.length === 0) return { ok: false, code: "no_king_coin", have };

  let inputs: T[];
  const kingPusd = atKing.filter((c) => plainPusd(c) && pusdOf(c) >= amount).sort((a, b) => (pusdOf(a) < pusdOf(b) ? 1 : -1))[0];
  if (kingPusd) {
    inputs = [kingPusd]; // one coin does both jobs
  } else {
    const proofInPusd = pusd.find(atKingAddress);
    if (proofInPusd) {
      inputs = [proofInPusd, ...pusd.filter((c) => c !== proofInPusd)]; // a chosen PUSD coin is also the proof: it goes first
    } else {
      const proof = atKing.filter(bchOnly).sort(bySats)[0] ?? [...atKing].sort(bySats)[0]!;
      inputs = [proof, ...pusd];
    }
  }

  if (!enoughBch(inputs.reduce((sum, c) => sum + c.utxo.satoshis, 0n), inputs.length)) {
    const extra = coins.filter((c) => bchOnly(c) && !inputs.includes(c)).sort(bySats)[0];
    if (!extra) return { ok: false, code: "needs_bch", have };
    inputs.push(extra);
  }
  return { ok: true, inputs };
}
