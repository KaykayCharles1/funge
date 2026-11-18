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
): Referee & { add: (g: ServerGame) => void } {
  const contracts = new Map<string, { state: Contract; pot: Contract }>();
  const addGame = (g: ServerGame, when: string) => {
    const pot = new Contract(artifact("FungePot"), [swapEndianness(g.gameId)], { provider });
    const k = g.kingdom;
    const state = new Contract(
      artifact("FungeKingdom"),
      [
        hexToBin(pot.lockingBytecode), swapEndianness(g.pusdCategory), hexToBin(g.refereePubkey),
        k.openingPrice, k.feePercent, k.cutPercent, k.cap, BigInt(k.protectsPerReign), k.unit, BigInt(g.fallbackBlocks),
      ],
      { provider },
    );
    if (pot.lockingBytecode !== g.potLockingBytecode || state.lockingBytecode !== g.stateLockingBytecode) {
      throw new Error(`${when}: the compiled contracts do not match the deployed game ${g.gameId}.`);
    }
    contracts.set(g.gameId, { state, pot });
  };
  for (const g of games) addGame(g, "Refusing to start");
  const need = (id: string) => {
    const c = contracts.get(id);
    if (!c) throw new Error("unknown game");
    return c;
  };
  return {
    // A round that appears while the server runs (server/gameRegistry.ts): the same contract check as at start
    add(g) {
      if (!contracts.has(g.gameId)) addGame(g, "Refusing this game");
    },
    sign(game, tx, sourceOutputs, call) {
      const { state } = need(game.gameId);
      const template = keyring.templateFor(game.gameId); // ALL | UTXOS (Step 3)
      const unlocker =
        call.fn === "settle"
          ? state.unlock.settle(template)
          : call.fn === "protect"
          ? state.unlock.protect(template, call.amount)
          : call.fn === "open"
            ? state.unlock.open(hexToBin(call.newHolder), template)
            : state.unlock.conquer(hexToBin(call.newHolder), template);
      return unlocker.generateUnlockingBytecode({ transaction: tx, sourceOutputs, inputIndex: 0 });
    },
    // Whole pot to the holder, trophy to the holder, change to the holder. The referee signs; no wallet needed.
    // A Kingdom round with only the opener pays the opener back.
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
