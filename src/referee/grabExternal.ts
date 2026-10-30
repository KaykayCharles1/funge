import { binToHex, encodeTransaction, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import potJson from "../../contracts/FungePot.json";
import stateJson from "../../contracts/FungeStateV2.json";
import { manager } from "../bch_wallet.ts";
import { CONFIG } from "../config.ts";
import { COPY, errorText, notEnoughText, priceChangedText, splitCoinsText } from "../copy.ts";
import { toVmCategory } from "../lib/chain.ts";
import { decodeCommitment, encodeCommitment } from "../lib/commitment.ts";
import { formatUnits } from "../lib/format.ts";
import type { GameV2 } from "../lib/game.ts";
import { toRelaySafe } from "../lib/relay.ts";
import { retry } from "../lib/retry.ts";
import { findWalletCoins } from "../lib/walletCoins.ts";
import { act } from "./api.ts";
import type { WalletInputClaim } from "./api.ts";
import type { GrabErrorCode } from "./grab.ts";

const FEE_RATE = 2;
const MIN_FEE_COIN_SATS = 6_000n; // a PUSD coin with less BCH than this needs a second coin for the fee

export type ExternalGrabOutcome =
  | { ok: true; txid: string; passCount: number }
  | { ok: false; code: GrabErrorCode | "rejected" | "cancelled" | "timeout" | "disconnected"; text: string };

const fail = (code: Extract<ExternalGrabOutcome, { ok: false }>["code"], text: string): ExternalGrabOutcome => ({ ok: false, code, text });

// The player's own wallet (WizardConnect) signs its coins; the game server adds the referee signature and broadcasts.
export async function grabViaExternalWallet(
  game: GameV2,
  provider: ElectrumNetworkProvider,
  walletPkhHex: string,
  expectedPrice: bigint,
  signal: AbortSignal,
  onPrompt: (text: string) => void,
): Promise<ExternalGrabOutcome> {
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);
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
    return fail("mismatch", COPY.grab.mismatch);
  }

  let stateUtxo, potUtxo, coins;
  try {
    [[stateUtxo], [potUtxo]] = await Promise.all([
      retry(() => provider.getUtxos(game.state.address)),
      retry(() => provider.getUtxos(game.pot.address)),
    ]);
    coins = await findWalletCoins(provider);
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!stateUtxo?.token?.nft || !potUtxo?.token) return fail("no_round", COPY.grab.noRound);
  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);

  // The player agreed to expectedPrice; never ask the wallet to pay more without asking again
  if (price !== expectedPrice) {
    return price < expectedPrice
      ? fail("chain_unavailable", COPY.grab.behind)
      : fail("price_changed", priceChangedText(fmt(price)));
  }

  const pusdCoin = coins
    .filter((c) => c.utxo.token && c.utxo.token.category === game.pusdCategory && !c.utxo.token.nft && c.utxo.token.amount >= price)
    .sort((a, b) => (a.utxo.token!.amount < b.utxo.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) {
    const total = coins
      .filter((c) => c.utxo.token && c.utxo.token.category === game.pusdCategory && !c.utxo.token.nft)
      .reduce((sum, c) => sum + c.utxo.token!.amount, 0n);
    return fail("no_funds", total >= price ? splitCoinsText(fmt(price)) : notEnoughText(fmt(price), fmt(total)));
  }
  const bchCoin =
    pusdCoin.utxo.satoshis >= MIN_FEE_COIN_SATS
      ? undefined
      : coins.filter((c) => !c.utxo.token).sort((a, b) => (a.utxo.satoshis < b.utxo.satoshis ? 1 : -1))[0];
  if (pusdCoin.utxo.satoshis < MIN_FEE_COIN_SATS && !bchCoin) return fail("needs_bch", COPY.grab.needsBch);
  const walletInputs = bchCoin ? [pusdCoin, bchCoin] : [pusdCoin];

  let request: Parameters<typeof manager.signTransaction>[0];
  try {
    // The server replaces this throwaway signature with the real referee signature after the wallet has signed
    const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)));
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, state.unlock.pass(hexToBin(walletPkhHex), placeholder))
      .addInput(potUtxo, pot.unlock.release());
    for (const c of walletInputs) builder.addInput(c.utxo, placeholderP2PKHUnlocker(c.address));
    builder
      .addOutput({
        to: state.tokenAddress,
        amount: stateUtxo.satoshis,
        token: {
          amount: 0n,
          category: game.gameCategory,
          nft: { capability: "mutable", commitment: encodeCommitment(passCount + 1, walletPkhHex) },
        },
      })
      .addOutput({
        to: pot.tokenAddress,
        amount: potUtxo.satoshis,
        token: { amount: potUtxo.token.amount + price, category: game.pusdCategory },
      })
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: pusdCoin.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: pusdCoin.lock, feeRate: FEE_RATE });

    const userPrompt = `Grab the Funge potato (pass ${passCount + 1})`;
    const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
    const feeSats =
      wc.sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n) -
      wc.transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
    onPrompt(COPY.external.approve(fmt(price), String(feeSats)));

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
  const res = await act(game.gameCategory, { action: "steal", txHex: signedHex, walletInputs: claims });
  if (res.ok) return { ok: true, txid: res.txid, passCount: res.passCount };
  if (res.message) console.error(`grab refused (${res.error}): ${res.message}`);
  return fail(res.error, errorText(res.error));
}