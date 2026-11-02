import { binToHex, encodeTransaction } from "@bitauth/libauth";
import { TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { manager } from "../bch_wallet.ts";
import { CONFIG } from "../config.ts";
import { COPY, errorText } from "../copy.ts";
import { formatUnits } from "../lib/format.ts";
import type { GameKingdom } from "../lib/game.ts";
import { pickProtectCoins } from "../lib/protectCoins.ts";
import { toRelaySafe } from "../lib/relay.ts";
import { retry } from "../lib/retry.ts";
import { findWalletCoins } from "../lib/walletCoins.ts";
import type { WalletCoin } from "../lib/walletCoins.ts";
import { act } from "./api.ts";
import type { WalletInputClaim } from "./api.ts";
import {
  addKingdomOutputs, addProtectOutputs, coinFailure, kingdomContracts, pickWalletCoins, planKingdomAction, planProtect,
  protectUnlocker, readKingdomCoins, stateUnlocker,
} from "./kingdomActions.ts";
import type { KingdomArtifacts, KingdomErrorCode } from "./kingdomActions.ts";

const FEE_RATE = 2;

export type KingdomExternalOutcome =
  | { ok: true; txid: string; passCount: number }
  | { ok: false; code: KingdomErrorCode | "rejected" | "cancelled" | "timeout" | "disconnected" | "no_king_coin"; text: string };
type ExternalFailure = Extract<KingdomExternalOutcome, { ok: false }>;

const fail = (code: ExternalFailure["code"], text: string): ExternalFailure => ({ ok: false, code, text });

// Asks the wallet to sign. Inputs 0 and 1 are the contracts; the wallet signs inputs 2 and up.
// Returns the text to show the player before they approve, and the request.
function signRequest(builder: TransactionBuilder, walletInputs: WalletCoin[], userPrompt: string) {
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const feeSats =
    wc.sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n) -
    wc.transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  const request = {
    transaction: {
      transaction: binToHex(encodeTransaction(wc.transaction)),
      sourceOutputs: toRelaySafe(wc.sourceOutputs),
      broadcast: false,
      userPrompt,
    },
    inputPaths: walletInputs.map((c, i): [number, string, number] => [2 + i, c.path, c.index]),
  } as unknown as Parameters<typeof manager.signTransaction>[0];
  return { request, feeSats };
}

async function signWithWallet(
  request: Parameters<typeof manager.signTransaction>[0],
  signal: AbortSignal,
): Promise<{ ok: true; signedHex: string } | ExternalFailure> {
  try {
    const response = await manager.signTransaction(request, { signal });
    if (response.error) return fail("rejected", COPY.external.rejected);
    if (!response.signedTransaction) return fail("rejected", COPY.external.rejected);
    return { ok: true, signedHex: response.signedTransaction };
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
}

// The signed transaction goes to the game server, which adds the referee signature to input 0 and broadcasts
async function sendSigned(
  game: GameKingdom,
  action: "open" | "conquer" | "protect",
  signedHex: string,
  walletInputs: WalletCoin[],
): Promise<KingdomExternalOutcome> {
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

const toWalletCoins = (coins: WalletCoin[], picked: { txid: string; vout: number }[]) =>
  picked.map((u) => coins.find((c) => c.utxo.txid === u.txid && c.utxo.vout === u.vout)!);

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
  let coins: WalletCoin[];
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
  const walletInputs = toWalletCoins(coins, picked.inputs); // the PUSD coin comes first
  const first = walletInputs[0]!;

  let built: ReturnType<typeof signRequest>;
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
    built = signRequest(builder, walletInputs, userPrompt);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e).split("WARNING")[0]!.slice(0, 200));
    return fail("build_failed", COPY.external.failed);
  }
  onPrompt(COPY.external.approve(fmt(plan.pay), String(built.feeSats)));

  const signed = await signWithWallet(built.request, signal);
  if (!signed.ok) return signed;
  return sendSigned(game, action, signed.signedHex, walletInputs);
}

// The king protects the kingdom with the player's own wallet (WizardConnect). The contract wants the first wallet input to
// sit at the king's address (the king's proof). If the PUSD lives on another address, a small coin at the king address
// goes first and the PUSD coin second.
export async function kingdomProtectExternal(opts: {
  game: GameKingdom;
  provider: ElectrumNetworkProvider;
  walletPkhHex: string;
  amount: bigint;
  artifacts: KingdomArtifacts;
  signal: AbortSignal;
  onPrompt: (text: string) => void;
}): Promise<KingdomExternalOutcome> {
  const { game, provider, walletPkhHex, amount, artifacts, signal, onPrompt } = opts;
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);

  const { pot, state, matches } = kingdomContracts(game, provider, artifacts);
  if (!matches) return fail("mismatch", COPY.grab.mismatch);

  let live: Awaited<ReturnType<typeof readKingdomCoins>>;
  let coins: WalletCoin[];
  try {
    [live, coins] = await Promise.all([readKingdomCoins(game, provider), retry(() => findWalletCoins(provider))]);
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!live) return fail("no_round", COPY.grab.noRound);
  const { stateUtxo, potUtxo, state: s } = live;

  const planned = planProtect(game, s, walletPkhHex, amount);
  if (!planned.ok) return planned;

  const picked = pickProtectCoins(coins, s.holderPkh, game.pusdCategory, amount);
  if (!picked.ok) {
    return picked.code === "no_king_coin"
      ? fail("no_king_coin", COPY.external.noKingCoin)
      : coinFailure({ code: picked.code, have: picked.have }, amount);
  }
  const walletInputs = picked.inputs; // the coin at the king's address is first
  const first = walletInputs[0]!;

  let built: ReturnType<typeof signRequest>;
  try {
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, protectUnlocker(state, amount))
      .addInput(potUtxo, pot.unlock.release());
    for (const c of walletInputs) builder.addInput(c.utxo, placeholderP2PKHUnlocker(c.address));
    addProtectOutputs(builder, { game, state, pot, stateUtxo, potUtxo, next: planned.next, amount });
    builder
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: first.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: first.lock, feeRate: FEE_RATE });
    built = signRequest(builder, walletInputs, `Protect the Funge kingdom (+${fmt(amount)} PUSD)`);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e).split("WARNING")[0]!.slice(0, 200));
    return fail("build_failed", COPY.external.failed);
  }
  onPrompt(COPY.external.approve(fmt(amount), String(built.feeSats)));

  const signed = await signWithWallet(built.request, signal);
  if (!signed.ok) return signed;
  return sendSigned(game, "protect", signed.signedHex, walletInputs);
}