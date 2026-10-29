import { EVENT_HISTORY, GRACE_SECONDS, RESET_SECONDS, type ActionType } from "../src/refereeParams.ts";
import type { Clock } from "./clock.ts";
import type { EventData, EventRecord, RoundRecord, Store } from "./store.ts";

export type ChainView = { live: boolean; passCount: number }; // live = the state coin still exists
export type Listener = (gameId: string, event: EventRecord) => void;

// The one place that decides what kind of action a contract function is.
export function classifyAction(fn: "pass" | "settle"): ActionType | null {
  return fn === "pass" ? "steal" : null; // settle does not reset the deadline
}

export class RoundManager {
  private store: Store;
  private clock: Clock;
  private listeners = new Set<Listener>();

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
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

  // Call once at startup, before serving. Downtime counts as a pause for open, unpaused rounds.
  resumeAfterRestart(): void {
    const hb = this.store.data.heartbeat;
    if (hb === null) return;
    const down = Math.max(0, this.clock.now() - hb);
    for (const r of Object.values(this.store.data.rounds)) {
      if (r.status === "open" && r.deadline !== null && !r.paused) {
        r.deadline += down;
        this.publish(r, "clock_resumed", "restart", { downtimeMs: down, deadline: r.deadline });
      }
    }
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
      r.status = "open";
      r.deadline = now + RESET_SECONDS.steal * 1000;
      r.seenPassCount = chain.passCount;
      this.publish(r, "deadline_changed", "observed_on_chain", { deadline: r.deadline });
    } else if (r.seenPassCount === undefined) {
      r.seenPassCount = chain.passCount;
    }
    if (r.status === "open" && !r.paused && r.deadline !== null && now >= r.deadline + GRACE_SECONDS * 1000) {
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
}