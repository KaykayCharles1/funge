import type { EndedRound } from "../ended.ts";

export type CachedState = { passCount: number; holderPkh: string; pot: bigint; blocktime: number | null };

type StoredState = { passCount: number; holderPkh: string; pot: string; blocktime: number | null };
type StoredEnded = { settleTxid: string; winnerPkh: string; potPaid: string; passes: number; confirmed: boolean };

// Only public chain data is cached here. Never keys or seed phrases.
const stateKey = (category: string) => `funge:state:${category}`;
const endedKey = (category: string) => `funge:ended:${category}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked or full: caching is optional
  }
}

export function loadCachedState(category: string): CachedState | null {
  const s = read<StoredState>(stateKey(category));
  if (!s || typeof s.passCount !== "number" || typeof s.holderPkh !== "string") return null;
  try {
    return { passCount: s.passCount, holderPkh: s.holderPkh, pot: BigInt(s.pot), blocktime: s.blocktime ?? null };
  } catch {
    return null;
  }
}

export function saveState(category: string, s: CachedState) {
  write(stateKey(category), { ...s, pot: s.pot.toString() });
}

export function loadCachedEnded(category: string): EndedRound | null {
  const e = read<StoredEnded>(endedKey(category));
  if (!e || typeof e.settleTxid !== "string") return null;
  try {
    return { settleTxid: e.settleTxid, winnerPkh: e.winnerPkh, potPaid: BigInt(e.potPaid), passes: e.passes, confirmed: e.confirmed };
  } catch {
    return null;
  }
}

export function saveEnded(category: string, e: EndedRound) {
  write(endedKey(category), { ...e, potPaid: e.potPaid.toString() });
}