import { Contract, TransactionBuilder, placeholderP2PKHUnlocker } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { binToHex, encodeTransaction, hexToBin } from "@bitauth/libauth";
import potJson from "../contracts/FungePot.json";
import stateJson from "../contracts/FungeState.json";
import { toVmCategory } from "./lib/chain.ts";
import { decodeCommitment, encodeCommitment } from "./lib/commitment.ts";
import type { Game } from "./lib/game.ts";
import { toRelaySafe } from "./lib/relay.ts";
import { retry } from "./lib/retry.ts";
import { findWalletCoins } from "./lib/walletCoins.ts";

const FEE_RATE = 2;

export class PassError extends Error {
  code: "no-round" | "no-funds" | "mismatch";
  constructor(code: PassError["code"], message: string) {
    super(message);
    this.name = "PassError";
    this.code = code;
  }
}

export async function buildPassRequest(game: Game, provider: ElectrumNetworkProvider, walletPkhHex: string) {
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
    throw new PassError("mismatch", "The contracts do not match the game file. Reload the page.");
  }

  // Always re-read the live state right before building
  const [[stateUtxo], [potUtxo]] = await Promise.all([
    retry(() => provider.getUtxos(game.state.address)),
    retry(() => provider.getUtxos(game.pot.address)),
  ]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) throw new PassError("no-round", "No live round found.");
  const { passCount } = decodeCommitment(stateUtxo.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);

  // Wallet coins: one PUSD coin large enough, plus a BCH coin only if that coin cannot cover the fee
  const coins = await findWalletCoins(provider);
  const pusdCoin = coins
    .filter((c) => c.utxo.token && c.utxo.token.category === game.pusdCategory && !c.utxo.token.nft && c.utxo.token.amount >= price)
    .sort((a, b) => (a.utxo.token!.amount < b.utxo.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) throw new PassError("no-funds", "Your wallet needs a PUSD coin large enough for the next price.");
  const bchCoin =
    pusdCoin.utxo.satoshis >= 6_000n
      ? undefined
      : coins.filter((c) => !c.utxo.token).sort((a, b) => (a.utxo.satoshis < b.utxo.satoshis ? 1 : -1))[0];
  if (pusdCoin.utxo.satoshis < 6_000n && !bchCoin) {
    throw new PassError("no-funds", "Your wallet needs a little BCH to pay the network fee.");
  }
  const walletInputs = bchCoin ? [pusdCoin, bchCoin] : [pusdCoin];

  const builder = new TransactionBuilder({ provider })
    .addInput(stateUtxo, state.unlock.pass(hexToBin(walletPkhHex)))
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

  // Inputs 0 and 1 are the contracts; the wallet signs inputs 2 and up
  const request = {
    transaction: {
      transaction: binToHex(encodeTransaction(wc.transaction)),
      sourceOutputs: toRelaySafe(wc.sourceOutputs),
      broadcast: false,
      userPrompt,
    },
    inputPaths: walletInputs.map((c, i): [number, string, number] => [2 + i, c.path, c.index]),
  };

  return { passCount, price, inputCount: walletInputs.length, feeSats, walletInputs, request };
}