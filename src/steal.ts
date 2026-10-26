import { hexToBin } from "@bitauth/libauth";
import { TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { decodeCommitment, encodeCommitment } from "./lib/commitment.ts";
import { makeContracts } from "./lib/contracts.ts";
import { formatUnits } from "./lib/format.ts";
import type { Game } from "./lib/game.ts";
import { retry } from "./lib/retry.ts";
import { PassError } from "./pass.ts";
import type { LocalWallet } from "./wallet/local.ts";

const FEE_RATE = 2;
const MIN_FEE_COIN_SATS = 6_000n; // a PUSD coin with less BCH than this needs a second coin for the fee

export type StealResult = { txid: string; passCount: number; pot: bigint };

export async function stealWithLocalWallet(
  game: Game,
  provider: ElectrumNetworkProvider,
  wallet: LocalWallet,
  expectedPrice: bigint,
): Promise<StealResult> {
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);
  const { state, pot } = makeContracts(game, provider);

  // Always re-read the live state right before building
  const [[stateUtxo], [potUtxo]] = await Promise.all([
    retry(() => provider.getUtxos(game.state.address)),
    retry(() => provider.getUtxos(game.pot.address)),
  ]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) {
    throw new PassError("no-round", "No live round found. It may have just ended.");
  }
  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);

  // The player agreed to expectedPrice; never spend more than that without asking again
  if (price !== expectedPrice) {
    throw new PassError("price-changed", `The price changed to ${fmt(price)} PUSD. Press the button again to grab at the new price.`);
  }

  const coins = await retry(() => provider.getUtxosForLockingBytecode(wallet.lock));
  const pusdCoin = coins
    .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft && u.token.amount >= price)
    .sort((a, b) => (a.token!.amount < b.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) {
    const total = coins
      .filter((u) => u.token && u.token.category === game.pusdCategory && !u.token.nft)
      .reduce((sum, u) => sum + u.token!.amount, 0n);
    throw new PassError(
      "no-funds",
      total >= price
        ? `Your PUSD is split across several small coins. Combine them into one, then try again (next grab: ${fmt(price)} PUSD).`
        : `Not enough PUSD. The next grab costs ${fmt(price)} PUSD and this wallet has ${fmt(total)}.`,
    );
  }
  const needsFeeCoin = pusdCoin.satoshis < MIN_FEE_COIN_SATS;
  const bchCoin = needsFeeCoin
    ? coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0]
    : undefined;
  if (needsFeeCoin && !bchCoin) throw new PassError("no-funds", "Your wallet needs a little BCH to pay the network fee.");
  const inputs = bchCoin ? [pusdCoin, bchCoin] : [pusdCoin];

  const builder = new TransactionBuilder({ provider })
    .addInput(stateUtxo, state.unlock.pass(hexToBin(wallet.pkhHex)))
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

  try {
    const sent = await builder.send(); // checks against the contracts locally, then broadcasts
    return { txid: sent.txid, passCount: passCount + 1, pot: potUtxo.token.amount + price };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/conflict|missing|spent/i.test(msg)) {
      throw new PassError("stale", "Someone else grabbed the potato first. Check the new price and try again.");
    }
    if (/websocket|establish connection|failed to connect|timed? ?out|closed|socket/i.test(msg)) {
      throw new PassError(
        "network",
        "We could not confirm that the network received your grab. Wait a moment and check the pass number before trying again.",
      );
    }
    throw e;
  }
}