import type { ElectrumNetworkProvider } from "cashscript";
import { scriptHash } from "../lib/chain.ts";
import { decodeCommitment } from "../lib/commitment.ts";
import type { GameV2 } from "../lib/game.ts";
import { retry } from "../lib/retry.ts";

export type ChainWatch = {
  live: boolean; // false: the state coin is gone, so the round has been settled
  passCount: number;
  holderPkh: string | null;
  pot: bigint | null;
  confirmations: number | null; // blocks since the last action was confirmed; 0 while it is still unconfirmed
  limit: number; // blocks without activity after which anyone can settle
};

// What the network itself says about the round. Needs no game server.
export async function watchChain(game: GameV2, provider: ElectrumNetworkProvider): Promise<ChainWatch> {
  const [[stateUtxo], [potUtxo]] = await Promise.all([
    retry(() => provider.getUtxos(game.state.address)),
    retry(() => provider.getUtxos(game.pot.address)),
  ]);
  if (!stateUtxo?.token?.nft) {
    return { live: false, passCount: 0, holderPkh: null, pot: null, confirmations: null, limit: game.params.fallbackBlocks };
  }
  const { passCount, holderPkh } = decodeCommitment(stateUtxo.token.nft.commitment);
  const limit = passCount === 0 ? game.params.waitingFallbackBlocks : game.params.fallbackBlocks;

  // Unconfirmed entries can be listed out of order, so: any unconfirmed entry means 0 blocks of age
  const hash = await scriptHash(game.state.lockingBytecode);
  const history: unknown = await retry(() => provider.performRequest("blockchain.scripthash.get_history", hash));
  let confirmations: number | null = null;
  if (Array.isArray(history) && history.length > 0) {
    const heights = (history as { height?: number }[]).map((h) => h.height ?? 0);
    if (heights.some((h) => h <= 0)) {
      confirmations = 0;
    } else {
      const tip = await retry(() => provider.getBlockHeight());
      confirmations = tip - Math.max(...heights) + 1;
    }
  }
  return { live: true, passCount, holderPkh, pot: potUtxo?.token ? potUtxo.token.amount : null, confirmations, limit };
}