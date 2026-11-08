// The director turns what the page announces into what the field shows.
// Queue rule (docs/ANIMATION_BRIEF.md): play the full scene only when nothing is waiting; one waiting: short;
// two or more: quick. More than 3 waiting: drop them all and snap to the latest state. The HUD never lags the
// latest event by more than 1.5 s. A gap in seq, a resync or a new round: cancel everything and snap.
import { COPY, pauseText } from "../copy.ts";
import type { RefereeEvent, RoundSnapshot, RoundStatus } from "../referee/api.ts";
import { serverNow } from "../referee/clock.ts";
import { CLOCK_CAP_SECONDS } from "../refereeParams.ts";
import { clockText, money } from "./hud.ts";
import type { Urgency } from "./hud.ts";
import { displayName } from "./identity.ts";
import type { Identity } from "./identity.ts";
import { conquestLength, openLength, OVER, SETTLE } from "./scene.ts";
import type { BattlefieldScene, Mode, SceneRun } from "./scene.ts";

const T = COPY.battlefield;

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
  capMs: number; // the most the clock can show (clockCapSeconds): the ring's full circle
  pausedSince: number | null; // server time the clock froze, or null
  payout: bigint | null; // what the winner received, once settled (null when unknown)
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
    capMs: (k?.clockCapSeconds ?? CLOCK_CAP_SECONDS) * 1000,
    pausedSince: s.paused ? s.paused.since : null,
    payout: null,
  };
}

// Events carry the kingdom as it stands after the change (docs/EVENTS.md)
export function stateFromEvent(e: RefereeEvent, before: FieldState): FieldState {
  const d = e.data ?? {};
  const status: RoundStatus =
    e.type === "round_settled" ? "settled" : e.type === "round_over" ? "over" : d.king ? "open" : before.status;
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
    capMs: (num(d.clockCapSeconds, null) ?? before.capMs / 1000) * 1000,
    pausedSince: e.type === "clock_paused" ? e.at : e.type === "clock_resumed" ? null : before.pausedSince,
    payout: e.type === "round_settled" ? (d.payout === null || d.payout === undefined ? null : big(d.payout)) : before.payout,
  };
}

const EMPTY: FieldState = {
  roundId: "", status: "waiting", king: null, value: 0n, treasury: 0n, protectsLeft: 0, conquests: 0, openingPrice: 0n,
  deadline: null, capMs: CLOCK_CAP_SECONDS * 1000, pausedSince: null, payout: null,
};

type Kind = "open" | "conquer" | "over" | "settle";
const LENGTH: Record<Kind, Record<Mode, number>> = {
  open: { full: openLength("full"), short: openLength("short"), quick: openLength("quick") },
  conquer: { full: conquestLength("full"), short: conquestLength("short"), quick: conquestLength("quick") },
  over: OVER,
  settle: SETTLE,
};
const MAX_WAITING = 3;
const HUD_LAG_MS = 1500;

type Item = { kind: Kind; event: RefereeEvent; before: FieldState; after: FieldState };

export type DirectorStats = { playing: string | null; waiting: number; dropped: number; snaps: number; lastSeq: number };

export type DirectorDeps = {
  scene: BattlefieldScene;
  kingOf: (s: FieldState) => Identity | null;
  identityOf: (key: string) => Identity | null;
  nextCost: (s: FieldState) => bigint | null;
  isMe: (key: string | null) => boolean; // one of the player's own keys (game wallet or own wallet)
};

export class Director {
  private d: DirectorDeps;
  private scene: BattlefieldScene;
  private latest: FieldState | null = null; // after every event received so far
  private queue: Item[] = [];
  private playing: { item: Item; mode: Mode; run: SceneRun } | null = null;
  private lastSeq = 0;
  private hudTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseReason = "network_busy";
  private dropped = 0;
  private snaps = 0;
  onChange: (s: DirectorStats) => void = () => {};

  constructor(deps: DirectorDeps) {
    this.d = deps;
    this.scene = deps.scene;
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
    if (s.paused) this.pauseReason = s.paused.reason;
    const newRound = this.latest?.roundId !== state.roundId;
    const restarted = s.lastSeq === 0 && this.lastSeq > 0; // the round's history starts over (a fresh mock run)
    if (newRound || restarted || s.lastSeq > this.lastSeq) {
      // First frame, a new round, or events we never saw (a resync): start from the snapshot
      const keep = !newRound && !restarted && this.latest ? this.latest.payout : null;
      this.lastSeq = s.lastSeq;
      this.snap({ ...state, payout: keep });
      this.skyFromSnapshot(s);
      return;
    }
    if (s.lastSeq < this.lastSeq) return; // older than what we have
    // Same events as ours: take the clock from it (pauses, a pushed deadline), redraw only when idle
    const l = this.latest!;
    this.latest = { ...l, deadline: state.deadline, pausedSince: state.pausedSince, capMs: state.capMs };
    if (this.idle()) this.draw(this.latest);
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
    const idle = this.idle();
    this.instant(e, before, after, idle);

    const kind = kindOf(e);
    if (kind) {
      this.queue.push({ kind, event: e, before, after });
      if (this.queue.length > MAX_WAITING) {
        this.dropped += this.queue.length;
        this.snap(after);
        return;
      }
      this.next();
      this.hurry();
    } else if (idle && (e.type === "clock_paused" || e.type === "clock_resumed")) {
      this.draw(after); // nothing to wait for; protect draws itself, warnings change nothing on the field
    }
    this.scheduleHud();
    this.changed();
  }

  // Every frame: the bell's ring and time, and how urgent the last minute is
  tick(): void {
    const s = this.latest, hud = this.scene.hud;
    if (!s || s.status !== "open" || s.deadline === null) {
      hud.setClock(null, 0);
      hud.setUrgency(0, false);
      return;
    }
    const paused = s.pausedSince !== null;
    const rem = Math.max(0, paused ? s.deadline - s.pausedSince! : s.deadline - serverNow());
    hud.setClock(rem, s.capMs);
    hud.setUrgency(rem <= 10_000 ? 10 : rem <= 30_000 ? 30 : rem <= 60_000 ? 60 : (0 as Urgency), paused);
    this.scene.freezeSky(paused);
  }

  private idle(): boolean {
    return !this.playing && this.queue.length === 0;
  }

  private name(key: string | null): string {
    const who = key ? this.d.identityOf(key) : null;
    return who ? displayName(who.portrait) : "";
  }

  // What happens at once, whatever is playing: the sky, protect, pauses, and the popups
  private instant(e: RefereeEvent, before: FieldState, after: FieldState, idle: boolean): void {
    const sc = this.scene, hud = sc.hud, d = e.data ?? {}, me = this.d.isMe;
    if (e.type === "deadline_changed") sc.setDusk(false);
    if (e.type === "deadline_changed" && e.reason === "open") {
      hud.popup(me(after.king) ? T.popOpenedYou : T.popOpened(this.name(after.king)), me(after.king));
    }
    if (e.type === "deadline_changed" && e.reason === "conquer") {
      const who = this.name(after.king), old = this.name(before.king);
      // The time this conquest added to the clock (smaller when the cap cut it): in the popup and floating by the bell
      const added = typeof d.addedSeconds === "number" ? T.clockAdded(clockText(d.addedSeconds * 1000)) : null;
      const pop = (text: string, mine = false) => hud.popup(added ? T.popWithAdded(text, added) : text, mine);
      if (me(before.king)) pop(T.popConqueredYours(who), true);
      else if (me(after.king)) pop(T.popYouConquered(old), true);
      else pop(T.popConquered(who, old));
      if (added) hud.floatAdded(added);
    }
    if (e.type === "deadline_changed" && e.reason === "observed_on_chain") {
      // Someone moved on the chain directly: no scene, snap to the event's state
      hud.popup(T.popObserved(this.name(after.king)), me(before.king) || me(after.king));
      this.lastSeq = Math.max(this.lastSeq, e.seq);
      this.snap(after);
    }
    if (e.type === "protect_applied") {
      const king = this.d.kingOf(after), amount = big(d.amount);
      if (king) sc.playProtect({ before, after, king, amount, idle, nextCost: this.d.nextCost(after) });
      hud.popup(me(after.king) ? T.popProtectedYou(money(amount)) : T.popProtected(this.name(after.king), money(amount)), me(after.king));
    }
    if (e.type === "clock_warning") {
      if (e.reason === "60s") hud.popup(T.popMinute);
      if (e.reason === "30s") {
        sc.setDusk(true);
        hud.edgePulse();
        hud.popup(T.popProtectClosed, me(after.king));
      }
      if (e.reason === "10s") hud.popup(T.popTenSeconds);
    }
    if (e.type === "clock_paused") {
      this.pauseReason = e.reason;
      hud.ribbon(pauseText(e.reason), "alert");
    }
    if (e.type === "clock_resumed") {
      hud.ribbon(null);
      hud.popup(T.popResumed);
    }
    if (e.type === "round_over") hud.popup(T.popOver);
    if (e.type === "round_settled") {
      const amount = after.payout !== null ? money(after.payout) : "—";
      hud.popup(after.conquests === 0 ? T.noChallengers : T.popWins(this.name(after.king), amount), me(after.king));
    }
  }

  private next(): void {
    if (this.playing || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    const mode = modeFor(this.queue.length);
    const playing = { item, mode, run: this.play(item, mode) };
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

  private play(item: Item, mode: Mode): SceneRun {
    const sc = this.scene, d = item.event.data ?? {};
    const king = this.d.kingOf(item.after);
    const mine = this.d.isMe(item.after.king);
    if (item.kind === "conquer" && king) {
      return sc.playConquest({
        mode, side: item.event.seq % 2 === 0 ? "left" : "right", before: item.before, after: item.after,
        oldKing: this.d.kingOf(item.before), newKing: king, paid: big(d.paid), refunded: big(d.refunded), toTreasury: big(d.toTreasury),
        nextCost: this.d.nextCost(item.after),
      });
    }
    if (item.kind === "open" && king) {
      return sc.playOpen({ mode, after: item.after, king, toTreasury: big(d.toTreasury, item.after.treasury), nextCost: this.d.nextCost(item.after) });
    }
    this.ribbonFor(item.after);
    if (item.kind === "over") return sc.playOver({ mode, state: item.after, king, mine });
    if (item.kind === "settle") return sc.playSettle({ mode, state: item.after, king, mine });
    return sc.playScene(`${item.kind} · ${mode}`, LENGTH[item.kind][mode]);
  }

  // Something new is waiting: the scene on screen speeds up to the mode the queue now calls for
  private hurry(): void {
    const p = this.playing;
    if (!p) return;
    const mode = modeFor(this.queue.length);
    if (RANK[mode] <= RANK[p.mode]) return;
    p.mode = mode;
    p.run.hurry(LENGTH[p.item.kind][mode], `${p.item.kind} · ${mode}`);
    this.changed();
  }

  // The HUD catches up with the latest event within 1.5 s, even while scenes play
  private scheduleHud(): void {
    if (this.hudTimer) return;
    this.hudTimer = setTimeout(() => {
      this.hudTimer = null;
      const s = this.latest;
      if (s) this.scene.hud.show(s, this.d.kingOf(s), this.d.nextCost(s));
    }, HUD_LAG_MS);
  }

  // The field shows s; the HUD always shows the latest numbers
  private draw(s: FieldState): void {
    this.scene.showState(s, this.d.kingOf(s), this.d.nextCost(s));
    const l = this.latest ?? s;
    if (l !== s) this.scene.hud.show(l, this.d.kingOf(l), this.d.nextCost(l));
    this.ribbonFor(l);
  }

  // The ribbon across the field: a pause, or who claims at the end of the round; the plate glows meanwhile
  private ribbonFor(s: FieldState): void {
    const hud = this.scene.hud, mine = this.d.isMe(s.king);
    hud.glowPlate(s.status === "over");
    if (s.pausedSince !== null && s.status === "open") hud.ribbon(pauseText(this.pauseReason), "alert");
    else if (s.status === "over") hud.ribbon(mine ? T.claimReward : T.waitingClaim, mine ? "alert" : "info");
    else hud.ribbon(null);
  }

  private changed(): void {
    this.onChange(this.stats());
  }
}

const RANK: Record<Mode, number> = { full: 0, short: 1, quick: 2 };
const modeFor = (waiting: number): Mode => (waiting === 0 ? "full" : waiting === 1 ? "short" : "quick");

function kindOf(e: RefereeEvent): Kind | null {
  if (e.type === "deadline_changed" && e.reason === "open") return "open";
  if (e.type === "deadline_changed" && e.reason === "conquer") return "conquer";
  if (e.type === "round_over") return "over";
  if (e.type === "round_settled") return "settle";
  return null;
}
