import { Contract } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "@bitauth/libauth";
import potJson from "../../contracts/FungePot.json";
import stateJson from "../../contracts/FungeState.json";
import { toVmCategory } from "./chain.ts";
import type { Game } from "./game.ts";

export function makeContracts(game: Game, provider: ElectrumNetworkProvider) {
  const pot = new Contract(potJson as any, [toVmCategory(game.gameCategory)], { provider });
  const state = new Contract(
    stateJson as any,
    [
      hexToBin(pot.lockingBytecode),
      toVmCategory(game.pusdCategory),
      BigInt(game.params.basePrice),
      BigInt(game.params.priceStep),
      BigInt(game.params.timeoutBlocks),
    ],
    { provider },
  );
  if (state.tokenAddress !== game.state.tokenAddress || pot.tokenAddress !== game.pot.tokenAddress) {
    throw new Error("The contracts do not match the game file. Reload the page.");
  }
  return { state, pot };
}