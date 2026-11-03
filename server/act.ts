import { binToHex, decodeTransaction, encodeTransaction, hexToBin } from "@bitauth/libauth";
import type { Transaction } from "@bitauth/libauth";
import type { LibauthOutput } from "cashscript";
import { GRACE_SECONDS } from "../src/refereeParams.ts";
import { ActError, invalid } from "./actTypes.ts";
import type { ActBody, ActErrorCode, ActionHandler, Capability, SignCall, WalletInputClaim } from "./actTypes.ts";
import type { ChainReader, ChainState } from "./chain.ts";
import type { Clock } from "./clock.ts";
import type { ServerGame } from "./games.ts";
import { KINGDOM_HANDLERS } from "./kingdomAct.ts";
import type { LockRunner } from "./lock.ts";
import { classifyKingdomAction, type RoundManager } from "./rounds.ts";
import type { RoundRecord } from "./store.ts";
import type { Unconfirmed } from "./unconfirmed.ts";
import { safeText } from "../src/lib/safeLog.ts";

export { ActError };
export type { ActBody, ActErrorCode, SignCall, WalletInputClaim };

export type Referee = {
  // Returns the unlocking bytecode for input 0 (the state coin) with the referee signature inside
  sign: (game: ServerGame, tx: Transaction, sourceOutputs: LibauthOutput[], call: SignCall) => Uint8Array;
  broadcast: (hex: string) => Promise<string>;
  settle: (game: ServerGame, chain: ChainState) => string;
};

export type ActDeps = {
  manager: RoundManager;
  chain: ChainReader;
  clock: Clock;
  referee: Referee;
  locks: LockRunner;
  unconfirmed: Unconfirmed;
  sleep: (ms: number) => Promise<void>;
};

const isHex = (s: unknown, length?: number): boolean =>
  typeof s === "string" && /^[0-9a-f]*$/i.test(s) && s.length % 2 === 0 && (length === undefined || s.length === length);
const isDigits = (s: unknown): boolean => typeof s === "string" && /^[0-9]{1,20}$/.test(s);

export function parseActBody(raw: unknown): ActBody {
  if (!raw || typeof raw !== "object") return invalid("The body must be a JSON object.");
  const b = raw as Record<string, unknown>;
  if (typeof b.action !== "string") return invalid("action is missing.");
  if (!isHex(b.txHex) || (b.txHex as string).length === 0 || (b.txHex as string).length > 20_000) {
    return invalid("txHex is missing or too long.");
  }
  if (!Array.isArray(b.walletInputs) || b.walletInputs.length === 0 || b.walletInputs.length > 10) {
    return invalid("walletInputs is missing.");
  }
  const walletInputs = b.walletInputs.map((w: unknown, i: number): WalletInputClaim => {
    if (!w || typeof w !== "object") return invalid(`walletInputs[${i}] is not an object.`);
    const x = w as Record<string, unknown>;
    if (!isHex(x.txid, 64) || !Number.isInteger(x.vout) || (x.vout as number) < 0 || !isDigits(x.satoshis) || !isHex(x.lockingBytecode)) {
      return invalid(`walletInputs[${i}] is malformed.`);
    }
    let token: WalletInputClaim["token"];
    if (x.token !== undefined) {
      const t = x.token as Record<string, unknown> | null;
      if (!t || typeof t !== "object" || !isDigits(t.amount) || !isHex(t.category, 64)) {
        return invalid(`walletInputs[${i}].token is malformed.`);
      }
      let nft: { capability: Capability; commitment: string } | undefined;
      if (t.nft !== undefined) {
        const n = t.nft as Record<string, unknown> | null;
        if (!n || typeof n !== "object" || !["none", "mutable", "minting"].includes(n.capability as string) || !isHex(n.commitment)) {
          return invalid(`walletInputs[${i}].token.nft is malformed.`);
        }
        nft = { capability: n.capability as Capability, commitment: n.commitment as string };
      }
      token = { amount: BigInt(t.amount as string), category: t.category as string, ...(nft ? { nft } : {}) };
    }
    return {
      txid: x.txid as string, vout: x.vout as number, satoshis: BigInt(x.satoshis as string),
      lockingBytecode: x.lockingBytecode as string, ...(token ? { token } : {}),
    };
  });
  return { action: b.action, txHex: b.txHex as string, walletInputs };
}

const toLibauth = (
  lockingHex: string, satoshis: bigint,
  token?: { amount: bigint; category: string; nft?: { capability: Capability; commitment: string } },
): LibauthOutput => ({
  lockingBytecode: hexToBin(lockingHex),
  valueSatoshis: satoshis,
  token: token
    ? {
        amount: token.amount,
        category: hexToBin(token.category),
        nft: token.nft ? { capability: token.nft.capability, commitment: hexToBin(token.nft.commitment) } : undefined,
      }
    : undefined,
});

export function mapBroadcastError(e: unknown, deps: ActDeps, id: string, pause = true): ActError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/too-long-mempool-chain|too many unconfirmed|ancestor|descendant/i.test(msg)) {
    deps.unconfirmed.saturate(id);
    if (pause) deps.manager.pause(id, "network_busy");
    return new ActError("network_busy", "The network is busy. The clock is paused until the next block.");
  }
  if (/txn-mempool-conflict|missingorspent|missing inputs|already spent|conflict/i.test(msg)) {
    return new ActError("state_changed", "Someone else got there first. Reload the round and try again.");
  }
  if (/websocket|establish connection|failed to connect|timed? ?out|closed|socket/i.test(msg)) {
    return new ActError("outcome_unknown", "We could not confirm that the network received your move. Check the pass number before trying again.");
  }
  return new ActError("invalid", `The network rejected the transaction: ${safeText(msg).slice(0, 200)}`);}

export type ActResult = { txid: string; passCount: number; king: string; deadline: number | null; serverNow: number; lastSeq: number };

export async function executeAct(deps: ActDeps, game: ServerGame, raw: unknown): Promise<ActResult> {
  const body = parseActBody(raw);
  const handler = Object.prototype.hasOwnProperty.call(KINGDOM_HANDLERS, body.action) ? KINGDOM_HANDLERS[body.action] : undefined;
  if (!handler) throw new ActError("invalid", `Unknown action "${body.action}".`);
  const id = game.gameId;
  const arrivedAt = deps.clock.now(); // timing is judged by when the request arrived, not by how long our network checks take

  // A move that arrived in time keeps the round open while it is processed, so nobody sees "Round is over" flash by
  const r0 = deps.manager.get(id);
  const inTime = r0.status === "open" && r0.deadline !== null && arrivedAt < r0.deadline + GRACE_SECONDS * 1000;
  const release = inTime ? deps.manager.hold(id) : () => {};
  try {
    return await runAct(deps, game, body, handler, arrivedAt);
  } finally {
    release();
  }
}

async function runAct(deps: ActDeps, game: ServerGame, body: ActBody, handler: ActionHandler, arrivedAt: number): Promise<ActResult> {
  const id = game.gameId;

  return deps.locks(id, async () => {
    const { manager, chain, clock } = deps;
    if (manager.get(id).status === "settled") throw new ActError("round_over", "The round is over.");
    
    // 1. Latest chain view. If it does not yet show our own last move, wait briefly.
    const behind = (c: ChainState | undefined) => !c || (c.live && c.passCount < (manager.get(id).seenPassCount ?? 0));
    let c: ChainState | undefined;
    for (let t = 0; t < 6; t++) {
      try {
        c = await chain.refresh(game);
      } catch {
        c = undefined;
      }
      if (!behind(c)) break;
      if (t < 5) await deps.sleep(500);
    }
    if (!c || behind(c)) throw new ActError("chain_unavailable", "The chain view is not up to date yet. Try again in a moment.");

    // 2. Timer rules
    const before = manager.get(id);
    const statusBefore = before.status;
    const deadlineBefore = before.deadline;
    const round = manager.observe(id, { live: c.live, passCount: c.passCount });
    // In time means: the request arrived before the deadline plus the grace, however long the checks above took
    const onTime = deadlineBefore !== null && arrivedAt < deadlineBefore + GRACE_SECONDS * 1000;
    if (round.status === "over" && !onTime) {
      throw new ActError(
        statusBefore === "over" ? "round_over" : "too_late",
        statusBefore === "over" ? "The round is over." : "Too late: the deadline has passed.",
      );
    }
    
    if (!c.live || round.status === "settled") throw new ActError("round_over", "The round is over.");
    if (round.paused) throw new ActError("paused", "The clock is paused. Try again shortly.");

    // 2b. Kingdom protect has its own clock rule: closed in the last PROTECT_LOCKOUT_SECONDS (conquest is not affected)
    if (handler.fn === "protect") {
      const pc = manager.protectCheck(id, arrivedAt);
      if (!pc.ok) {
        if (pc.why === "paused") throw new ActError("paused", "The clock is paused. Try again shortly.");
        if (pc.why === "not_open") throw new ActError("not_open", "Nobody can protect a kingdom that is not in play.");
        throw new ActError("protect_locked", "Protect is closed in the last seconds before the deadline.");
      }
    }

    // 3. Legal action?
    const decoded = decodeTransaction(hexToBin(body.txHex));
    if (typeof decoded === "string") throw new ActError("invalid", "The transaction could not be read.");
    const tx = decoded;
    const checked = handler.validate({ game, chain: c, tx, body });

    // 4. Near the node's unconfirmed chain limit: pause with a clear message
    if (!deps.unconfirmed.canSend(id)) {
      manager.pause(id, "network_busy");
      throw new ActError("network_busy", "The network is busy. The clock is paused until the next block.");
    }

    // 5. Referee signature goes into input 0; the source outputs of the contract coins come from the chain
    const sourceOutputs: LibauthOutput[] = [
      toLibauth(game.stateLockingBytecode, c.stateUtxo!.satoshis, c.stateUtxo!.token),
      toLibauth(game.potLockingBytecode, c.potUtxo!.satoshis, c.potUtxo!.token),
      ...body.walletInputs.map((w) => toLibauth(w.lockingBytecode, w.satoshis, w.token)),
    ];
    tx.inputs[0]!.unlockingBytecode = deps.referee.sign(game, tx, sourceOutputs, checked.sign);
    const hex = binToHex(encodeTransaction(tx));

    // 6. Broadcast
    let txid: string;
    try {
      txid = await deps.referee.broadcast(hex);
    } catch (e) {
      throw mapBroadcastError(e, deps, id);
    }

    // 7. Success: set the clock (or leave it alone, for protect) and publish the event
    deps.unconfirmed.record(id);
    let r: RoundRecord;
    if (handler.fn === "protect") {
      if (!checked.protect) throw new Error("protect without its details");
      r = manager.applyProtect(id, {
        txid, king: checked.newHolder, amount: checked.protect.amount.toString(),
        value: checked.protect.value.toString(), protectsUsed: checked.protect.used,
      });
    } else {
      if (classifyKingdomAction(handler.fn) === null) throw new Error("action has no deadline reset");
      r = manager.applyKingdomAction(id, handler.fn, checked.newPassCount, { txid, king: checked.newHolder });
    }
    chain.invalidate(id);
    return { txid, passCount: checked.newPassCount, king: checked.newHolder, deadline: r.deadline, serverNow: clock.now(), lastSeq: r.nextSeq - 1 };
  });
}

export { GRACE_SECONDS };