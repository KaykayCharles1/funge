import { binToHex, encodeTransaction } from "@bitauth/libauth";
import { TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { manager } from "../bch_wallet.ts";
import { CONFIG } from "../config.ts";
import { COPY, errorText } from "../copy.ts";
import { formatUnits } from "../lib/format.ts";
import type { GameKingdom } from "../lib/game.ts";
import { toRelaySafe } from "../lib/relay.ts";
import { retry } from "../lib/retry.ts";
import { findWalletCoins } from "../lib/walletCoins.ts";
import { act } from "./api.ts";
import type { WalletInputClaim } from "./api.ts";
import {
  addKingdomOutputs, coinFailure, kingdomContracts, pickWalletCoins, planKingdomAction, readKingdomCoins, stateUnlocker,
} from "./kingdomActions.ts";
import type { KingdomArtifacts, KingdomErrorCode } from "./kingdomActions.ts";

const FEE_RATE = 2;

export type KingdomExternalOutcome =
  | { ok: true; txid: string; passCount: number }
  | { ok: false; code: KingdomErrorCode | "rejected" | "cancelled" | "timeout" | "disconnected"; text: string };

const fail = (code: Extract<KingdomExternalOutcome, { ok: false }>["code"], text: string): KingdomExternalOutcome => ({
  ok: false,
  code,
  text,
});

// Open or conquer with the player's own wallet (WizardConnect). The wallet signs its own coins; the game server
// then adds the referee signature to input 0 and broadcasts. The new king is the wallet's first receive address.
export async function kingdomActExternal(opts: {
  game: GameKingdom;
  provider: ElectrumNetworkProvider;
  walletPkhHex: string;
  action: "open" | "conquer";
  expectedPay: bigint; // what the player agreed to pay; never ask the wallet to pay more without asking again
  artifacts: KingdomArtifacts;
  signal: AbortSignal;
  onPrompt: (text: string) => void;
}): Promise<KingdomExternalOutcome> {
  const { game, provider, walletPkhHex, action, expectedPay, artifacts, signal, onPrompt } = opts;
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);

  const { pot, state, matches } = kingdomContracts(game, provider, artifacts);
  if (!matches) return fail("mismatch", COPY.grab.mismatch);

  let live: Awaited<ReturnType<typeof readKingdomCoins>>;
  let coins: Awaited<ReturnType<typeof findWalletCoins>>;
  try {
    [live, coins] = await Promise.all([readKingdomCoins(game, provider), retry(() => findWalletCoins(provider))]);
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!live) return fail("no_round", COPY.grab.noRound);
  const { stateUtxo, potUtxo, state: s } = live;

  const planned = planKingdomAction(game, s, action, walletPkhHex, expectedPay);
  if (!planned.ok) return planned;
  const { plan } = planned;

  const picked = pickWalletCoins(coins.map((c) => c.utxo), game.pusdCategory, plan.pay);
  if (!picked.ok) return coinFailure(picked, plan.pay);
  // back to the wallet's coins, which know their address path; the PUSD coin comes first
  const walletInputs = picked.inputs.map((u) => coins.find((c) => c.utxo.txid === u.txid && c.utxo.vout === u.vout)!);
  const first = walletInputs[0]!;

  let request: Parameters<typeof manager.signTransaction>[0];
  try {
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, stateUnlocker(state, action, walletPkhHex))
      .addInput(potUtxo, pot.unlock.release());
    for (const c of walletInputs) builder.addInput(c.utxo, placeholderP2PKHUnlocker(c.address));
    addKingdomOutputs(builder, { game, state, pot, stateUtxo, potUtxo, s, plan });
    builder
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: first.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: first.lock, feeRate: FEE_RATE });

    const userPrompt = action === "open" ? "Open the Funge kingdom" : `Take the Funge throne (pass ${s.passCount + 1})`;
    const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
    const feeSats =
      wc.sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n) -
      wc.transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
    onPrompt(COPY.external.approve(fmt(plan.pay), String(feeSats)));

    // Inputs 0 and 1 are the contracts; the wallet signs inputs 2 and up
    request = {
      transaction: {
        transaction: binToHex(encodeTransaction(wc.transaction)),
        sourceOutputs: toRelaySafe(wc.sourceOutputs),
        broadcast: false,
        userPrompt,
      },
      inputPaths: walletInputs.map((c, i): [number, string, number] => [2 + i, c.path, c.index]),
    } as unknown as Parameters<typeof manager.signTransaction>[0];
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e).split("WARNING")[0]!.slice(0, 200));
    return fail("build_failed", COPY.external.failed);
  }

  let signedHex: string;
  try {
    const response = await manager.signTransaction(request, { signal });
    if (response.error) return fail("rejected", COPY.external.rejected);
    if (!response.signedTransaction) return fail("rejected", COPY.external.rejected);
    signedHex = response.signedTransaction;
  } catch (e) {
    const reason = signal.reason instanceof Error ? signal.reason.message : "";
    const msg = `${reason} ${e instanceof Error ? e.message : String(e)}`;
    if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      if (msg.includes("Timed out")) return fail("timeout", COPY.external.timeout);
      if (msg.includes("disconnected")) return fail("disconnected", COPY.external.disconnected);
      return fail("cancelled", COPY.external.cancelled);
    }
    if (/reject|denied|declin|cancel/i.test(msg)) return fail("rejected", COPY.external.rejected);
    return fail("build_failed", COPY.external.failed);
  }

  const claims: WalletInputClaim[] = walletInputs.map((c) => ({
    txid: c.utxo.txid,
    vout: c.utxo.vout,
    satoshis: String(c.utxo.satoshis),
    lockingBytecode: binToHex(c.lock),
    ...(c.utxo.token ? { token: { amount: String(c.utxo.token.amount), category: c.utxo.token.category } } : {}),
  }));
  const res = await act(game.gameCategory, { action, txHex: signedHex, walletInputs: claims });
  if (res.ok) return { ok: true, txid: res.txid, passCount: res.passCount };
  if (res.message) console.error(`${action} refused (${res.error}): ${res.message}`);
  return fail(res.error, errorText(res.error));
}