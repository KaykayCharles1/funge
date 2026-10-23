import { hash160 } from "@bitauth/libauth";
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

// Looks at the first few addresses on the receive and change paths. Enough for a fresh demo wallet.
export async function findWalletCoins(
  provider: ElectrumNetworkProvider,
  receiveCount = 5,
  changeCount = 2,
): Promise<WalletCoin[]> {
  const targets: { path: string; index: number; lock: Uint8Array }[] = [];
  const plan: [string, number][] = [[PATH_RECEIVE, receiveCount], [PATH_CHANGE, changeCount]];
  for (const [path, count] of plan) {
    const child = childIndexOfPathName(path);
    if (child === undefined) continue;
    for (let i = 0; i < count; i++) {
      const pubkey = manager.getPubkey(child, BigInt(i));
      if (pubkey) targets.push({ path, index: i, lock: p2pkhLock(hash160(pubkey)) });
    }
  }
  const found = await Promise.all(
    targets.map(async (t) => {
      const utxos = await retry(() => provider.getUtxosForLockingBytecode(t.lock));
      return utxos.map((utxo) => ({
        utxo,
        ...t,
        address: lockToAddress(t.lock, false),
        tokenAddress: lockToAddress(t.lock, true),
      }));
    }),
  );
  return found.flat();
}