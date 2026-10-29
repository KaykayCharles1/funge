import { binToHex, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import potJson from "../../contracts/FungePot.json";
import stateJson from "../../contracts/FungeStateV2.json";
import { CONFIG } from "../config.ts";
import { COPY, errorText, notEnoughText, priceChangedText, splitCoinsText } from "../copy.ts";
import { toVmCategory } from "../lib/chain.ts";
import { decodeCommitment, encodeCommitment } from "../lib/commitment.ts";
import { formatUnits } from "../lib/format.ts";
import type { GameV2 } from "../lib/game.ts";
import { retry } from "../lib/retry.ts";
import type { LocalWallet } from "../wallet/local.ts";
import { act } from "./api.ts";
import type { ApiErrorCode, WalletInputClaim } from "./api.ts";

const FEE_RATE = 2;
const MIN_FEE_COIN_SATS = 6_000n; // a PUSD coin with less BCH than this needs a second coin for the fee

export type GrabErrorCode =
  | ApiErrorCode | "price_changed" | "no_round" | "no_funds" | "needs_bch" | "mismatch" | "build_failed";
export type GrabOutcome =
  | { ok: true; txid: string; passCount: number }
  | { ok: false; code: GrabErrorCode; text: string };

const fail = (code: GrabErrorCode, text: string): GrabOutcome => ({ ok: false, code, text });

// Builds the grab in the browser, signs only the player's own coins, and lets the game server add the referee signature.
export async function grabViaReferee(
  game: GameV2,
  provider: ElectrumNetworkProvider,
  wallet: LocalWallet,
  expectedPrice: bigint,
): Promise<GrabOutcome> {
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
    coins = await retry(() => provider.getUtxosForLockingBytecode(wallet.lock));
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!stateUtxo?.token?.nft || !potUtxo?.token) return fail("no_round", COPY.grab.noRound);

  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);

  // The player agreed to expectedPrice; never spend more than that without asking again
  if (price !== expectedPrice) {
    return price < expectedPrice
      ? fail("chain_unavailable", COPY.grab.behind) // our network view is older than the page
      : fail("price_changed", priceChangedText(fmt(price)));
  }

  const pusdCoin = coins
    .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft && u.token.amount >= price)
    .sort((a, b) => (a.token!.amount < b.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) {
    const total = coins
      .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft)
      .reduce((sum, u) => sum + u.token!.amount, 0n);
    return fail("no_funds", total >= price ? splitCoinsText(fmt(price)) : notEnoughText(fmt(price), fmt(total)));
  }
  const bchCoin =
    pusdCoin.satoshis < MIN_FEE_COIN_SATS
      ? coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0]
      : undefined;
  if (pusdCoin.satoshis < MIN_FEE_COIN_SATS && !bchCoin) return fail("needs_bch", COPY.grab.needsBch);
  const inputs = bchCoin ? [pusdCoin, bchCoin] : [pusdCoin];

  let txHex: string;
  try {
    // The server replaces this throwaway signature with the real referee signature
    const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)));
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, state.unlock.pass(hexToBin(wallet.pkhHex), placeholder))
      .addInput(potUtxo, pot.unlock.release());
    for (const coin of inputs) builder.addInput(coin, wallet.unlockP2PKH());
    builder
      .addOutput({
        to: state.tokenAddress,
        amount: stateUtxo.satoshis,
        token: {
          amount: 0n,
          category: game.gameCategory,
          nft: { capability: "mutable", commitment: encodeCommitment(passCount + 1, wallet.pkhHex) },
        },
      })
      .addOutput({
        to: pot.tokenAddress,
        amount: potUtxo.satoshis,
        token: { amount: potUtxo.token.amount + price, category: game.pusdCategory },
      })
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE });
    txHex = builder.build();
  } catch (e) {
    console.error(e);
    return fail("build_failed", COPY.grab.buildFailed);
  }

  const walletInputs: WalletInputClaim[] = inputs.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: String(u.satoshis),
    lockingBytecode: binToHex(wallet.lock),
    ...(u.token ? { token: { amount: String(u.token.amount), category: u.token.category } } : {}),
  }));

  const res = await act(game.gameCategory, { action: "steal", txHex, walletInputs });
  if (res.ok) return { ok: true, txid: res.txid, passCount: res.passCount };
  if (res.message) console.error(`grab refused (${res.error}): ${res.message}`);
  return fail(res.error, errorText(res.error));
}