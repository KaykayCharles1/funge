import { hexToBin } from "@bitauth/libauth";
import { TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { COPY, errorText } from "../copy.ts";
import { p2pkhLock, scriptHash } from "../lib/chain.ts";
import { decodeKingdomCommitment } from "../lib/kingdom.ts";
import type { GameKingdom } from "../lib/game.ts";
import { retry } from "../lib/retry.ts";
import type { LocalWallet } from "../wallet/local.ts";
import type { FallbackOutcome } from "./fallback.ts";
import { kingdomContracts, readKingdomCoins } from "./kingdomActions.ts";
import type { KingdomArtifacts } from "./kingdomActions.ts";

export type KingdomChainWatch = {
  live: boolean; // false: the state coin is gone, so the round has been settled
  passCount: number;
  holderPkh: string | null;
  pot: bigint | null;
  confirmations: number | null; // blocks since the last action was confirmed; 0 while it is still unconfirmed
  limit: number; // blocks without activity after which anyone can settle
};

// What the network itself says about the Kingdom round. Needs no game server.
export async function watchKingdomChain(game: GameKingdom, provider: ElectrumNetworkProvider): Promise<KingdomChainWatch> {
  const limit = game.params.fallbackBlocks;
  const live = await readKingdomCoins(game, provider);
  if (!live) return { live: false, passCount: 0, holderPkh: null, pot: null, confirmations: null, limit };

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
  return {
    live: true,
    passCount: live.state.passCount,
    holderPkh: live.state.holderPkh,
    pot: live.potUtxo.token ? live.potUtxo.token.amount : null,
    confirmations,
    limit,
  };
}

const fail = (code: Extract<FallbackOutcome, { ok: false }>["code"], text: string): FallbackOutcome => ({ ok: false, code, text });

// Anyone can do this once enough blocks have passed with no action; the contract pays the last king, not the sender.
// The wallet is only used to pay the small network fee. No referee is needed.
export async function kingdomSettleWithoutReferee(
  game: GameKingdom,
  provider: ElectrumNetworkProvider,
  wallet: LocalWallet,
  artifacts: KingdomArtifacts,
): Promise<FallbackOutcome> {
  const { pot, state, matches } = kingdomContracts(game, provider, artifacts);
  if (!matches) return fail("failed", COPY.grab.mismatch);

  let tx: ReturnType<TransactionBuilder["addInput"]>;
  try {
    const [live, coins] = await Promise.all([
      readKingdomCoins(game, provider),
      retry(() => provider.getUtxosForLockingBytecode(wallet.lock)),
    ]);
    if (!live) return fail("round_gone", COPY.fallback.gone);
    const { stateUtxo, potUtxo } = live;
    const potToken = potUtxo.token;
    const stateNft = stateUtxo.token?.nft;
    if (!potToken || !stateNft) return fail("round_gone", COPY.fallback.gone);
    if (live.state.passCount < 1) return fail("failed", COPY.fallback.failed); // nobody opened: there is nothing to settle
    const feeCoin = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
    if (!feeCoin) return fail("needs_bch", COPY.fallback.needsBch);
    const holderLock = p2pkhLock(hexToBin(decodeKingdomCommitment(stateNft.commitment).holderPkh));
    tx = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .addInput(stateUtxo, state.unlock.settleFallback(), { sequence: game.params.fallbackBlocks }) // the relative time lock the contract checks
      .addInput(potUtxo, pot.unlock.release())
      .addInput(feeCoin, wallet.unlockP2PKH())
      .addOutput({ to: holderLock, amount: 1_000n, token: { amount: potToken.amount, category: game.pusdCategory } })
      .addOutput({
        to: holderLock,
        amount: 1_000n,
        token: { amount: 0n, category: game.gameCategory, nft: { capability: "none", commitment: stateNft.commitment } },
      })
      .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: 2 });
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e).split("WARNING")[0]!.slice(0, 200));
    return fail("failed", errorText("chain_unavailable"));
  }

  try {
    const sent = await tx.send();
    return { ok: true, txid: sent.txid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fallback settle refused:", msg.split("WARNING")[0]!.slice(0, 200)); // never log the debug link: it can hold keys
    if (/BIP68|age >= limit|Too early/i.test(msg)) return fail("too_early", COPY.fallback.tooEarly);
    if (/txn-mempool-conflict|missingorspent|missing inputs|already spent|conflict/i.test(msg)) return fail("round_gone", COPY.fallback.gone);
    if (/websocket|establish connection|failed to connect|timed? ?out|closed|socket/i.test(msg)) return fail("outcome_unknown", COPY.fallback.unknown);
    return fail("failed", COPY.fallback.failed);
  }
}