// Swap with an own wallet (WizardConnect): the same swap as the game wallet's (src/lib/swap.ts), but the wallet's coins
// can sit on several of its addresses, and the wallet signs them itself. The pool coins need no signature, so the
// wallet is asked to sign only its own inputs (they follow the pool inputs), then the page sends the transaction.
import { binToHex, encodeTransaction, hexToBin } from "@bitauth/libauth";
import { placeholderP2PKHUnlocker } from "cashscript";
import type { ElectrumNetworkProvider, SpendableUtxo, TransactionBuilder } from "cashscript";
import { manager } from "./bch_wallet.ts";
import { lockToAddress, p2pkhLock } from "./lib/chain.ts";
import { toRelaySafe } from "./lib/relay.ts";
import type { SwapTx, SwapWallet } from "./lib/swap.ts";
import { findWalletCoins, type WalletCoin } from "./lib/walletCoins.ts";
import { signWithWallet } from "./referee/kingdomExternal.ts";

const keyOf = (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`;

export type ExternalSwapWallet = { wallet: SwapWallet; coins: WalletCoin[] };

// The own wallet as the swap sees it: all its coins on the addresses the game looks at, the bought PUSD and the
// change going to its first address (the one the game plays with)
export async function externalSwapWallet(provider: ElectrumNetworkProvider, pkhHex: string): Promise<ExternalSwapWallet> {
  const coins = await findWalletCoins(provider);
  const byKey = new Map(coins.map((c) => [keyOf(c.utxo), c]));
  const lock = p2pkhLock(hexToBin(pkhHex));
  const wallet: SwapWallet = {
    lock,
    tokenAddress: lockToAddress(lock, true),
    unlockP2PKH: () => {
      throw new Error("an own wallet signs its coins itself");
    },
    coins: coins.map((c) => c.utxo),
    unlockFor: (u: SpendableUtxo) => placeholderP2PKHUnlocker(byKey.get(keyOf(u))!.address),
    feeRate: 1.2,
  };
  return { wallet, coins };
}

// Plain BCH and PUSD across the own wallet's addresses: what the swap box shows and can spend
export function externalBalances(coins: WalletCoin[], pusdCategory: string): { sats: bigint; pusd: bigint } {
  let sats = 0n, pusd = 0n;
  for (const { utxo } of coins) {
    if (!utxo.token) sats += utxo.satoshis;
    else if (utxo.token.category === pusdCategory && !utxo.token.nft) pusd += utxo.token.amount;
  }
  return { sats, pusd };
}

// Ask the wallet to sign its inputs. Returns the signed transaction, or why nothing was sent.
export function signSwap(
  tx: SwapTx,
  coins: WalletCoin[],
  userPrompt: string,
  signal: AbortSignal,
): ReturnType<typeof signWithWallet> {
  return signOwnInputs(tx.builder, tx.walletInputs, tx.firstWalletInput, coins, userPrompt, signal);
}

// Any transaction whose own-wallet inputs are `inputs`, starting at input `first` (a swap: after the pool inputs; a
// withdrawal: all of them, from 0). The wallet signs those, each with the key of the address it sits on.
export async function signOwnInputs(
  builder: TransactionBuilder,
  inputs: SpendableUtxo[],
  first: number,
  coins: WalletCoin[],
  userPrompt: string,
  signal: AbortSignal,
): ReturnType<typeof signWithWallet> {
  const byKey = new Map(coins.map((c) => [keyOf(c.utxo), c]));
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const request = {
    transaction: {
      transaction: binToHex(encodeTransaction(wc.transaction)),
      sourceOutputs: toRelaySafe(wc.sourceOutputs),
      broadcast: false,
      userPrompt,
    },
    inputPaths: inputs.map((u, i): [number, string, number] => {
      const c = byKey.get(keyOf(u))!;
      return [first + i, c.path, c.index];
    }),
  } as unknown as Parameters<typeof manager.signTransaction>[0];
  return signWithWallet(request, signal);
}
