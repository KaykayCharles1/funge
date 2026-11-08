import { clockAfterConquestMs, clockAfterOpenMs, validateClock, wholeSeconds, type ClockSettings } from "../src/lib/kingdomClock.ts";
import { EVENT_HISTORY, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../src/refereeParams.ts";
import type { Clock } from "./clock.ts";
import type { EventData, EventRecord, RoundRecord, SceneState, Store } from "./store.ts";

export type ChainView = { live: boolean; passCount: number; scene?: SceneState | null }; // live = the state coin still exists
export type Listener = (gameId: string, event: EventRecord) => void;

// What each contract function means for the clock. "protect" is real but never touches the clock.
export type KingdomAction = "open" | "conquer" | "protect";
export function classifyKingdomAction(fn: "open" | "conquer" | "protect" | "settle"): KingdomAction | null {
  return fn === "settle" ? null : fn;
}

export type ProtectCheck =
  | { ok: true; remainingMs: number }
  | { ok: false; why: "not_open" | "paused" | "locked"; remainingMs: number | null };

// The clock fields every event and the round description carry (docs/EVENTS.md)
export type ClockInfo = {
  clockSeconds: number | null; // seconds on the clock right after the current king's move (null while waiting)
  nextClockSeconds: number; // deprecated: what a conquest right now would set the clock to (the open's cap while waiting)
  clockCapSeconds: number;
  conquestAddSeconds: number;
  conquestMinSeconds: number;
};

export class RoundManager {
  private clocks = new Map<string, ClockSettings>(); // the clock settings of each game
  private store: Store;
  private clock: Clock;
  private listeners = new Set<Listener>();
  private holds = new Map<string, number>(); // moves that arrived in time and are still being processed

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  // Sets the clock settings of a game
  setClock(gameId: string, settings: ClockSettings): void {
    validateClock(settings);
    this.clocks.set(gameId, settings);
  }

  private settings(gameId: string, who: string): ClockSettings {
    const s = this.clocks.get(gameId);
    if (!s) throw new Error(who + ": this game has no clock settings");
    return s;
  }

  // Time left on the clock at `now` (frozen while paused), never below 0; null when no clock runs
  private leftMs(r: RoundRecord, now: number): number | null {
    if (r.deadline === null) return null;
    return Math.max(0, r.paused ? r.deadline - r.paused.since : r.deadline - now);
  }

  // The clock fields for events and the round description. Null for a game without clock settings.
  clockInfo(gameId: string): ClockInfo | null {
    const s = this.clocks.get(gameId);
    if (!s) return null;
    const r = this.ensure(gameId);
    const left = r.status === "waiting" ? null : this.leftMs(r, this.clock.now());
    // Rounds saved before this field existed: the time left stands in for it
    const clockSeconds = r.deadline === null ? null : r.lastClockSeconds ?? (left === null ? null : wholeSeconds(left));
    return {
      clockSeconds,
      nextClockSeconds: wholeSeconds(left === null ? clockAfterOpenMs(s) : clockAfterConquestMs(left, s)),
      clockCapSeconds: s.capSeconds,
      conquestAddSeconds: s.addSeconds,
      conquestMinSeconds: s.minSeconds,
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

  // Player profiles (server/players.ts): the chosen name and portrait of a key in this round, if any
  playerOf(gameId: string, key: string | null): { name: string; avatarId: string } | null {
    if (!key) return null;
    return this.ensure(gameId).players?.[key.slice(0, 22).toLowerCase()] ?? null;
  }
  // Saved with the move's event, which is published right after
  setPlayer(gameId: string, key: string, profile: { name: string; avatarId: string }): void {
    const r = this.ensure(gameId);
    r.players = { ...(r.players ?? {}), [key.slice(0, 22).toLowerCase()]: profile };
  }

  // Every event carries the kingdom as it stands (king, value, treasury, ...), the deadline and the clock fields,
  // so a scene can be drawn from the event alone. The fields a move adds itself win over these defaults.
  private publish(r: RoundRecord, type: string, reason: string, data?: EventData): EventRecord {
    const info = this.clockInfo(r.gameId);
    const clock: EventData = info
      ? {
          ...(info.clockSeconds !== null ? { clockSeconds: info.clockSeconds } : {}),
          nextClockSeconds: info.nextClockSeconds,
          clockCapSeconds: info.clockCapSeconds,
          conquestAddSeconds: info.conquestAddSeconds,
          conquestMinSeconds: info.conquestMinSeconds,
        }
      : {};
    const full: EventData = {
      ...(r.scene ?? {}),
      deadline: r.deadline,
      ...clock,
      ...(data ?? {}),
    };
    const ev: EventRecord = { seq: r.nextSeq++, roundId: r.gameId, at: this.clock.now(), type, reason, data: full };
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

  // A move that arrived in time calls this while it is being processed; the round cannot become "over" until it releases.
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
      this.publish(r, "round_settled", "chain", { treasury: "0", payout: null });
      return r;
    }
    if (chain.scene) r.scene = chain.scene;
    const seen = r.seenPassCount ?? (r.status === "waiting" ? 0 : chain.passCount);
    if ((r.status === "waiting" || r.status === "open") && chain.passCount > seen) {
      // A move the timer has not accounted for (not made through /act): the same rule as a move made here,
      // from now. An open gets the cap; a conquest adds to the time left.
      const s = this.settings(gameId, "observe");
      const wasOpen = r.status === "open";
      const ms = wasOpen ? clockAfterConquestMs(this.leftMs(r, now) ?? 0, s) : clockAfterOpenMs(s);
      r.status = "open";
      r.deadline = now + ms;
      r.seenPassCount = chain.passCount;
      r.lastClockSeconds = wholeSeconds(ms);
      this.publish(r, "deadline_changed", "observed_on_chain", {
        deadline: r.deadline, clockSeconds: r.lastClockSeconds, passCount: chain.passCount,
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

  // Open or conquest, after a successful broadcast, inside the round lock. "Left" is measured now, at the
  // instant the move is recorded, and the new deadline counts from this same instant: so a delay in the network
  // or in the player's approval neither adds nor takes time. The open gets the cap. A conquest gets
  // min(CAP, max(MIN, left + ADD)): in effect the old deadline plus ADD, at most the cap from now, and
  // ADD from now when it lands inside the grace (left is never below 0).
  applyKingdomAction(
    gameId: string,
    action: "open" | "conquer",
    passCount: number,
    data?: EventData,
    scene?: SceneState,
  ): RoundRecord {
    const s = this.settings(gameId, "applyKingdomAction");
    if (action === "open" ? passCount !== 1 : passCount < 2) throw new Error("applyKingdomAction: pass count " + passCount + " does not fit " + action);
    const r = this.ensure(gameId);
    const now = this.clock.now();
    const left = action === "conquer" ? (this.leftMs(r, now) ?? 0) : 0;
    const ms = action === "open" ? clockAfterOpenMs(s) : clockAfterConquestMs(left, s);
    r.status = "open";
    r.deadline = now + ms;
    r.seenPassCount = passCount;
    r.lastClockSeconds = wholeSeconds(ms);
    if (scene) r.scene = scene;
    this.publish(r, "deadline_changed", action, {
      deadline: r.deadline, action, passCount, clockSeconds: r.lastClockSeconds,
      // the time a conquest actually added (smaller when the cap cut it); the open has no "before"
      ...(action === "conquer" ? { addedSeconds: wholeSeconds(ms - left) } : {}),
      ...(data ?? {}),
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

  // Protect, after a successful broadcast. Informational: the clock, the status and the pass count stay as they are.
  applyProtect(gameId: string, data?: EventData, scene?: SceneState): RoundRecord {
    const r = this.ensure(gameId);
    if (r.status !== "open" || r.deadline === null || r.paused) throw new Error("applyProtect: the round is not running");
    if (scene) r.scene = scene;
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
    const events = resync ? [] : r.events.filter((e) => e.seq > after).map((e) => (e.roundId ? e : { ...e, roundId: gameId }));
    return { resync, lastSeq: r.nextSeq - 1, events };
  }

    markSettled(gameId: string, txid: string, by: string, data?: EventData): RoundRecord {
    const r = this.ensure(gameId);
    if (r.status === "settled") return r;
    r.status = "settled";
    // After the payout the treasury is empty; "payout" is what the winner received (null when the settlement was not seen)
    const payout = data && "pot" in data ? data.pot ?? null : null;
    this.publish(r, "round_settled", by, { txid, treasury: "0", payout, ...(data ?? {}) });
    return r;
  }
}