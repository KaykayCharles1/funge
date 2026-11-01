import { clockSecondsFor, nextClockSecondsFor, validateBell, type BellSettings } from "../src/lib/bell.ts";
import { EVENT_HISTORY, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS, RESET_SECONDS, type ActionType } from "../src/refereeParams.ts";
import type { Clock } from "./clock.ts";
import type { EventData, EventRecord, RoundRecord, Store } from "./store.ts";

export type ChainView = { live: boolean; passCount: number }; // live = the state coin still exists
export type Listener = (gameId: string, event: EventRecord) => void;

// The one place that decides what kind of action a contract function is.
export function classifyAction(fn: "pass" | "settle"): ActionType | null {
  return fn === "pass" ? "steal" : null; // settle does not reset the deadline
}

// Kingdom: what each contract function means for the clock. "protect" is real but never touches the clock.
export type KingdomAction = "open" | "conquer" | "protect";
export function classifyKingdomAction(fn: "open" | "conquer" | "protect" | "settle"): KingdomAction | null {
  return fn === "settle" ? null : fn;
}

export type ProtectCheck =
  | { ok: true; remainingMs: number }
  | { ok: false; why: "not_open" | "paused" | "locked"; remainingMs: number | null };

export class RoundManager {
  private bells = new Map<string, BellSettings>(); // games that use the bell clock (Kingdom)
  private store: Store;
  private clock: Clock;
  private listeners = new Set<Listener>();
  private holds = new Map<string, number>(); // grabs that arrived in time and are still being processed

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  // Marks a game as a Kingdom game: its clock follows the bell instead of a fixed reset
  setBell(gameId: string, settings: BellSettings): void {
    validateBell(settings);
    this.bells.set(gameId, settings);
  }

  // For the round description: the clock this pass got, and the clock the next conquest will set
  bellInfo(gameId: string, passCount: number): { clockSeconds: number | null; nextClockSeconds: number; floorSeconds: number } | null {
    const s = this.bells.get(gameId);
    if (!s) return null;
    return {
      clockSeconds: passCount >= 1 ? clockSecondsFor(passCount, s) : null,
      nextClockSeconds: passCount >= 1 ? nextClockSecondsFor(passCount, s) : s.startSeconds,
      floorSeconds: s.floorSeconds,
    };
  }

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  flush(): Promise<void> {
    return this.store.save();
  }

  ensure(gameId: string): RoundRecord {
    let r = this.store.data.rounds[gameId];
    if (!r) {
      r = { gameId, status: "waiting", deadline: null, paused: null, nextSeq: 1, events: [] };
      this.store.data.rounds[gameId] = r;
    }
    return r;
  }

  get(gameId: string): RoundRecord {
    return this.ensure(gameId);
  }

  private publish(r: RoundRecord, type: string, reason: string, data?: EventData): EventRecord {
    const ev: EventRecord = { seq: r.nextSeq++, at: this.clock.now(), type, reason, ...(data ? { data } : {}) };
    r.events.push(ev);
    if (r.events.length > EVENT_HISTORY) r.events.splice(0, r.events.length - EVENT_HISTORY);
    this.store.save().catch((e) => console.error("state save failed:", e instanceof Error ? e.message : String(e)));
    for (const l of this.listeners) l(r.gameId, ev);
    return ev;
  }

  // Heartbeat: remember "the server was alive at this moment".
  heartbeat(): void {
    this.store.data.heartbeat = this.clock.now();
    this.store.save().catch((e) => console.error("heartbeat save failed:", e instanceof Error ? e.message : String(e)));
  }

  // Call once at startup, before serving. Downtime counts as a pause for open, unpaused rounds of the
  // games that are loaded now (rounds of old games are left alone).
  resumeAfterRestart(only?: string[]): void {
    const hb = this.store.data.heartbeat;
    if (hb === null) return;
    const down = Math.max(0, this.clock.now() - hb);
    for (const r of Object.values(this.store.data.rounds)) {
      if (only && !only.includes(r.gameId)) continue;
      if (r.status === "open" && r.deadline !== null && !r.paused) {
        r.deadline += down;
        this.publish(r, "clock_resumed", "restart", { downtimeMs: down, deadline: r.deadline });
      }
    }
  }

  // Removes settled rounds of games that are not loaded any more. Unsettled ones are kept: the contract may still owe a payout.
  pruneSettled(keep: string[]): number {
    let removed = 0;
    for (const [id, r] of Object.entries(this.store.data.rounds)) {
      if (r.status === "settled" && !keep.includes(id)) {
        delete this.store.data.rounds[id];
        removed++;
      }
    }
    return removed;
  }

  // A grab that arrived in time calls this while it is being processed; the round cannot become "over" until it releases.
  hold(gameId: string): () => void {
    this.holds.set(gameId, (this.holds.get(gameId) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.holds.get(gameId) ?? 1) - 1;
      if (n <= 0) this.holds.delete(gameId);
      else this.holds.set(gameId, n);
    };
  }

    observe(gameId: string, chain: ChainView): RoundRecord {
    const r = this.ensure(gameId);
    const now = this.clock.now();
    if (r.status === "settled") return r;
    if (!chain.live) {
      r.status = "settled";
      this.publish(r, "round_settled", "chain");
      return r;
    }
    const seen = r.seenPassCount ?? (r.status === "waiting" ? 0 : chain.passCount);
    if ((r.status === "waiting" || r.status === "open") && chain.passCount > seen) {
      // A steal the timer has not accounted for (not made through /act): restart the clock from now
      const bell = this.bells.get(gameId);
      const seconds = bell ? clockSecondsFor(chain.passCount, bell) : RESET_SECONDS.steal;
      r.status = "open";
      r.deadline = now + seconds * 1000;
      r.seenPassCount = chain.passCount;
      this.publish(r, "deadline_changed", "observed_on_chain", {
        deadline: r.deadline,
        ...(bell ? { clockSeconds: seconds, nextClockSeconds: nextClockSecondsFor(chain.passCount, bell), passCount: chain.passCount } : {}),
      });
    } else if (r.seenPassCount === undefined) {
      r.seenPassCount = chain.passCount;
    }
    if (r.status === "open" && !r.paused && r.deadline !== null && !this.holds.get(gameId) && now >= r.deadline + GRACE_SECONDS * 1000) {
      r.status = "over";
      this.publish(r, "round_over", "deadline", { deadline: r.deadline });
    }
    return r;
  }

  // Called by the act endpoint after a successful broadcast.
  applyAction(
    gameId: string,
    type: ActionType,
    reason: string,
    opts?: { passCount?: number; data?: EventData },
  ): RoundRecord {
    const r = this.ensure(gameId);
    r.status = "open";
    r.deadline = this.clock.now() + RESET_SECONDS[type] * 1000;
    if (opts?.passCount !== undefined) r.seenPassCount = opts.passCount;
    this.publish(r, "deadline_changed", reason, { deadline: r.deadline, action: type, ...(opts?.data ?? {}) });
    return r;
  }

  // Kingdom open or conquest, after a successful broadcast: the clock is set to the bell for this pass.
  applyKingdomAction(
    gameId: string,
    action: "open" | "conquer",
    passCount: number,
    data?: EventData,
  ): RoundRecord {
    const bell = this.bells.get(gameId);
    if (!bell) throw new Error("applyKingdomAction: this game has no bell");
    if (action === "open" ? passCount !== 1 : passCount < 2) throw new Error(`applyKingdomAction: pass count ${passCount} does not fit "${action}"`);
    const r = this.ensure(gameId);
    const seconds = clockSecondsFor(passCount, bell);
    r.status = "open";
    r.deadline = this.clock.now() + seconds * 1000;
    r.seenPassCount = passCount;
    this.publish(r, "deadline_changed", action, {
      deadline: r.deadline, action, passCount, clockSeconds: seconds, nextClockSeconds: nextClockSecondsFor(passCount, bell), ...(data ?? {}),
    });
    return r;
  }

  // Is a protect allowed right now? Judged by when the request arrived. The last PROTECT_LOCKOUT_SECONDS
  // before the deadline are closed (exactly 30.000 s left is closed, 30.001 s is open). Conquest is not affected.
  protectCheck(gameId: string, arrivedAt: number, lockoutSeconds = PROTECT_LOCKOUT_SECONDS): ProtectCheck {
    const r = this.ensure(gameId);
    if (r.status !== "open" || r.deadline === null) return { ok: false, why: "not_open", remainingMs: null };
    if (r.paused) return { ok: false, why: "paused", remainingMs: r.deadline - r.paused.since };
    const remainingMs = r.deadline - arrivedAt;
    if (remainingMs <= lockoutSeconds * 1000) return { ok: false, why: "locked", remainingMs };
    return { ok: true, remainingMs };
  }

  // Kingdom protect, after a successful broadcast. Informational: the clock, the status and the pass count stay as they are.
  applyProtect(gameId: string, data?: EventData): RoundRecord {
    const r = this.ensure(gameId);
    if (r.status !== "open" || r.deadline === null || r.paused) throw new Error("applyProtect: the round is not running");
    this.publish(r, "protect_applied", "protect", { deadline: r.deadline, ...(data ?? {}) });
    return r;
  }

  pause(gameId: string, reason: string): void {
    const r = this.ensure(gameId);
    if (r.paused) return;
    r.paused = { since: this.clock.now(), reason };
    this.publish(r, "clock_paused", reason);
  }

  resume(gameId: string, reason = "manual"): void {
    const r = this.ensure(gameId);
    if (!r.paused) return;
    const length = this.clock.now() - r.paused.since;
    r.paused = null;
    if (r.deadline !== null && r.status === "open") r.deadline += length;
    this.publish(r, "clock_resumed", reason, { pausedMs: length, deadline: r.deadline });
  }

  // For reconnecting clients. resync = true means the history no longer reaches back: reload the round.
  eventsAfter(gameId: string, after: number): { resync: boolean; lastSeq: number; events: EventRecord[] } {
    const r = this.ensure(gameId);
    const first = r.events[0];
    const resync = first !== undefined && after < first.seq - 1;
    return { resync, lastSeq: r.nextSeq - 1, events: resync ? [] : r.events.filter((e) => e.seq > after) };
  }

    markSettled(gameId: string, txid: string, by: string, data?: EventData): RoundRecord {
    const r = this.ensure(gameId);
    if (r.status === "settled") return r;
    r.status = "settled";
    this.publish(r, "round_settled", by, { txid, ...(data ?? {}) });
    return r;
  }
}