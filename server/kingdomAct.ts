import { binToHex } from "@bitauth/libauth";
import type { Utxo } from "cashscript";
import { conquestMoney, decodeKingdomCommitment, previousOf, protectAmounts, type KingdomState } from "../src/lib/kingdom.ts";
import { ActError, invalid, type ActionHandler, type ValidateCtx, type Validated } from "./actTypes.ts";

// What the server checks before it signs. The contract enforces every money rule on the chain anyway;
// these checks give the player a clear, typed answer and keep the referee from signing nonsense.

const p2pkhHex = (pkh: string) => `76a914${pkh}88ac`;
const spends = (inp: ValidateCtx["tx"]["inputs"][number], u: Utxo) =>
  binToHex(inp.outpointTransactionHash) === u.txid && inp.outpointIndex === u.vout;
const isZero = (hex: string) => /^0+$/.test(hex);

// A waiting round has no king and no PUSD, so a conquest or protect can only be answered with "not open",
// before anything about the transaction's shape is looked at (a zero-token pot output cannot even exist).
function requireOpen(ctx: ValidateCtx): void {
  if (ctx.chain.kingdom && ctx.chain.kingdom.passCount < 1) throw new ActError("not_open", "Nobody has opened this round yet.");
}

function common(ctx: ValidateCtx) {
  const { game, chain, tx, body } = ctx;
  const params = game.kingdom;
  const state = chain.kingdom;
  const stateCoin = chain.stateUtxo;
  const potCoin = chain.potUtxo;
  if (!params || !state || !stateCoin) throw new ActError("round_over", "This round has no live state.");
  if (!potCoin) throw new ActError("chain_unavailable", "The chain view is not up to date yet. Try again in a moment.");
  if (tx.inputs.length < 3) return invalid("The transaction needs the state coin, the pot coin and at least one wallet input.");
  const in0 = tx.inputs[0]!;
  const in1 = tx.inputs[1]!;
  if (!spends(in0, stateCoin) || !spends(in1, potCoin)) {
    throw new ActError("state_changed", "The game moved on. Reload the round and try again.");
  }

  // wallet inputs: same count and outpoints as claimed, signed, no duplicates
  const walletTx = tx.inputs.slice(2);
  if (walletTx.length !== body.walletInputs.length) return invalid("walletInputs does not match the transaction inputs.");
  const seen = new Set<string>([`${stateCoin.txid}:${stateCoin.vout}`, `${potCoin.txid}:${potCoin.vout}`]);
  walletTx.forEach((inp, i) => {
    const claim = body.walletInputs[i]!;
    const key = `${binToHex(inp.outpointTransactionHash)}:${inp.outpointIndex}`;
    if (key !== `${claim.txid}:${claim.vout}`) invalid(`Wallet input ${i} does not match its description.`);
    if (seen.has(key)) invalid("The same coin is spent twice.");
    seen.add(key);
    if (inp.unlockingBytecode.length === 0) invalid(`Wallet input ${i} is not signed.`);
  });

  // outputs: the state goes back to the state contract, the pot back to the pot contract
  const out0 = tx.outputs[0];
  const out1 = tx.outputs[1];
  if (!out0 || !out1) return invalid("The transaction needs at least two outputs.");
  if (binToHex(out0.lockingBytecode) !== game.stateLockingBytecode) return invalid("Output 0 must go back to the state contract.");
  if (binToHex(out1.lockingBytecode) !== game.potLockingBytecode) return invalid("Output 1 must go back to the pot contract.");
  const nft = out0.token?.nft;
  if (!out0.token || !nft || nft.capability !== "mutable" || binToHex(out0.token.category) !== game.gameId) {
    return invalid("Output 0 must carry the game's state token.");
  }
  let next: KingdomState;
  try {
    next = decodeKingdomCommitment(binToHex(nft.commitment));
  } catch {
    return invalid("Output 0 has a malformed commitment.");
  }
  const potBefore = potCoin.token?.amount ?? 0n;
  const potAfter = out1.token && binToHex(out1.token.category) === game.pusdCategory ? out1.token.amount : null;
  if (potAfter === null) return invalid("Output 1 must hold PUSD.");
  return { game, params, state, tx, out1, next, potBefore, potAfter };
}

function validateOpen(ctx: ValidateCtx): Validated {
  const c = common(ctx);
  if (c.state.passCount !== 0) throw new ActError("state_changed", "Someone already opened this round. Reload and try again.");
  const n = c.next;
  if (n.passCount !== 1) return invalid("The new state must have pass count 1.");
  if (isZero(n.holderPkh)) return invalid("The new king's address is empty.");
  if (n.value !== c.params.openingPrice || n.protects !== 0 || !isZero(n.previous)) {
    return invalid("The new state must start at the opening value with no protects and no previous king.");
  }
  if (c.potAfter !== c.params.openingPrice) return invalid("The pot must hold exactly the opening price.");
  const delta = c.potAfter - c.potBefore;
  return {
    newHolder: n.holderPkh, newPassCount: 1, sign: { fn: "open", newHolder: n.holderPkh },
    moved: {
      actor: n.holderPkh, previousKing: null, paid: delta, refunded: 0n, toTreasury: delta, value: n.value, treasury: c.potAfter,
      protectsLeft: c.params.protectsPerReign - n.protects, conquests: 0,
    },
  };
}

function validateConquer(ctx: ValidateCtx): Validated {
  requireOpen(ctx);
  const c = common(ctx);
  const s = c.state;
  if (s.passCount < 1) throw new ActError("not_open", "Nobody has opened this round yet.");
  const n = c.next;
  if (n.passCount !== s.passCount + 1) {
    throw new ActError("state_changed", "The pass count does not follow the current state. Reload and try again.");
  }
  if (n.value !== s.value) throw new ActError("state_changed", "The kingdom's value changed. Reload and try again.");
  if (n.holderPkh === s.holderPkh) throw new ActError("already_king", "You already hold this throne.");
  if (isZero(n.holderPkh)) return invalid("The new king's address is empty.");
  if (n.protects !== 0) return invalid("A conquest resets the protects to zero.");
  if (n.previous !== previousOf(s.holderPkh)) return invalid("The dethroned king must be recorded as the previous king.");

  const money = conquestMoney(s.value, c.params);
  if (c.potAfter !== c.potBefore + money.poolGets) return invalid("The pool must grow by exactly the pool share.");
  const out2 = c.tx.outputs[2];
  if (!out2) return invalid("Output 2 must pay the dethroned king.");
  if (binToHex(out2.lockingBytecode) !== p2pkhHex(s.holderPkh)) return invalid("Output 2 must pay the dethroned king.");
  if (!out2.token || binToHex(out2.token.category) !== ctx.game.pusdCategory || out2.token.nft) {
    return invalid("The dethroned king must be paid in plain PUSD.");
  }
  if (out2.token.amount < money.kingGets) return invalid("The dethroned king must be paid in full.");
  if (out2.valueSatoshis < 1000n) return invalid("The payout output needs at least 1000 satoshis.");
  const toTreasury = c.potAfter - c.potBefore;
  return {
    newHolder: n.holderPkh, newPassCount: n.passCount, sign: { fn: "conquer", newHolder: n.holderPkh },
    moved: {
      actor: n.holderPkh, previousKing: s.holderPkh, paid: toTreasury + out2.token.amount, refunded: out2.token.amount, toTreasury,
      value: n.value, treasury: c.potAfter, protectsLeft: c.params.protectsPerReign, conquests: n.passCount - 1,
    },
  };
}

function validateProtect(ctx: ValidateCtx): Validated {
  requireOpen(ctx);
  const c = common(ctx);
  const s = c.state;
  if (s.passCount < 1) throw new ActError("not_open", "Nobody has opened this round yet.");
  // the king proves consent by spending a coin at their own address as the first wallet input (input 2)
  const first = ctx.body.walletInputs[0]!;
  if (first.lockingBytecode.toLowerCase() !== p2pkhHex(s.holderPkh)) {
    throw new ActError("not_king", "Only the king can protect the kingdom.");
  }
  const n = c.next;
  if (n.passCount !== s.passCount || n.holderPkh !== s.holderPkh || n.previous !== s.previous) {
    return invalid("A protect must not change the king, the pass count or the previous king.");
  }
  if (s.protects >= c.params.protectsPerReign) throw new ActError("no_protects_left", "No protects left in this reign.");
  if (n.value > c.params.cap) throw new ActError("walls_at_maximum", "The walls are at their maximum.");
  const amount = n.value - s.value;
  if (!protectAmounts(c.params.unit).includes(amount)) return invalid("A protect must add exactly 1, 5 or 10 PUSD.");
  if (n.protects !== s.protects + 1) return invalid("A protect uses exactly one of the king's protects.");
  if (c.potAfter !== c.potBefore + amount) return invalid("The pool must grow by exactly the protect amount.");
  return {
    newHolder: s.holderPkh, newPassCount: s.passCount, sign: { fn: "protect", amount },
    protect: { amount, value: n.value, used: n.protects },
    moved: {
      actor: s.holderPkh, previousKing: isZero(s.previous) ? null : s.previous, paid: amount, refunded: 0n, toTreasury: amount,
      value: n.value, treasury: c.potAfter, protectsLeft: c.params.protectsPerReign - n.protects, conquests: s.passCount - 1,
    },
  };
}

export const KINGDOM_HANDLERS: Record<string, ActionHandler> = {
  open: { fn: "open", validate: validateOpen },
  conquer: { fn: "conquer", validate: validateConquer },
  protect: { fn: "protect", validate: validateProtect },
};