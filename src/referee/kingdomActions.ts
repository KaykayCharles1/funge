import { binToHex, hexToBin } from "@bitauth/libauth";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider, SpendableUtxo } from "cashscript";
import { CONFIG } from "../config.ts";
import { COPY, errorText, notEnoughText, splitCoinsText } from "../copy.ts";
import { p2pkhLock, toVmCategory } from "../lib/chain.ts";
import { formatUnits } from "../lib/format.ts";
import type { GameKingdom } from "../lib/game.ts";
import { conquestMoney, decodeKingdomCommitment, encodeKingdomCommitment, previousOf, protectAmounts } from "../lib/kingdom.ts";
import type { KingdomState } from "../lib/kingdom.ts";
import { retry } from "../lib/retry.ts";
import type { LocalWallet } from "../wallet/local.ts";
import { act } from "./api.ts";
import type { ApiErrorCode, WalletInputClaim } from "./api.ts";

// Kingdom actions for the game wallet: open (first player) and conquer. The transaction is built here, the
// player's own coins are signed here, and the game server adds the referee signature to input 0 and broadcasts.

const FEE_RATE = 2;
const MIN_FEE_COIN_SATS = 6_000n; // a PUSD coin with less BCH than this needs a second coin for the fee
const PAYOUT_SATS = 1_000n; // BCH that travels with the dethroned king's PUSD payout (the contract wants at least 1000)

// The compiled contracts are passed in, so this file works in the browser (imported JSON) and in scripts (read from disk)
export type KingdomArtifacts = { pot: any; kingdom: any };

export type KingdomErrorCode =
  | ApiErrorCode | "price_changed" | "no_round" | "no_funds" | "needs_bch" | "mismatch" | "build_failed";
export type KingdomOutcome =
  | { ok: true; txid: string; passCount: number }
  | { ok: false; code: KingdomErrorCode; text: string };

const fail = (code: KingdomErrorCode, text: string): KingdomOutcome => ({ ok: false, code, text });

export function kingdomContracts(game: GameKingdom, provider: ElectrumNetworkProvider, artifacts: KingdomArtifacts) {
  const pot = new Contract(artifacts.pot, [toVmCategory(game.gameCategory)], { provider });
  const p = game.params;
  const state = new Contract(
    artifacts.kingdom,
    [
      hexToBin(pot.lockingBytecode),
      toVmCategory(game.pusdCategory),
      hexToBin(game.refereePubkey),
      BigInt(p.openingPrice),
      BigInt(p.feePercent),
      BigInt(p.cutPercent),
      BigInt(p.cap),
      BigInt(p.protectsPerReign),
      BigInt(p.unit),
      BigInt(p.fallbackBlocks),
    ],
    { provider },
  );
  const matches = state.tokenAddress === game.state.tokenAddress && pot.tokenAddress === game.pot.tokenAddress;
  return { pot, state, matches };
}

// The live coins of a Kingdom round. The pot is output 1 of the same transaction that made the state coin.
export async function readKingdomCoins(
  game: GameKingdom,
  provider: ElectrumNetworkProvider,
): Promise<{ stateUtxo: SpendableUtxo; potUtxo: SpendableUtxo; state: KingdomState } | null> {
  const [stateCoins, potCoins] = await Promise.all([
    retry(() => provider.getUtxos(game.state.address)),
    retry(() => provider.getUtxos(game.pot.address)),
  ]);
  const stateFound = stateCoins.find((u) => u.token?.nft && u.token.category === game.gameCategory);
  if (!stateFound?.token?.nft) return null;
  const potFound = potCoins.find((u) => u.txid === stateFound.txid && u.vout === 1);
  if (!potFound) return null;
  // The answer for an address does not carry the script, but the game file does
  const stateUtxo: SpendableUtxo = { ...stateFound, lockingBytecode: game.state.lockingBytecode };
  const potUtxo: SpendableUtxo = { ...potFound, lockingBytecode: game.pot.lockingBytecode };
  return { stateUtxo, potUtxo, state: decodeKingdomCommitment(stateFound.token.nft.commitment) };
}

// One PUSD coin that covers `need`, plus a plain BCH coin when that coin carries too little BCH for the fee
export function pickWalletCoins(coins: SpendableUtxo[], pusdCategory: string, need: bigint):
  { ok: true; inputs: SpendableUtxo[] } | { ok: false; code: "no_funds" | "needs_bch"; have: bigint } {
  const plain = coins.filter((u) => u.token && u.token.category === pusdCategory && !u.token.nft);
  const have = plain.reduce((sum, u) => sum + u.token!.amount, 0n);
  const pusdCoin = plain.filter((u) => u.token!.amount >= need).sort((a, b) => (a.token!.amount < b.token!.amount ? 1 : -1))[0];
  if (!pusdCoin) return { ok: false, code: "no_funds", have };
  if (pusdCoin.satoshis >= MIN_FEE_COIN_SATS) return { ok: true, inputs: [pusdCoin] };
  const bchCoin = coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  if (!bchCoin) return { ok: false, code: "needs_bch", have };
  return { ok: true, inputs: [pusdCoin, bchCoin] };
}

export const claimsFor = (wallet: LocalWallet, inputs: SpendableUtxo[]): WalletInputClaim[] =>
  inputs.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: String(u.satoshis),
    lockingBytecode: binToHex(wallet.lock),
    ...(u.token ? { token: { amount: String(u.token.amount), category: u.token.category } } : {}),
  }));

type KingdomFailure = Extract<KingdomOutcome, { ok: false }>;
export type KingdomPlan = { pay: bigint; money: ReturnType<typeof conquestMoney> | null; next: KingdomState };

// What an open or a conquest costs and what the new state is, from the state on the chain.
// The contract enforces the same numbers. Used by both kinds of wallet.
export function planKingdomAction(
  game: GameKingdom,
  s: KingdomState,
  action: "open" | "conquer",
  pkhHex: string,
  expectedPay: bigint,
): { ok: true; plan: KingdomPlan } | KingdomFailure {
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);
  const params = { feePercent: BigInt(game.params.feePercent), cutPercent: BigInt(game.params.cutPercent) };
  if (action === "open") {
    if (s.passCount !== 0) return fail("state_changed", errorText("state_changed")) as KingdomFailure;
  } else {
    if (s.passCount < 1) return fail("not_open", errorText("not_open")) as KingdomFailure;
    if (s.holderPkh === pkhHex) return fail("already_king", errorText("already_king")) as KingdomFailure;
  }
  const money = action === "conquer" ? conquestMoney(s.value, params) : null;
  const pay = money ? money.payment : BigInt(game.params.openingPrice);
  // The player agreed to expectedPay; never spend more than that without asking again
  if (pay !== expectedPay) {
    return fail("price_changed", `The price is now ${fmt(pay)} PUSD. Check it and try again.`) as KingdomFailure;
  }
  const next: KingdomState =
    action === "open"
      ? { passCount: 1, holderPkh: pkhHex, value: BigInt(game.params.openingPrice), protects: 0, previous: "00".repeat(11) }
      : { passCount: s.passCount + 1, holderPkh: pkhHex, value: s.value, protects: 0, previous: previousOf(s.holderPkh) };
  return { ok: true, plan: { pay, money, next } };
}

// The unlocking script for input 0 (the state). The referee signature is a throwaway; the server replaces it.
export function stateUnlocker(state: Contract, action: "open" | "conquer", pkhHex: string) {
  const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)));
  const newHolder = hexToBin(pkhHex);
  return action === "open" ? state.unlock.open(newHolder, placeholder) : state.unlock.conquer(newHolder, placeholder);
}

// Outputs 0 to 2 of an open or a conquest: the state, the pot and (conquest only) the dethroned king's payout.
// The caller adds the inputs before and the change outputs after.
export function addKingdomOutputs(
  builder: TransactionBuilder,
  o: {
    game: GameKingdom; state: Contract; pot: Contract; stateUtxo: SpendableUtxo; potUtxo: SpendableUtxo;
    s: KingdomState; plan: KingdomPlan;
  },
): void {
  const { game, state, pot, stateUtxo, potUtxo, s, plan } = o;
  const potBefore = potUtxo.token?.amount ?? 0n;
  builder
    .addOutput({
      to: state.tokenAddress,
      amount: stateUtxo.satoshis,
      token: {
        amount: 0n,
        category: game.gameCategory,
        nft: { capability: "mutable", commitment: encodeKingdomCommitment(plan.next) },
      },
    })
    .addOutput({
      to: pot.tokenAddress,
      amount: potUtxo.satoshis,
      token: { amount: potBefore + (plan.money ? plan.money.poolGets : plan.pay), category: game.pusdCategory },
    });
  if (plan.money) {
    // output 2: the dethroned king's payout, a plain P2PKH output (the contract reads it by its exact script)
    builder.addOutput({
      to: p2pkhLock(hexToBin(s.holderPkh)),
      amount: PAYOUT_SATS,
      token: { amount: plan.money.kingGets, category: game.pusdCategory },
    });
  }
}

// Turns a failed coin pick into the player's message
export function coinFailure(picked: { code: "no_funds" | "needs_bch"; have: bigint }, pay: bigint): KingdomFailure {
  const fmt = (n: bigint) => formatUnits(n, CONFIG.pusdDecimals);
  return (
    picked.code === "needs_bch"
      ? fail("needs_bch", COPY.grab.needsBch)
      : fail("no_funds", picked.have >= pay ? splitCoinsText(fmt(pay)) : notEnoughText(fmt(pay), fmt(picked.have)))
  ) as KingdomFailure;
}

export async function kingdomAct(opts: {
  game: GameKingdom;
  provider: ElectrumNetworkProvider;
  wallet: LocalWallet;
  action: "open" | "conquer";
  expectedPay: bigint; // what the player agreed to pay; never spend more than this without asking again
  artifacts: KingdomArtifacts;
}): Promise<KingdomOutcome> {
  const { game, provider, wallet, action, expectedPay, artifacts } = opts;

  const { pot, state, matches } = kingdomContracts(game, provider, artifacts);
  if (!matches) return fail("mismatch", COPY.grab.mismatch);

  let live: Awaited<ReturnType<typeof readKingdomCoins>>;
  let walletCoins: SpendableUtxo[];
  try {
    [live, walletCoins] = await Promise.all([
      readKingdomCoins(game, provider),
      retry(() => provider.getUtxosForLockingBytecode(wallet.lock)),
    ]);
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!live) return fail("no_round", COPY.grab.noRound);
  const { stateUtxo, potUtxo, state: s } = live;

  const planned = planKingdomAction(game, s, action, wallet.pkhHex, expectedPay);
  if (!planned.ok) return planned;
  const { plan } = planned;

  const picked = pickWalletCoins(walletCoins, game.pusdCategory, plan.pay);
  if (!picked.ok) return coinFailure(picked, plan.pay);
  const inputs = picked.inputs;

  let txHex: string;
  try {
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, stateUnlocker(state, action, wallet.pkhHex))
      .addInput(potUtxo, pot.unlock.release());
    for (const coin of inputs) builder.addInput(coin, wallet.unlockP2PKH());
    addKingdomOutputs(builder, { game, state, pot, stateUtxo, potUtxo, s, plan });
    builder
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE });
    txHex = builder.build();
  } catch (e) {
    console.error(e);
    return fail("build_failed", COPY.grab.buildFailed);
  }

  const res = await act(game.gameCategory, { action, txHex, walletInputs: claimsFor(wallet, inputs) });
  if (res.ok) return { ok: true, txid: res.txid, passCount: res.passCount };
  if (res.message) console.error(`${action} refused (${res.error}): ${res.message}`);
  return fail(res.error, errorText(res.error));
}


// ---------- protect ----------

// What a protect does to the state. Without `force` the rules are checked here first, so a player gets a clear answer
// without a round trip. `force` skips those checks so a test can see what the SERVER and the contract answer.
export function planProtect(
  game: GameKingdom,
  s: KingdomState,
  pkhHex: string,
  amount: bigint,
  force = false,
): { ok: true; next: KingdomState } | KingdomFailure {
  if (s.passCount < 1) return fail("not_open", errorText("not_open")) as KingdomFailure;
  if (!force) {
    if (s.holderPkh !== pkhHex) return fail("not_king", errorText("not_king")) as KingdomFailure;
    if (s.protects >= game.params.protectsPerReign) return fail("no_protects_left", errorText("no_protects_left")) as KingdomFailure;
    if (s.value + amount > BigInt(game.params.cap)) return fail("walls_at_maximum", errorText("walls_at_maximum")) as KingdomFailure;
    if (!protectAmounts(BigInt(game.params.unit)).includes(amount)) {
      return fail("invalid", "A protect adds exactly 1, 5 or 10 PUSD.") as KingdomFailure;
    }
  }
  return { ok: true, next: { ...s, value: s.value + amount, protects: s.protects + 1 } };
}

// Outputs 0 and 1 of a protect: the state with the raised value, and the pot with the payment added.
export function addProtectOutputs(
  builder: TransactionBuilder,
  o: { game: GameKingdom; state: Contract; pot: Contract; stateUtxo: SpendableUtxo; potUtxo: SpendableUtxo; next: KingdomState; amount: bigint },
): void {
  const { game, state, pot, stateUtxo, potUtxo, next, amount } = o;
  builder
    .addOutput({
      to: state.tokenAddress,
      amount: stateUtxo.satoshis,
      token: { amount: 0n, category: game.gameCategory, nft: { capability: "mutable", commitment: encodeKingdomCommitment(next) } },
    })
    .addOutput({
      to: pot.tokenAddress,
      amount: potUtxo.satoshis,
      token: { amount: (potUtxo.token?.amount ?? 0n) + amount, category: game.pusdCategory },
    });
}

// The unlocking script for input 0 in a protect. The referee signature is a throwaway; the server replaces it.
export function protectUnlocker(state: Contract, amount: bigint) {
  const placeholder = new SignatureTemplate(crypto.getRandomValues(new Uint8Array(32)));
  return state.unlock.protect(placeholder, amount);
}

// The king pays 1, 5 or 10 PUSD into the pool and raises the kingdom's value. The wallet's PUSD coin is the first wallet
// input (input 2): the contract takes it as proof that the king agreed, because it sits at the king's address.
export async function kingdomProtect(opts: {
  game: GameKingdom;
  provider: ElectrumNetworkProvider;
  wallet: LocalWallet;
  amount: bigint;
  artifacts: KingdomArtifacts;
  force?: boolean; // tests only: skip the checks made here, so the server's own answer can be seen
}): Promise<KingdomOutcome> {
  const { game, provider, wallet, amount, artifacts } = opts;

  const { pot, state, matches } = kingdomContracts(game, provider, artifacts);
  if (!matches) return fail("mismatch", COPY.grab.mismatch);

  let live: Awaited<ReturnType<typeof readKingdomCoins>>;
  let walletCoins: SpendableUtxo[];
  try {
    [live, walletCoins] = await Promise.all([
      readKingdomCoins(game, provider),
      retry(() => provider.getUtxosForLockingBytecode(wallet.lock)),
    ]);
  } catch {
    return fail("chain_unavailable", errorText("chain_unavailable"));
  }
  if (!live) return fail("no_round", COPY.grab.noRound);
  const { stateUtxo, potUtxo, state: s } = live;

  const planned = planProtect(game, s, wallet.pkhHex, amount, opts.force ?? false);
  if (!planned.ok) return planned;

  const picked = pickWalletCoins(walletCoins, game.pusdCategory, amount);
  if (!picked.ok) return coinFailure(picked, amount);
  const inputs = picked.inputs;

  let txHex: string;
  try {
    const builder = new TransactionBuilder({ provider })
      .addInput(stateUtxo, protectUnlocker(state, amount))
      .addInput(potUtxo, pot.unlock.release());
    for (const coin of inputs) builder.addInput(coin, wallet.unlockP2PKH());
    addProtectOutputs(builder, { game, state, pot, stateUtxo, potUtxo, next: planned.next, amount });
    builder
      .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: wallet.tokenAddress })
      .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE });
    txHex = builder.build();
  } catch (e) {
    console.error(e);
    return fail("build_failed", COPY.grab.buildFailed);
  }

  const res = await act(game.gameCategory, { action: "protect", txHex, walletInputs: claimsFor(wallet, inputs) });
  if (res.ok) return { ok: true, txid: res.txid, passCount: res.passCount };
  if (res.message) console.error(`protect refused (${res.error}): ${res.message}`);
  return fail(res.error, errorText(res.error));
}