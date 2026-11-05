// Extra mock rounds for the battlefield (dev only): several conquests, a burst that fills the queue, a pause,
// a settle, a lone king, a gap in seq and a move seen on the chain. They run through the page's own mock doors
// (playMockScenario in kingdomMode.ts), so events and snapshots take the same path as real ones.
// The events mirror src/mockRound.ts and docs/EVENTS.md; src/mockRound.ts itself is not changed.
import { CONFIG } from "../config.ts";
import { clockSecondsFor, nextClockSecondsFor } from "../lib/bell.ts";
import { conquestMoney, protectAmounts } from "../lib/kingdom.ts";
import { MOCK_ROUND_ID } from "../mockRound.ts";
import type { MockHooks } from "../mockRound.ts";
import type { KingdomSnapshot, RefereeEvent, RoundSnapshot } from "../referee/api.ts";
import { BELL_PRESETS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../refereeParams.ts";

const P = CONFIG.kingdom;
const bell = BELL_PRESETS.standard;
const str = (n: bigint | number) => n.toString();
const fakeTx = (n: number) => n.toString(16).padStart(64, "0");
const KEYS = ["a1", "b2", "c3", "d4", "e5", "f6"].map((k) => k.repeat(20));
type Data = Record<string, string | number | boolean | null>;

class MockKingdom {
  private h: MockHooks;
  seq = 0;
  status: RoundSnapshot["status"] = "waiting";
  deadline: number | null = null;
  passCount = 0;
  king: string | null = null;
  previous: string | null = null;
  value = 0n;
  treasury = 0n;
  protectsUsed = 0;
  paused: { since: number; reason: string } | null = null;

  constructor(h: MockHooks) {
    this.h = h;
  }

  private clockFor = (n: number) => (n >= 1 ? clockSecondsFor(n, bell) : null);
  private remaining = () => (this.deadline === null ? null : this.deadline - (this.paused ? this.paused.since : this.h.now()));

  private sceneFields(): Data {
    return {
      king: this.king, previousKing: this.previous, passCount: this.passCount, conquests: Math.max(0, this.passCount - 1),
      value: str(this.value), treasury: str(this.treasury),
      protectsLeft: this.passCount >= 1 ? P.protectsPerReign - this.protectsUsed : 0,
      deadline: this.deadline, clockSeconds: this.clockFor(this.passCount), nextClockSeconds: nextClockSecondsFor(this.passCount, bell),
    };
  }

  snapshot(): RoundSnapshot {
    const open = this.passCount >= 1;
    const money = open ? conquestMoney(this.value, P) : null;
    const rem = this.remaining();
    const kingdom: KingdomSnapshot = {
      holder: this.king, previousKing: this.previous ? this.previous.slice(0, 22) : null, value: str(this.value),
      openingPrice: str(P.openingPrice), cap: str(P.cap), wallsAtMaximum: open && this.value >= P.cap,
      protectsUsed: this.protectsUsed, protectsLeft: open ? P.protectsPerReign - this.protectsUsed : 0,
      protectsPerReign: P.protectsPerReign, protectAmounts: open ? protectAmounts(P.unit).map(str) : [],
      conquest: money ? { pay: str(money.payment), fee: str(money.fee), kingGets: str(money.kingGets), poolGets: str(money.poolGets) } : null,
      clockSeconds: this.clockFor(this.passCount), nextClockSeconds: nextClockSecondsFor(this.passCount, bell), floorSeconds: bell.floorSeconds,
      protectLockoutSeconds: PROTECT_LOCKOUT_SECONDS,
      protectClosesInMs: this.status === "open" && rem !== null ? Math.max(0, rem - PROTECT_LOCKOUT_SECONDS * 1000) : null,
    };
    return {
      gameId: MOCK_ROUND_ID, network: CONFIG.network, status: this.status, deadline: this.deadline, remainingMs: rem,
      paused: this.paused, serverNow: this.h.now(), graceSeconds: GRACE_SECONDS, lastSeq: this.seq, passCount: this.passCount,
      king: this.king, price: money ? str(money.payment) : str(P.openingPrice), pot: str(this.treasury), stateCoin: null,
      refereePubkey: "", chainStale: false, kind: "kingdom", kingdom,
    };
  }

  private send(type: string, reason: string, extra: Data = {}): void {
    const e: RefereeEvent = { seq: ++this.seq, roundId: MOCK_ROUND_ID, at: this.h.now(), type, reason, data: { ...this.sceneFields(), ...extra } };
    this.h.onEvent(e);
    this.h.onSnapshot(this.snapshot());
  }

  start(): void {
    this.h.onSnapshot(this.snapshot());
  }

  open(key: string): void {
    this.status = "open"; this.passCount = 1; this.king = key; this.value = P.openingPrice; this.treasury = P.openingPrice;
    this.deadline = this.h.now() + clockSecondsFor(1, bell) * 1000;
    this.send("deadline_changed", "open", {
      action: "open", txid: fakeTx(this.seq + 1), actor: key, paid: str(P.openingPrice), refunded: "0", toTreasury: str(P.openingPrice),
    });
  }

  protect(times: 1n | 5n | 10n): void {
    const amount = P.unit * times;
    this.value += amount; this.treasury += amount; this.protectsUsed++;
    this.send("protect_applied", "protect", {
      txid: fakeTx(this.seq + 1), actor: this.king, paid: str(amount), refunded: "0", toTreasury: str(amount), amount: str(amount), protectsUsed: this.protectsUsed,
    });
  }

  conquer(key: string): void {
    const m = conquestMoney(this.value, P);
    this.previous = this.king; this.king = key; this.passCount++; this.protectsUsed = 0; this.treasury += m.poolGets;
    // The value stays: a conquest pays the value plus the fee, it does not raise it (src/mockRound.ts)
    this.deadline = this.h.now() + clockSecondsFor(this.passCount, bell) * 1000;
    this.send("deadline_changed", "conquer", {
      action: "conquer", txid: fakeTx(this.seq + 1), actor: key, paid: str(m.payment), refunded: str(m.kingGets), toTreasury: str(m.poolGets),
    });
  }

  pause(): void {
    this.paused = { since: this.h.now(), reason: "network_busy" };
    this.send("clock_paused", "network_busy");
  }

  resume(): void {
    if (!this.paused) return;
    const pausedMs = this.h.now() - this.paused.since;
    this.paused = null;
    if (this.deadline !== null) this.deadline += pausedMs;
    this.send("clock_resumed", "network_ok", { pausedMs });
  }

  // Skip time so that `ms` are left on the clock
  jumpTo(ms: number): void {
    const rem = this.remaining();
    if (rem !== null) this.h.shiftClock(rem - ms);
  }

  over(): void {
    this.jumpTo(-(GRACE_SECONDS * 1000 + 100));
    this.status = "over";
    this.send("round_over", "deadline");
  }

  settle(): void {
    const payout = this.treasury;
    this.treasury = 0n; this.status = "settled";
    this.send("round_settled", "keeper", {
      txid: fakeTx(this.seq + 1), winner: this.king, payout: str(payout), pot: str(payout), cancelled: false,
    });
  }

  // The server saw a move on the chain it did not make: scene fields only, the clock restarts
  observed(key: string): void {
    this.previous = this.king; this.king = key; this.passCount++; this.protectsUsed = 0;
    this.deadline = this.h.now() + clockSecondsFor(this.passCount, bell) * 1000;
    this.send("deadline_changed", "observed_on_chain");
  }

  // Lose events on the way: the next one arrives with a gap in seq
  skip(n: number): void {
    this.seq += n;
  }
}

export type Scenario = { id: string; label: string; play: (h: MockHooks) => Promise<void> };

// Runs the steps with a pause before each; stops when the run is cancelled
async function script(h: MockHooks, steps: [string, number, (k: MockKingdom) => void][]): Promise<void> {
  const k = new MockKingdom(h);
  k.start();
  try {
    for (const [label, wait, act] of steps) {
      h.label(label);
      await h.sleep(wait);
      if (h.cancelled()) return;
      act(k);
    }
    h.label("Scenario finished");
  } catch (e) {
    h.label(`Scenario stopped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const [A, B, C, D, E, F] = KEYS;

export const SCENARIOS: Scenario[] = [
  {
    id: "conquests", label: "Several conquests",
    play: (h) => script(h, [
      ["Open (A)", 1200, (k) => k.open(A)],
      ["Conquer (B)", 3000, (k) => k.conquer(B)],
      ["Protect +10.00 (B)", 7000, (k) => k.protect(10n)],
      ["Conquer (C)", 1500, (k) => k.conquer(C)],
      ["Conquer (D)", 7000, (k) => k.conquer(D)],
      ["Conquer (E): fifth king, houses wrap", 7000, (k) => k.conquer(E)],
    ]),
  },
  {
    id: "burst", label: "Burst (queue: short, quick, drop)",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Two quick conquests: the first plays short", 2500, (k) => k.conquer(B)],
      ["", 300, (k) => k.conquer(C)],
      ["Three more at once: quick", 7000, (k) => k.conquer(D)],
      ["", 200, (k) => k.conquer(E)],
      ["", 200, (k) => k.conquer(F)],
      ["Five at once: more than 3 waiting, snap", 7000, (k) => k.conquer(A)],
      ["", 100, (k) => k.conquer(B)],
      ["", 100, (k) => k.conquer(C)],
      ["", 100, (k) => k.conquer(D)],
      ["", 100, (k) => k.conquer(E)],
    ]),
  },
  {
    id: "pause", label: "Network busy pause",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Clock paused: network busy", 3000, (k) => k.pause()],
      ["Clock resumes", 4000, (k) => k.resume()],
    ]),
  },
  {
    id: "settle", label: "Round over and settle",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Conquer (B)", 2500, (k) => k.conquer(B)],
      ["30 seconds left", 7500, (k) => k.jumpTo(31_000)],
      ["Round over", 3000, (k) => k.over()],
      ["Settled by the keeper", 3000, (k) => k.settle()],
    ]),
  },
  {
    id: "alone", label: "No challengers",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Round over", 3000, (k) => k.over()],
      ["Settled: pool returned", 2500, (k) => k.settle()],
    ]),
  },
  {
    id: "gap", label: "Gap in seq",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Two events lost, then a conquest: snap", 3000, (k) => { k.skip(2); k.conquer(B); }],
    ]),
  },
  {
    id: "observed", label: "Move seen on the chain",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["The server saw C take the throne on the chain: snap", 3000, (k) => k.observed(C)],
    ]),
  },
];
