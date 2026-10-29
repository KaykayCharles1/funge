import { readFileSync } from "node:fs";
import { hexToBin, swapEndianness } from "@bitauth/libauth";
import { Contract, TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import type { Referee } from "./act.ts";
import type { ServerGame } from "./games.ts";
import type { loadKeyring } from "./keys.ts";

const SETTLE_FEE_RATE = 1.5; // sats per byte; the game coins' own BCH pays it

const artifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));
const p2pkhLock = (pkh: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

export function makeReferee(
  provider: ElectrumNetworkProvider,
  keyring: ReturnType<typeof loadKeyring>,
  games: ServerGame[],
): Referee {
  const contracts = new Map<string, { state: Contract; pot: Contract }>();
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
    contracts.set(g.gameId, { state, pot });
  }
  const need = (id: string) => {
    const c = contracts.get(id);
    if (!c) throw new Error("unknown game");
    return c;
  };
  return {
    sign(game, tx, sourceOutputs, newHolderPkh) {
      return need(game.gameId)
        .state.unlock.pass(hexToBin(newHolderPkh), keyring.templateFor(game.gameId)) // ALL | UTXOS (Step 3)
        .generateUnlockingBytecode({ transaction: tx, sourceOutputs, inputIndex: 0 });
    },
    // Whole pot to the holder, trophy to the holder, change to the holder. The referee signs; no wallet needed.
    settle(game, chain) {
      const { state, pot } = need(game.gameId);
      const s = chain.stateUtxo;
      const p = chain.potUtxo;
      if (!s?.token?.nft || !p?.token || !chain.holderPkh) throw new Error("no live round to settle");
      const holderLock = p2pkhLock(hexToBin(chain.holderPkh));
      return new TransactionBuilder({ provider })
        .addInput({ ...s, lockingBytecode: s.lockingBytecode ?? game.stateLockingBytecode }, state.unlock.settle(keyring.templateFor(game.gameId)))
        .addInput({ ...p, lockingBytecode: p.lockingBytecode ?? game.potLockingBytecode }, pot.unlock.release())
        .addOutput({ to: holderLock, amount: 1_000n, token: { amount: p.token.amount, category: game.pusdCategory } })
        .addOutput({
          to: holderLock, amount: 1_000n,
          token: { amount: 0n, category: game.gameId, nft: { capability: "none", commitment: s.token.nft.commitment } },
        })
        .addBchChangeOutputIfNeeded({ to: holderLock, feeRate: SETTLE_FEE_RATE })
        .build();
    },
    broadcast: (hex) => provider.sendRawTransaction(hex),
  };
}