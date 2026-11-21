// Swap BCH and PUSD (either way) against Cauldron's pools, the part with no page in it. Cauldron is a set of small pool
// contracts that anyone may trade with; CashLab (@cashlab/cauldron) picks the pools, does the pool arithmetic, builds
// the trade transaction and checks it. The game wallet signs its own coins through its signing capability
// (unlockP2PKH): the key never leaves src/wallet/. CashLab chooses the pools and the amounts; the transaction is
// built with CashScript, because CashLab's own builder needs the private key itself.
//   Pools: on mainnet from Cauldron's public list (indexer.riften.net); on chipnet, where Cauldron does not run,
//   from our own practice pool (scripts/create-chipnet-pool.ts).
import {
  binToHex, encodeDataPush, generateSigningSerializationBch, hash160, hash256, hexToBin, lockingBytecodeToCashAddress,
} from "@bitauth/libauth";
import { CONFIG } from "../config.ts";
import { buildPoolV0RedeemScriptBytecode, buildPoolV0UnlockingBytecode, ExchangeLab, type PoolV0, type TradeResult } from "@cashlab/cauldron";
import { TransactionBuilder, type NetworkProvider, type SignatureTemplate, type SpendableUtxo, type Unlocker } from "cashscript";

// Refuse a swap that pays more than this over the best price before it. Mainnet: 3%, against Cauldron's deep pools.
// Chipnet: 25%, because the practice pool is small (a mainnet-priced pool needs more test BCH than faucets give), so
// a swap of a few PUSD already moves its price by more than 3%. The quote shows the real rate either way.
export const MAX_PRICE_MOVE = CONFIG.network === "chipnet" ? 0.25 : 0.03;
const FEE_PER_BYTE = 1n; // for CashLab's choice of pools
const FEE_RATE = 1.0; // sats per byte, the network's usual minimum
const PUSD_OUTPUT_SATS = 1_000n; // the BCH that carries the bought PUSD
export const MIN_SELL_SATS = 1_000n; // a smaller swap would cost more in network fee than it buys

// The game wallet: one address, signed here (unlockP2PKH). An own wallet (WizardConnect): its coins across several
// addresses (coins), each with a placeholder the wallet signs later (unlockFor), and a slightly higher fee rate so
// the wallet's real signatures cannot take the transaction under the network's minimum.
export type SwapWallet = {
  lock: Uint8Array; // where the bought coins and the change go
  tokenAddress: string;
  unlockP2PKH: () => Unlocker;
  coins?: SpendableUtxo[];
  unlockFor?: (coin: SpendableUtxo) => Unlocker;
  feeRate?: number;
};

export type SwapError = "no_pools" | "too_big" | "too_small" | "price_move" | "no_bch" | "no_pusd" | "pools_changed";
export class SwapFailure extends Error {
  readonly code: SwapError;
  constructor(code: SwapError) {
    super(code);
    this.code = code;
  }
}

const lab = new ExchangeLab();

// The pool contract for an owner (the key that may withdraw it; anyone may trade with it)
export const poolLock = (ownerPkh: Uint8Array) => lab.generatePoolV0LockingBytecode({ withdraw_pubkey_hash: ownerPkh });

export function poolAddress(ownerPkh: Uint8Array, network: "mainnet" | "chipnet"): string {
  const r = lockingBytecodeToCashAddress({
    bytecode: poolLock(ownerPkh),
    prefix: network === "mainnet" ? "bitcoincash" : "bchtest",
    tokenSupport: true,
  });
  if (typeof r === "string") throw new Error(r);
  return r.address;
}

const pool = (ownerPkh: Uint8Array, txid: string, vout: number, sats: bigint, tokens: bigint, category: string): PoolV0 => ({
  version: "0",
  parameters: { withdraw_pubkey_hash: ownerPkh },
  outpoint: { txhash: hexToBin(txid), index: vout },
  output: { locking_bytecode: poolLock(ownerPkh), amount: sats, token: { amount: tokens, token_id: category } },
});

// Mainnet: Cauldron's list of active pools for a token (GET /cauldron/pool/active?token=...)
export type IndexerPool = { owner_pkh: string; txid: string; tx_pos: number; sats: number | string; tokens: number | string; token_id: string };
export function poolsFromIndexer(rows: IndexerPool[], category: string): PoolV0[] {
  return rows
    .filter((r) => r.token_id === category && /^[0-9a-f]{40}$/.test(r.owner_pkh) && /^[0-9a-f]{64}$/.test(r.txid))
    .map((r) => pool(hexToBin(r.owner_pkh), r.txid, r.tx_pos, BigInt(r.sats), BigInt(r.tokens), category));
}

// Chipnet: the coins sitting on our practice pool's contract
export async function poolsOnChain(provider: NetworkProvider, ownerPkh: Uint8Array, category: string): Promise<PoolV0[]> {
  const coins = await provider.getUtxosForLockingBytecode(poolLock(ownerPkh));
  return coins
    .filter((u) => u.token?.category === category && !u.token.nft && u.token.amount > 0n)
    .map((u) => pool(ownerPkh, u.txid, u.vout, u.satoshis, u.token!.amount, category));
}

// Which way: BCH to PUSD (buy PUSD), or PUSD to BCH (sell PUSD). `side` says which amount the player typed:
// "sell" is the top coin (what they give), "buy" the bottom one (what they get).
export type Direction = "toPusd" | "toBch";
export type Side = "sell" | "buy";

export type SwapQuote = {
  trade: TradeResult;
  category: string;
  direction: Direction;
  pusd: bigint; // PUSD the player gets (toPusd) or gives (toBch)
  sats: bigint; // BCH the player gives (toPusd) or gets (toBch), before the network fee
  poolFee: bigint; // sats that go to the pools' owners (Cauldron's 0.3%)
  priceMove: number; // how much worse than the best price before the swap, 0.012 = 1.2%
};

// The market price: sats per PUSD base unit across these pools
export function marketPrice(pools: PoolV0[]): number | null {
  const sats = pools.reduce((n, p) => n + Number(p.output.amount), 0);
  const units = pools.reduce((n, p) => n + Number(p.output.token.amount), 0);
  return units > 0 ? sats / units : null;
}

// The best rate these pools give for the amount the player typed
export function quote(pools: PoolV0[], category: string, amount: bigint, side: Side = "buy", direction: Direction = "toPusd"): SwapQuote {
  if (pools.length === 0) throw new SwapFailure("no_pools");
  const toPusd = direction === "toPusd";
  const supplyId = toPusd ? "BCH" : category;
  const demandId = toPusd ? category : "BCH";
  const satsSide = toPusd ? "sell" : "buy"; // the side whose amount is in sats
  if (side === satsSide && amount < MIN_SELL_SATS) throw new SwapFailure("too_small");
  let trade: TradeResult;
  try {
    trade = side === "buy"
      ? lab.constructTradeBestRateForTargetDemand(supplyId, demandId, amount, pools, FEE_PER_BYTE)
      : lab.constructTradeBestRateForTargetSupply(supplyId, demandId, amount, pools, FEE_PER_BYTE);
  } catch {
    throw new SwapFailure("too_big"); // more than the pools can give
  }
  const { supply, demand, trade_fee } = trade.summary;
  if (demand <= 0n) throw new SwapFailure("too_small");
  const sats = toPusd ? supply : demand;
  const pusd = toPusd ? demand : supply;
  if (sats < MIN_SELL_SATS) throw new SwapFailure("too_small");
  // The best price before the swap: the cheapest pool to buy from, or the dearest to sell to (sats per PUSD unit)
  const rates = pools.map((p) => Number(p.output.amount) / Number(p.output.token.amount));
  const rate = Number(sats) / Number(pusd);
  const priceMove = toPusd ? rate / Math.min(...rates) - 1 : Math.max(...rates) / rate - 1;
  return { trade, category, direction, pusd, sats, poolFee: trade_fee, priceMove };
}

// The most BCH a swap can spend: the plain BCH coins, less the BCH that carries the PUSD and room for the fee
export const SWAP_RESERVE = 4_000n;

// builder and walletInputs: for an own wallet, which signs the wallet's inputs (they follow the pool inputs)
export type SwapTx = {
  hex: string; fee: bigint; pusd: bigint; sats: bigint; direction: Direction;
  builder: TransactionBuilder; walletInputs: SpendableUtxo[]; firstWalletInput: number;
};

const largestFirst = (a: SpendableUtxo, b: SpendableUtxo) => (a.satoshis < b.satoshis ? 1 : a.satoshis > b.satoshis ? -1 : 0);
const tokensFirst = (a: SpendableUtxo, b: SpendableUtxo) =>
  a.token!.amount < b.token!.amount ? 1 : a.token!.amount > b.token!.amount ? -1 : 0;

// Build the trade with CashScript, as every game move is built. Cauldron's rule: each pool coin is spent and
// re-created at the same position, so the pools come first in both inputs and outputs. Then the game wallet's coins
// (signed by the wallet), what the player gets, and the change.
export async function buildSwap(provider: NetworkProvider, wallet: SwapWallet, q: SwapQuote): Promise<SwapTx> {
  if (q.priceMove > MAX_PRICE_MOVE) throw new SwapFailure("price_move");
  const toPusd = q.direction === "toPusd";
  const coins = wallet.coins ?? (await provider.getUtxosForLockingBytecode(wallet.lock));
  const feeRate = wallet.feeRate ?? FEE_RATE;
  const plainCoins = coins.filter((u) => !u.token).sort(largestFirst);
  const pick = (list: SpendableUtxo[], enough: (picked: SpendableUtxo[]) => boolean) => {
    const picked: SpendableUtxo[] = [];
    for (const c of list) {
      if (enough(picked)) break;
      picked.push(c);
    }
    return enough(picked) ? picked : null;
  };
  const satsOf = (list: SpendableUtxo[]) => list.reduce((n, u) => n + u.satoshis, 0n);

  let paying: SpendableUtxo[];
  if (toPusd) {
    // largest BCH coins first, until the price, the PUSD output's BCH and the fee are covered
    const picked = pick(plainCoins, (l) => satsOf(l) >= q.sats + SWAP_RESERVE);
    if (!picked) throw new SwapFailure("no_bch");
    paying = picked;
  } else {
    // largest PUSD coins first, until the PUSD sold is covered; the BCH the player gets pays the fee
    const pusdCoins = coins.filter((u) => u.token?.category === q.category && !u.token.nft).sort(tokensFirst);
    const picked = pick(pusdCoins, (l) => l.reduce((n, u) => n + u.token!.amount, 0n) >= q.pusd);
    if (!picked) throw new SwapFailure("no_pusd");
    paying = picked;
  }

  const attempt = (extra: SpendableUtxo[]) => {
    const builder = new TransactionBuilder({ provider });
    for (const e of q.trade.entries) {
      const p = e.pool;
      const unlockingBytecode = buildPoolV0UnlockingBytecode(p.parameters); // the trade path needs no signature
      builder.addInput(
        {
          txid: binToHex(p.outpoint.txhash),
          vout: p.outpoint.index,
          satoshis: p.output.amount,
          lockingBytecode: binToHex(p.output.locking_bytecode),
          token: { amount: p.output.token.amount, category: p.output.token.token_id },
        },
        { generateUnlockingBytecode: () => unlockingBytecode },
      );
    }
    for (const e of q.trade.entries) {
      const p = e.pool;
      builder.addOutput({
        to: p.output.locking_bytecode,
        amount: toPusd ? p.output.amount + e.supply : p.output.amount - e.demand,
        token: { amount: toPusd ? p.output.token.amount - e.demand : p.output.token.amount + e.supply, category: p.output.token.token_id },
      });
    }
    for (const c of [...paying, ...extra]) builder.addInput(c, wallet.unlockFor ? wallet.unlockFor(c) : wallet.unlockP2PKH());
    if (toPusd) {
      builder.addOutput({ to: wallet.lock, amount: PUSD_OUTPUT_SATS, token: { amount: q.pusd, category: q.category } });
    } else {
      builder.addTokenChangeOutputIfNeeded({ category: q.category, to: wallet.tokenAddress }); // PUSD not sold
    }
    builder.addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate }); // toBch: this is the BCH they get
    return { builder, inputs: [...paying, ...extra] };
  };
  let built: ReturnType<typeof attempt>;
  try {
    built = attempt([]);
  } catch {
    // selling PUSD for very little BCH: add a BCH coin to cover the fee
    if (toPusd || plainCoins.length === 0) throw new SwapFailure("no_bch");
    try {
      built = attempt([plainCoins[0]!]);
    } catch {
      throw new SwapFailure("no_bch");
    }
  }
  const hex = built.builder.build(); // CashScript refuses a transaction that would destroy tokens
  const inSats = satsOf(built.inputs) + q.trade.entries.reduce((n, e) => n + e.pool.output.amount, 0n);
  const fee = inSats - built.builder.outputs.reduce((n, o) => n + o.amount, 0n);
  return {
    hex, fee, pusd: q.pusd, sats: q.sats, direction: q.direction,
    builder: built.builder, walletInputs: built.inputs, firstWalletInput: q.trade.entries.length,
  };
}

// Send it. If someone traded with one of these pools a moment ago, the network refuses it and nothing is spent.
export async function sendSwap(provider: NetworkProvider, tx: SwapTx): Promise<string> {
  try {
    return await provider.sendRawTransaction(tx.hex);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/missing|spent|conflict|mempool|not found|unknown/i.test(text)) throw new SwapFailure("pools_changed");
    throw e;
  }
}

// For the pool's owner only (scripts/reset-chipnet-pool.ts): take a pool coin back. The withdraw path of the pool
// contract checks the owner's signature over the pool's own script, so this signs with that script as the covered
// bytecode rather than as a plain P2PKH coin.
export function poolWithdrawUnlocker(owner: SignatureTemplate): Unlocker {
  const redeem = buildPoolV0RedeemScriptBytecode({ withdraw_pubkey_hash: hash160(owner.publicKey) });
  return {
    generateUnlockingBytecode: ({ transaction, sourceOutputs, inputIndex }) => {
      const preimage = generateSigningSerializationBch(
        { inputIndex, sourceOutputs, transaction },
        { coveredBytecode: redeem, signingSerializationType: new Uint8Array([owner.sighashType | SIGHASH_FORKID]) },
      );
      const signature = owner.generateSignature(hash256(preimage));
      return Uint8Array.from([...encodeDataPush(signature), ...encodeDataPush(owner.publicKey), ...encodeDataPush(redeem)]);
    },
  };
}
const SIGHASH_FORKID = 0x40;
