import { hexToBin } from "@bitauth/libauth";
import { Contract, TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import potJson from "../../contracts/FungePot.json";
import stateJson from "../../contracts/FungeStateV2.json";
import { COPY, errorText } from "../copy.ts";
import { p2pkhLock, toVmCategory } from "../lib/chain.ts";
import { decodeCommitment } from "../lib/commitment.ts";
import type { GameV2 } from "../lib/game.ts";
import { retry } from "../lib/retry.ts";
import type { LocalWallet } from "../wallet/local.ts";

export type FallbackOutcome =
  | { ok: true; txid: string }
  | { ok: false; code: "too_early" | "round_gone" | "needs_bch" | "outcome_unknown" | "failed"; text: string };

const fail = (code: Extract<FallbackOutcome, { ok: false }>["code"], text: string): FallbackOutcome => ({ ok: false, code, text });

// Anyone can do this once enough blocks have passed; the contract pays the last holder, not the sender.
// The wallet is only used to pay the small network fee.
export async function settleWithoutReferee(
  game: GameV2,
  provider: ElectrumNetworkProvider,
  wallet: LocalWallet,
): Promise<FallbackOutcome> {
  const pot = new Contract(potJson as any, [toVmCategory(game.gameCategory)], { provider });
  const state = new Contract(
    stateJson as any,
    [
      hexToBin(pot.lockingBytecode),
      toVmCategory(game.pusdCategory),
      BigInt(game.params.basePrice),
      BigInt(game.params.priceStep),
      hexToBin(game.refereePubkey),
      BigInt(game.params.fallbackBlocks),
      BigInt(game.params.waitingFallbackBlocks),
    ],
    { provider },
  );
  if (state.tokenAddress !== game.state.tokenAddress || pot.tokenAddress !== game.pot.tokenAddress) {
    return fail("failed", COPY.grab.mismatch);
  }

  let tx: ReturnType<TransactionBuilder["addInput"]>;
  try {
    const [[stateUtxo], [potUtxo]] = await Promise.all([
      retry(() => provider.getUtxos(game.state.address)),
      retry(() => provider.getUtxos(game.pot.address)),
    ]);
    if (!stateUtxo?.token?.nft || !potUtxo?.token) return fail("round_gone", COPY.fallback.gone);
    const { passCount, holderPkh } = decodeCommitment(stateUtxo.token.nft.commitment);
    const limit = passCount === 0 ? game.params.waitingFallbackBlocks : game.params.fallbackBlocks;
    const coins = await retry(() => provider.getUtxosForLockingBytecode(wallet.lock));
    const feeCoin = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
    if (!feeCoin) return fail("needs_bch", COPY.fallback.needsBch);
    const holderLock = p2pkhLock(hexToBin(holderPkh));
    tx = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .addInput(stateUtxo, state.unlock.settleFallback(), { sequence: limit }) // the relative time lock the contract checks
      .addInput(potUtxo, pot.unlock.release())
      .addInput(feeCoin, wallet.unlockP2PKH())
      .addOutput({ to: holderLock, amount: 1_000n, token: { amount: potUtxo.token.amount, category: game.pusdCategory } })
      .addOutput({
        to: holderLock,
        amount: 1_000n,
        token: { amount: 0n, category: game.gameCategory, nft: { capability: "none", commitment: stateUtxo.token.nft.commitment } },
      })
      .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: 2 });
  } catch {
    return fail("failed", errorText("chain_unavailable"));
  }

  try {
    const sent = await tx.send();
    return { ok: true, txid: sent.txid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fallback settle refused:", msg.split("WARNING")[0]!.slice(0, 200)); // never log the debug link: it can hold keys
    if (/BIP68|age >= limit/i.test(msg)) return fail("too_early", COPY.fallback.tooEarly);
    if (/txn-mempool-conflict|missingorspent|missing inputs|already spent|conflict/i.test(msg)) return fail("round_gone", COPY.fallback.gone);
    if (/websocket|establish connection|failed to connect|timed? ?out|closed|socket/i.test(msg)) return fail("outcome_unknown", COPY.fallback.unknown);
    return fail("failed", COPY.fallback.failed);
  }
}