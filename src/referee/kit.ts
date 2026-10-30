import type { ElectrumNetworkProvider } from "cashscript";
import { decodeCommitment } from "../lib/commitment.ts";
import type { GameV2 } from "../lib/game.ts";
import { retry } from "../lib/retry.ts";

type Utxos = Awaited<ReturnType<ElectrumNetworkProvider["getUtxos"]>>;
type Coins = Awaited<ReturnType<ElectrumNetworkProvider["getUtxosForLockingBytecode"]>>;

// Everything a grab needs from the chain, read ahead of time so the click does not wait for the network
export type GrabKit = {
  passCount: number;
  stateUtxo: Utxos[number];
  potUtxo: Utxos[number];
  coins: Coins;
  lock: Uint8Array;
  at: number;
};

export const KIT_MAX_AGE_MS = 20_000;

let kit: GrabKit | null = null;
let busy = false;

export const getKit = (): GrabKit | null => kit;
export const clearKit = (): void => {
  kit = null;
};

// Failures are ignored on purpose: the grab falls back to reading the chain live
export async function refreshKit(game: GameV2, provider: ElectrumNetworkProvider, lock: Uint8Array): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const [[stateUtxo], [potUtxo]] = await Promise.all([
      retry(() => provider.getUtxos(game.state.address)),
      retry(() => provider.getUtxos(game.pot.address)),
    ]);
    const coins = await retry(() => provider.getUtxosForLockingBytecode(lock));
    if (!stateUtxo?.token?.nft || !potUtxo?.token) {
      kit = null;
      return;
    }
    kit = {
      passCount: decodeCommitment(stateUtxo.token.nft.commitment).passCount,
      stateUtxo,
      potUtxo,
      coins,
      lock,
      at: Date.now(),
    };
  } catch {
    // keep the previous kit
  } finally {
    busy = false;
  }
}