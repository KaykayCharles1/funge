import { binToHex, hexToBin } from "@bitauth/libauth";

// Kingdom state commitment, 40 bytes (the CashTokens limit):
//   0-3 passCount | 4-23 holder key hash | 24-27 value | 28 protects used this reign | 29-39 previous king (first 11 key-hash bytes)
export type KingdomState = {
  passCount: number; // kings so far (open = 1); 0 = waiting
  holderPkh: string; // 40 hex characters
  value: bigint; // base units
  protects: number; // used this reign
  previous: string; // 22 hex characters
};

export const KINGDOM_COMMITMENT_BYTES = 40;
export const NO_PREVIOUS = "00".repeat(11);
export const WAITING_STATE: KingdomState = { passCount: 0, holderPkh: "00".repeat(20), value: 0n, protects: 0, previous: NO_PREVIOUS };

// Numbers are stored little-endian; below 2^(8n-1) so the script-number sign bit stays 0
function writeLe(n: bigint, bytes: number): string {
  if (n < 0n || n >= 1n << BigInt(8 * bytes - 1)) throw new Error(`${n} does not fit in ${bytes} byte(s)`);
  const out = new Uint8Array(bytes);
  let x = n;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return binToHex(out);
}

function readLe(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}

export function encodeKingdomCommitment(s: KingdomState): string {
  if (!/^[0-9a-f]{40}$/i.test(s.holderPkh)) throw new Error("holderPkh must be 40 hex characters");
  if (!/^[0-9a-f]{22}$/i.test(s.previous)) throw new Error("previous must be 22 hex characters");
  return (
    writeLe(BigInt(s.passCount), 4) + s.holderPkh.toLowerCase() + writeLe(s.value, 4) + writeLe(BigInt(s.protects), 1) + s.previous.toLowerCase()
  );
}

export function decodeKingdomCommitment(hex: string): KingdomState {
  const b = hexToBin(hex);
  if (b.length !== KINGDOM_COMMITMENT_BYTES) throw new Error(`A kingdom commitment is 40 bytes, got ${b.length}`);
  return {
    passCount: Number(readLe(b.slice(0, 4))),
    holderPkh: binToHex(b.slice(4, 24)),
    value: readLe(b.slice(24, 28)),
    protects: Number(readLe(b.slice(28, 29))),
    previous: binToHex(b.slice(29, 40)),
  };
}

// What the contract writes into the previous-king field when a king is dethroned
export const previousOf = (holderPkh: string): string => holderPkh.slice(0, 22).toLowerCase();

// The conquest money rule. Integer math, the same as the contract: the pool takes the remainder.
export function conquestMoney(value: bigint, p: { feePercent: bigint; cutPercent: bigint }) {
  const fee = (value * p.feePercent) / 100n;
  const payment = value + fee;
  const kingGets = (value * (100n - p.cutPercent)) / 100n + fee;
  return { fee, payment, kingGets, poolGets: payment - kingGets };
}

// The three protect amounts: 1, 5 and 10 PUSD
export const protectAmounts = (unit: bigint): bigint[] => [unit, unit * 5n, unit * 10n];