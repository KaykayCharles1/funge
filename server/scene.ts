import type { Moved } from "./actTypes.ts";
import type { ChainState } from "./chain.ts";
import type { ServerGame } from "./games.ts";
import type { SceneState } from "./store.ts";

const isZero = (hex: string) => /^0+$/.test(hex);

// The kingdom as the chain shows it (null when the state coin is gone)
export function sceneOf(game: ServerGame, c: ChainState): SceneState | null {
  const k = c.kingdom;
  if (!k || !c.live) return null;
  const open = k.passCount >= 1;
  return {
    king: open ? k.holderPkh : null,
    previousKing: open && !isZero(k.previous) ? k.previous : null,
    passCount: k.passCount,
    conquests: open ? k.passCount - 1 : 0,
    value: k.value.toString(),
    treasury: (c.potAmount ?? 0n).toString(),
    protectsLeft: open ? Math.max(0, game.kingdom.protectsPerReign - k.protects) : 0,
  };
}

// The kingdom right after a move that this server has just broadcast
export function sceneAfter(passCount: number, m: Moved): SceneState {
  return {
    king: m.actor, previousKing: m.previousKing, passCount, conquests: m.conquests,
    value: m.value.toString(), treasury: m.treasury.toString(), protectsLeft: m.protectsLeft,
  };
}
