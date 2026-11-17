// Withdraw from the game wallet to the player's own wallet, the part with no page in it: read the address they
// pasted, read an amount they typed, and build and send the transfer. The key stays in src/wallet/: this only uses
// the wallet's signing capability (unlockP2PKH).
import { binToHex, decodeCashAddress } from "@bitauth/libauth";
import { TransactionBuilder, type NetworkProvider, type Output, type SpendableUtxo, type Unlocker } from "cashscript";
import { lockToAddress, p2pkhLock } from "./chain.ts";

export const FEE_RATE = 1.0; // sats per byte, the network's usual minimum
const DUST = 546n; // the smallest BCH-only output the network relays

export type WithdrawWallet = {
  pkhHex: string;
  lock: Uint8Array;
  tokenAddress: string;
  unlockP2PKH: () => Unlocker;
};

export type DestinationError = "empty" | "invalid" | "network" | "script" | "self";
export type Destination = { ok: true; address: string; lock: Uint8Array } | { ok: false; error: DestinationError };

// A pasted address: with or without its "bchtest:" / "bitcoincash:" prefix, plain (q) or token-aware (z).
// Only a personal wallet address (P2PKH) is accepted: a script address could be a contract that never pays out.
export function readDestination(text: string, network: "mainnet" | "chipnet", ownPkhHex: string): Destination {
  const raw = text.trim().replace(/\s+/g, "");
  if (!raw) return { ok: false, error: "empty" };
  const prefix = network === "mainnet" ? "bitcoincash" : "bchtest";
  const full = raw.includes(":") ? raw.toLowerCase() : `${prefix}:${raw.toLowerCase()}`;
  const decoded = decodeCashAddress(full);
  if (typeof decoded === "string") return { ok: false, error: "invalid" };
  if (decoded.prefix !== prefix) return { ok: false, error: "network" };
  if (decoded.type !== "p2pkh" && decoded.type !== "p2pkhWithTokens") return { ok: false, error: "script" };
  if (binToHex(decoded.payload) === ownPkhHex.toLowerCase()) return { ok: false, error: "self" };
  const lock = p2pkhLock(decoded.payload);
  return { ok: true, lock, address: lockToAddress(lock, true) }; // token-aware form: the same wallet, and PUSD is allowed
}

// "12.5" with 2 decimals -> 1250n; null when it is not a plain positive-or-zero number with at most that many decimals
export function readAmount(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return 0n;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export type WithdrawRequest = {
  to: Uint8Array; // the destination's locking bytecode (readDestination)
  pusd: bigint; // units of PUSD to send
  sats: bigint | "all"; // BCH to send, or everything left after the other outputs and the fee
  nfts: boolean; // also send the trophies and other NFTs
};

export type WithdrawPlan = {
  builder: TransactionBuilder;
  pusd: bigint;
  sats: bigint; // BCH that reaches the destination, including what travels with the PUSD and NFT outputs
  nfts: number;
  fee: bigint;
};

export type WithdrawError = "nothing" | "no_pusd" | "no_bch" | "too_small" | "busy";
export class WithdrawFailure extends Error {
  readonly code: WithdrawError;
  constructor(code: WithdrawError) {
    super(code);
    this.code = code;
  }
}

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// Builds the transfer from all of the wallet's coins. What is not sent comes back to the game wallet:
// the rest of the PUSD, other tokens, the NFTs when they stay, and the BCH change.
export async function planWithdraw(
  provider: NetworkProvider,
  wallet: WithdrawWallet,
  pusdCategory: string,
  req: WithdrawRequest,
): Promise<WithdrawPlan> {
  const coins = await provider.getUtxosForLockingBytecode(wallet.lock);
  const isPusd = (u: SpendableUtxo) => u.token?.category === pusdCategory && !u.token.nft;
  const pusdHeld = sum(coins.filter(isPusd).map((u) => u.token!.amount));
  const nftCoins = coins.filter((u) => u.token?.nft);
  if (req.pusd === 0n && req.sats !== "all" && req.sats === 0n && !(req.nfts && nftCoins.length > 0)) {
    throw new WithdrawFailure("nothing");
  }
  if (req.pusd > pusdHeld) throw new WithdrawFailure("no_pusd");
  if (req.sats !== "all" && req.sats > 0n && req.sats < DUST) throw new WithdrawFailure("too_small");

  const home = wallet.tokenAddress;
  const builder = new TransactionBuilder({ provider }).addInputs(coins, wallet.unlockP2PKH());
  const outs: Output[] = [];
  let toThem = 0n;
  if (req.pusd > 0n) {
    const o: Output = { to: req.to, amount: 1_000n, token: { amount: req.pusd, category: pusdCategory } };
    outs.push(o);
    toThem += o.amount;
  }
  for (const u of nftCoins) {
    const o: Output = { to: req.nfts ? req.to : home, amount: u.satoshis, token: u.token! };
    outs.push(o);
    if (req.nfts) toThem += o.amount;
  }
  if (req.sats !== "all" && req.sats > 0n) {
    outs.push({ to: req.to, amount: req.sats });
    toThem += req.sats;
  }
  builder.addOutputs(outs);
  // Fungible tokens not sent (the rest of the PUSD, any other token) go back to the game wallet
  const categories = new Set(coins.filter((u) => u.token && !u.token.nft).map((u) => u.token!.category));
  for (const category of categories) builder.addTokenChangeOutputIfNeeded({ category, to: home });

  const before = builder.outputs.length;
  try {
    builder.addBchChangeOutputIfNeeded({ to: req.sats === "all" ? req.to : wallet.lock, feeRate: FEE_RATE });
  } catch {
    throw new WithdrawFailure("no_bch"); // not enough BCH for the outputs and the fee
  }
  const added = builder.outputs.length > before ? builder.outputs[builder.outputs.length - 1]!.amount : 0n;
  if (req.sats === "all") {
    if (added === 0n && toThem === 0n) throw new WithdrawFailure("no_bch");
    toThem += added;
  }
  const fee = sum(coins.map((u) => u.satoshis)) - sum(builder.outputs.map((o) => o.amount));
  return { builder, pusd: req.pusd, sats: toThem, nfts: req.nfts ? nftCoins.length : 0, fee };
}

export async function sendWithdraw(plan: WithdrawPlan): Promise<string> {
  const sent = await plan.builder.send();
  return sent.txid;
}
