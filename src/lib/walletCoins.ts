import { binToHex, hash160, sha256 } from "@bitauth/libauth";
import { PATH_CHANGE, PATH_RECEIVE, childIndexOfPathName } from "@wizardconnect/core";
import type { ElectrumNetworkProvider, SpendableUtxo } from "cashscript";
import { manager } from "../bch_wallet.ts";
import { lockToAddress, p2pkhLock } from "./chain.ts";
import { retry } from "./retry.ts";

export type WalletCoin = {
  utxo: SpendableUtxo;
  path: string; // "receive" or "change"
  index: number; // address index on that path
  lock: Uint8Array;
  address: string;
  tokenAddress: string;
};

// A wallet app gives every payment a fresh address, so an own wallet's coins can sit far along its receive and change
// paths. Like wallet apps, look along each path until GAP addresses in a row have never been used (no history).
const GAP = 20;
const MAX_INDEX = 400; // a safety stop
// How far each wallet's used addresses reach (by its first key), so the next look asks for all of them in one go
const reach = new Map<string, Record<string, number>>();

type Provider = Pick<ElectrumNetworkProvider, "getUtxosForLockingBytecode" | "performRequest">;
type PubkeyAt = (child: number, index: bigint) => Uint8Array | undefined;

// Electrum's name for an address: the sha256 of its locking script, byte-reversed, in hex
const scripthash = (lock: Uint8Array) => binToHex(sha256.hash(lock).slice().reverse());

// The coins on one address, and whether it was ever used. Up to the last address already known to be used, the
// history is not asked again: those addresses only need their coins.
async function look(provider: Provider, lock: Uint8Array, knownUsed: boolean): Promise<{ used: boolean; utxos: SpendableUtxo[] }> {
  const [history, utxos] = await Promise.all([
    knownUsed ? Promise.resolve(null) : retry(() => provider.performRequest("blockchain.scripthash.get_history", scripthash(lock))),
    retry(() => provider.getUtxosForLockingBytecode(lock)),
  ]);
  return { used: knownUsed || (Array.isArray(history) && history.length > 0) || utxos.length > 0, utxos };
}

// Every coin of a wallet whose keys pubkeyAt gives (tests pass their own keys; the game uses the connected wallet)
export async function scanWalletCoins(provider: Provider, pubkeyAt: PubkeyAt): Promise<WalletCoin[]> {
  const first = pubkeyAt(childIndexOfPathName(PATH_RECEIVE)!, 0n);
  if (!first) return [];
  const id = binToHex(first);
  const known = reach.get(id) ?? {};
  const found: WalletCoin[] = [];
  await Promise.all(
    [PATH_RECEIVE, PATH_CHANGE].map(async (path) => {
      const child = childIndexOfPathName(path);
      if (child === undefined) return;
      const before = known[path] ?? -1; // how far this wallet reached last time
      let lastUsed = before;
      let next = 0;
      // Ask for everything up to GAP past the last used address, all at once; repeat while new used ones turn up
      while (next <= lastUsed + GAP && next < MAX_INDEX) {
        const end = Math.min(lastUsed + GAP, MAX_INDEX - 1);
        const batch: { index: number; lock: Uint8Array }[] = [];
        for (let i = next; i <= end; i++) {
          const pubkey = pubkeyAt(child, BigInt(i));
          if (pubkey) batch.push({ index: i, lock: p2pkhLock(hash160(pubkey)) });
        }
        next = end + 1;
        const results = await Promise.all(batch.map((t) => look(provider, t.lock, t.index <= before)));
        results.forEach((r, k) => {
          const t = batch[k]!;
          if (r.used) lastUsed = Math.max(lastUsed, t.index);
          for (const utxo of r.utxos) {
            found.push({
              utxo, path, index: t.index, lock: t.lock,
              address: lockToAddress(t.lock, false), tokenAddress: lockToAddress(t.lock, true),
            });
          }
        });
      }
      known[path] = lastUsed;
    }),
  );
  reach.set(id, known);
  return found;
}

// Every coin of the connected own wallet (WizardConnect)
export function findWalletCoins(provider: ElectrumNetworkProvider): Promise<WalletCoin[]> {
  return scanWalletCoins(provider, (child, index) => manager.getPubkey(child, index));
}
