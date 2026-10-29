import { readFileSync } from "node:fs";
import { hexToBin, swapEndianness } from "@bitauth/libauth";
import { Contract } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import type { Referee } from "./act.ts";
import type { ServerGame } from "./games.ts";
import type { loadKeyring } from "./keys.ts";

const artifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));

export function makeReferee(
  provider: ElectrumNetworkProvider,
  keyring: ReturnType<typeof loadKeyring>,
  games: ServerGame[],
): Referee {
  const states = new Map<string, Contract>();
  for (const g of games) {
    const pot = new Contract(artifact("FungePot"), [swapEndianness(g.gameId)], { provider });
    const state = new Contract(
      artifact("FungeStateV2"),
      [
        hexToBin(pot.lockingBytecode), swapEndianness(g.pusdCategory), g.basePrice, g.priceStep,
        hexToBin(g.refereePubkey), BigInt(g.fallbackBlocks), BigInt(g.waitingFallbackBlocks),
      ],
      { provider },
    );
    if (pot.lockingBytecode !== g.potLockingBytecode || state.lockingBytecode !== g.stateLockingBytecode) {
      throw new Error(`Refusing to start: the compiled contracts do not match the deployed game ${g.gameId}.`);
    }
    states.set(g.gameId, state);
  }
  return {
    sign(game, tx, sourceOutputs, newHolderPkh) {
      const state = states.get(game.gameId);
      if (!state) throw new Error("unknown game");
      return state.unlock
        .pass(hexToBin(newHolderPkh), keyring.templateFor(game.gameId)) // default hashtype: ALL | UTXOS (Step 3)
        .generateUnlockingBytecode({ transaction: tx, sourceOutputs, inputIndex: 0 });
    },
    broadcast: (hex) => provider.sendRawTransaction(hex),
  };
}