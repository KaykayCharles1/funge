// Swap BCH for PUSD against Cauldron's pools, the part with no page in it. Cauldron is a set of small pool
// contracts that anyone may trade with; CashLab (@cashlab/cauldron) picks the pools, does the pool arithmetic, builds
// the trade transaction and checks it. The game wallet signs its own coins through its signing capability
// (unlockP2PKH): the key never leaves src/wallet/. CashLab chooses the pools and the amounts; the transaction is
// built with CashScript, because CashLab's own builder needs the private key itself.
//   Pools: on mainnet from Cauldron's public list (indexer.riften.net); on chipnet, where Cauldron does not run,
//   from our own practice pool (scripts/create-chipnet-pool.ts).
import { binToHex, hexToBin, lockingBytecodeToCashAddress } from "@bitauth/libauth";
import { buildPoolV0UnlockingBytecode, ExchangeLab, type PoolV0, type TradeResult } from "@cashlab/cauldron";
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo, type Unlocker } from "cashscript";

export const MAX_PRICE_MOVE = 0.03; // refuse a swap that pays more than 3% over the best price before it
const FEE_PER_BYTE = 1n; // for CashLab's choice of pools
const FEE_RATE = 1.0; // sats per byte, the network's usual minimum
const PUSD_OUTPUT_SATS = 1_000n; // the BCH that carries the bought PUSD

export type SwapWallet = { lock: Uint8Array; unlockP2PKH: () => Unlocker };

export type SwapError = "no_pools" | "too_big" | "price_move" | "no_bch" | "pools_changed";
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

export type SwapQuote = {
  trade: TradeResult;
  category: string;
  pusd: bigint; // what the player gets
  sats: bigint; // what it costs in BCH, before the network fee
  priceMove: number; // how much more than the best price before the swap, 0.012 = 1.2%
};

// "I want this much PUSD": the cheapest way to get it from these pools
export function quote(pools: PoolV0[], category: string, pusdWanted: bigint): SwapQuote {
  if (pools.length === 0) throw new SwapFailure("no_pools");
  let trade: TradeResult;
  try {
    trade = lab.constructTradeBestRateForTargetDemand("BCH", category, pusdWanted, pools, FEE_PER_BYTE);
  } catch {
    throw new SwapFailure("too_big"); // more than the pools can give
  }
  // The best price before the swap: the cheapest pool's sats per PUSD unit
  const best = Math.min(...pools.map((p) => Number(p.output.amount) / Number(p.output.token.amount)));
  const paid = Number(trade.summary.supply) / Number(trade.summary.demand);
  return { trade, category, pusd: trade.summary.demand, sats: trade.summary.supply, priceMove: paid / best - 1 };
}

export type SwapTx = { hex: string; fee: bigint; pusd: bigint; sats: bigint };

// Build the trade with CashScript, as every game move is built. Cauldron's rule: each pool coin is spent and
// re-created at the same position, so the pools come first in both inputs and outputs. Then the game wallet's plain
// BCH coins (signed by the wallet), the PUSD to the game wallet and the BCH change.
export async function buildSwap(provider: NetworkProvider, wallet: SwapWallet, q: SwapQuote): Promise<SwapTx> {
  if (q.priceMove > MAX_PRICE_MOVE) throw new SwapFailure("price_move");
  const coins = (await provider.getUtxosForLockingBytecode(wallet.lock))
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : a.satoshis > b.satoshis ? -1 : 0));
  // largest coins first, until the price, the PUSD output's BCH and a generous fee are covered
  const need = q.sats + PUSD_OUTPUT_SATS + 5_000n;
  const paying: SpendableUtxo[] = [];
  let total = 0n;
  for (const c of coins) {
    if (total >= need) break;
    paying.push(c);
    total += c.satoshis;
  }
  if (total < need) throw new SwapFailure("no_bch");

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
      amount: p.output.amount + e.supply,
      token: { amount: p.output.token.amount - e.demand, category: p.output.token.token_id },
    });
  }
  builder.addInputs(paying, wallet.unlockP2PKH());
  builder.addOutput({ to: wallet.lock, amount: PUSD_OUTPUT_SATS, token: { amount: q.pusd, category: q.category } });
  try {
    builder.addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE });
  } catch {
    throw new SwapFailure("no_bch");
  }
  const hex = builder.build(); // CashScript refuses a transaction that would destroy tokens
  const inSats = total + q.trade.entries.reduce((s, e) => s + e.pool.output.amount, 0n);
  const fee = inSats - builder.outputs.reduce((s, o) => s + o.amount, 0n);
  return { hex, fee, pusd: q.pusd, sats: q.sats };
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
