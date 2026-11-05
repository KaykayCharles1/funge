import type { Transaction } from "@bitauth/libauth";
import type { ChainState } from "./chain.ts";
import type { ServerGame } from "./games.ts";

export type ActErrorCode =
  | "invalid" | "state_changed" | "too_late" | "round_over"
  | "paused" | "network_busy" | "chain_unavailable" | "outcome_unknown" | "not_over"
  // Kingdom
  | "not_open" | "protect_locked" | "not_king" | "already_king" | "walls_at_maximum" | "no_protects_left";

const STATUS: Record<ActErrorCode, number> = {
  invalid: 400, state_changed: 409, too_late: 409, round_over: 409, not_over: 409,
  paused: 503, network_busy: 503, chain_unavailable: 503, outcome_unknown: 503,
  not_open: 409, protect_locked: 409, already_king: 409, walls_at_maximum: 409, no_protects_left: 409, not_king: 403,
};

export class ActError extends Error {
  code: ActErrorCode;
  constructor(code: ActErrorCode, message: string) {
    super(message);
    this.code = code;
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export function invalid(message: string): never {
  throw new ActError("invalid", message);
}

export type Capability = "none" | "mutable" | "minting";
export type WalletInputClaim = {
  txid: string;
  vout: number;
  satoshis: bigint;
  lockingBytecode: string;
  token?: { amount: bigint; category: string; nft?: { capability: Capability; commitment: string } };
};
export type ActBody = { action: string; txHex: string; walletInputs: WalletInputClaim[] };

// Which contract function the referee signs for, and with what arguments
export type SignCall =
  | { fn: "open" | "conquer"; newHolder: string }
  | { fn: "protect"; amount: bigint };

export type ValidateCtx = { game: ServerGame; chain: ChainState; tx: Transaction; body: ActBody };
// What a move did, worked out from the checked transaction. Goes into the event so a scene needs no other lookup.
export type Moved = {
  actor: string; // key hash of the player who moved
  previousKing: string | null; // the dethroned king (conquest only)
  paid: bigint; // PUSD the player paid in total
  refunded: bigint; // PUSD paid out to the dethroned king
  toTreasury: bigint; // PUSD added to the pool
  value: bigint; // the kingdom's value after
  treasury: bigint; // the pool after
  protectsLeft: number;
  conquests: number;
};
export type Validated = {
  newHolder: string;
  newPassCount: number;
  moved: Moved;
  sign: SignCall;
  protect?: { amount: bigint; value: bigint; used: number }; // Kingdom protect only
};
export type ActionHandler = { fn: "open" | "conquer" | "protect"; validate: (ctx: ValidateCtx) => Validated };