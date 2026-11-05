// The director turns what the page announces into what the field shows.
// Queue rule (docs/ANIMATION_BRIEF.md): play the full scene only when nothing is waiting; one waiting: short;
// two or more: quick. More than 3 waiting: drop them all and snap to the latest state. The HUD never lags the
// latest event by more than 1.5 s. A gap in seq, a resync or a new round: cancel everything and snap.
import { pauseText } from "../copy.ts";
import type { RefereeEvent, RoundSnapshot, RoundStatus } from "../referee/api.ts";
import { serverNow } from "../referee/clock.ts";
import { money } from "./hud.ts";
import type { Identity } from "./identity.ts";
import type { BattlefieldScene, SceneRun } from "./scene.ts";

export type FieldState = {
  roundId: string;
  status: RoundStatus;
  king: string | null;
  value: bigint; // base units
  treasury: bigint;
  protectsLeft: number;
  conquests: number;
  openingPrice: bigint;
  deadline: number | null; // server time, ms
  clockMs: number | null; // the bell length the current king got
  pausedSince: number | null; // server time the clock froze, or null
};

const big = (v: unknown, fallback = 0n): bigint => {
  try {
    return v === null || v === undefined ? fallback : BigInt(String(v));
  } catch {
    return fallback;
  }
};
const num = (v: unknown, fallback: number | null): number | null => (typeof v === "number" ? v : fallback);

export function stateFromSnapshot(s: RoundSnapshot, openingPrice: bigint): FieldState {
  const k = s.kingdom ?? null;
  return {
    roundId: s.gameId,
    status: s.status,
    king: s.king,
    value: big(k?.value),
    treasury: big(s.pot),
    protectsLeft: k?.protectsLeft ?? 0,
    conquests: Math.max(0, s.passCount - 1),
    openingPrice: big(k?.openingPrice, openingPrice),
    deadline: s.deadline,
    clockMs: k?.clockSeconds ? k.clockSeconds * 1000 : null,
    pausedSince: s.paused ? s.paused.since : null,
  };
}

// Events carry the kingdom as it stands after the change (docs/EVENTS.md)
export function stateFromEvent(e: RefereeEvent, before: FieldState): FieldState {
  const d = e.data ?? {};
  const status: RoundStatus =
    e.type === "round_settled" ? "settled" : e.type === "round_over" ? "over" : d.king ? "open" : before.status;
  const clockSeconds = num(d.clockSeconds, null);
  return {
    roundId: e.roundId,
    status,
    king: typeof d.king === "string" ? d.king : null,
    value: big(d.value, before.value),
    treasury: big(d.treasury, before.treasury),
    protectsLeft: num(d.protectsLeft, before.protectsLeft) ?? 0,
    conquests: num(d.conquests, before.conquests) ?? 0,
    openingPrice: before.openingPrice,
    deadline: num(d.deadline, before.deadline),
    clockMs: clockSeconds !== null ? clockSeconds * 1000 : before.clockMs,
    pausedSince: e.type === "clock_paused" ? e.at : e.type === "clock_resumed" ? null : before.pausedSince,
  };
}

const EMPTY: FieldState = {
  roundId: "", status: "waiting", king: null, value: 0n, treasury: 0n, protectsLeft: 0, conquests: 0, openingPrice: 0n,
  deadline: null, clockMs: null, pausedSince: null,
};

type Mode = "full" | "short" | "quick";
type Kind = "open" | "conquer" | "over" | "settle";
// Scene lengths in ms. Open and conquer from the brief; round over and settle chosen to match.
const LENGTH: Record<Kind, Record<Mode, number>> = {
  open: { full: 1800, short: 1000, quick: 400 },
  conquer: { full: 1400 + 1800 + 1500 + 1600, short: 3500, quick: 1200 },
  over: { full: 1500, short: 800, quick: 300 },
  settle: { full: 3000, short: 1500, quick: 800 },
};
const MAX_WAITING = 3;
const HUD_LAG_MS = 1500;

type Item = { kind: Kind; event: RefereeEvent; after: FieldState };

export type DirectorStats = { playing: string | null; waiting: number; dropped: number; snaps: number; lastSeq: number };

export class Director {
  private scene: BattlefieldScene;
  private kingOf: (s: FieldState) => Identity | null;
  private nextCost: (s: FieldState) => bigint | null;
  private latest: FieldState | null = null; // after every event received so far
  private queue: Item[] = [];
  private playing: { item: Item; mode: Mode; run: SceneRun } | null = null;
  private lastSeq = 0;
  private hudTimer: ReturnType<typeof setTimeout> | null = null;
  private dropped = 0;
  private snaps = 0;
  onChange: (s: DirectorStats) => void = () => {};

  constructor(scene: BattlefieldScene, kingOf: (s: FieldState) => Identity | null, nextCost: (s: FieldState) => bigint | null) {
    this.scene = scene;
    this.kingOf = kingOf;
    this.nextCost = nextCost;
  }

  get state(): FieldState | null {
    return this.latest;
  }

  stats(): DirectorStats {
    const p = this.playing;
    return { playing: p ? `${p.item.kind} (${p.mode})` : null, waiting: this.queue.length, dropped: this.dropped, snaps: this.snaps, lastSeq: this.lastSeq };
  }

  // Draw a state at once and forget every scene (first frame, resync, gap, too many waiting)
  snap(state: FieldState): void {
    this.queue = [];
    this.playing = null;
    this.scene.cancelScenes();
    this.latest = state;
    this.draw(state);
    this.snaps++;
    this.changed();
  }

  onSnapshot(s: RoundSnapshot, openingPrice: bigint): void {
    const state = stateFromSnapshot(s, openingPrice);
    const newRound = this.latest?.roundId !== state.roundId;
    const restarted = s.lastSeq === 0 && this.lastSeq > 0; // the round's history starts over (a fresh mock run)
    if (newRound || restarted || s.lastSeq > this.lastSeq) {
      // First frame, a new round, or events we never saw (a resync): start from the snapshot
      this.lastSeq = s.lastSeq;
      this.snap(state);
      this.skyFromSnapshot(s);
      return;
    }
    if (s.lastSeq < this.lastSeq) return; // older than what we have
    // Same events as ours: take the clock from it (pauses, a pushed deadline), redraw only when idle
    const l = this.latest!;
    this.latest = { ...l, deadline: state.deadline, pausedSince: state.pausedSince, clockMs: state.clockMs ?? l.clockMs };
    if (!this.playing && this.queue.length === 0) this.draw(this.latest);
    this.skyFromSnapshot(s);
  }

  // A snapshot (page load mid-round) sets the sky. A gap around 30 s, so a snapshot just before or after the
  // 30 s warning neither undoes nor cuts short the warning's crossfade.
  private skyFromSnapshot(s: RoundSnapshot): void {
    if (s.status !== "open" || s.remainingMs === null) return;
    if (s.remainingMs < 29_000 && !this.scene.isDusk) this.scene.setDusk(true, 0);
    if (s.remainingMs > 31_000 && this.scene.isDusk) this.scene.setDusk(false, 0);
  }

  onEvent(e: RefereeEvent): void {
    const before = this.latest ?? EMPTY;
    if (e.seq > 0) {
      const gap = this.lastSeq > 0 && e.seq > this.lastSeq + 1;
      const restarted = e.seq === 1 && this.lastSeq > 1;
      if (e.roundId !== before.roundId || gap || restarted) {
        // A new round or a gap: the event is complete, so snap to it; the next snapshot confirms
        this.lastSeq = e.seq;
        this.snap(stateFromEvent(e, { ...before, roundId: e.roundId }));
        return;
      }
      if (e.seq <= this.lastSeq) return; // seen already
      this.lastSeq = e.seq;
    }
    const after = stateFromEvent(e, before);
    this.latest = after;
    this.instant(e, after);

    const kind = kindOf(e);
    if (kind) {
      this.queue.push({ kind, event: e, after });
      if (this.queue.length > MAX_WAITING) {
        this.dropped += this.queue.length;
        this.snap(after);
        return;
      }
      this.next();
      this.hurry();
    } else if (!this.playing && this.queue.length === 0 && e.type !== "clock_warning") {
      this.draw(after); // protect, pause, resume: nothing to wait for
    }
    this.scheduleHud();
    this.changed();
  }

  // Bell ring and time, every frame
  tick(): void {
    const s = this.latest;
    if (!s || s.status !== "open" || s.deadline === null) {
      this.scene.hud.setClock(null, null);
      return;
    }
    const rem = s.pausedSince !== null ? s.deadline - s.pausedSince : s.deadline - serverNow();
    this.scene.hud.setClock(Math.max(0, rem), s.clockMs);
  }

  // What happens at once, whatever is playing
  private instant(e: RefereeEvent, after: FieldState): void {
    const sc = this.scene;
    if (e.type === "clock_warning" && e.reason === "30s") sc.setDusk(true);
    if (e.type === "deadline_changed") sc.setDusk(false);
    if (e.type === "protect_applied") sc.flash(`+${money(big(e.data?.amount))}`);
    if (e.type === "clock_paused") sc.hud.ribbon(pauseText(e.reason), "alert");
    if (e.type === "clock_resumed") sc.hud.ribbon(null);
    if (e.type === "deadline_changed" && e.reason === "observed_on_chain") {
      // Someone moved on the chain directly: no scene, snap to the event's state
      this.lastSeq = Math.max(this.lastSeq, e.seq);
      this.snap(after);
    }
  }

  private next(): void {
    if (this.playing || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    const mode = modeFor(this.queue.length);
    const playing = { item, mode, run: this.scene.playScene(label(item.kind, mode), LENGTH[item.kind][mode]) };
    this.playing = playing;
    this.changed();
    void playing.run.done.then(() => {
      if (this.playing !== playing) return; // cancelled by a snap
      this.playing = null;
      // The field shows this scene's outcome; with nothing left to play, everything received since
      this.draw(this.queue.length === 0 && this.latest ? this.latest : item.after);
      this.changed();
      this.next();
    });
  }

  // Something new is waiting: the scene on screen speeds up to the mode the queue now calls for
  private hurry(): void {
    const p = this.playing;
    if (!p) return;
    const mode = modeFor(this.queue.length);
    if (RANK[mode] <= RANK[p.mode]) return;
    p.mode = mode;
    p.run.hurry(LENGTH[p.item.kind][mode], label(p.item.kind, mode));
    this.changed();
  }

  // The HUD catches up with the latest event within 1.5 s, even while scenes play
  private scheduleHud(): void {
    if (this.hudTimer) return;
    this.hudTimer = setTimeout(() => {
      this.hudTimer = null;
      const s = this.latest;
      if (s) this.scene.hud.show(s, this.kingOf(s), this.nextCost(s));
    }, HUD_LAG_MS);
  }

  // The field shows s; the HUD always shows the latest numbers
  private draw(s: FieldState): void {
    this.scene.showState(s, this.kingOf(s), this.nextCost(s));
    const l = this.latest;
    if (l && l !== s) this.scene.hud.show(l, this.kingOf(l), this.nextCost(l));
    if ((l ?? s).pausedSince === null) this.scene.hud.ribbon(null);
  }

  private changed(): void {
    this.onChange(this.stats());
  }
}

const RANK: Record<Mode, number> = { full: 0, short: 1, quick: 2 };
const modeFor = (waiting: number): Mode => (waiting === 0 ? "full" : waiting === 1 ? "short" : "quick");
const label = (kind: Kind, mode: Mode) => `${kind} · ${mode} · ${(LENGTH[kind][mode] / 1000).toFixed(1)} s`;

function kindOf(e: RefereeEvent): Kind | null {
  if (e.type === "deadline_changed" && e.reason === "open") return "open";
  if (e.type === "deadline_changed" && e.reason === "conquer") return "conquer";
  if (e.type === "round_over") return "over";
  if (e.type === "round_settled") return "settle";
  return null;
}
