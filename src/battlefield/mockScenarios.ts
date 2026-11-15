// Extra mock rounds for the battlefield (dev only): several conquests, a burst that fills the queue, a pause,
// a settle, a lone king, a gap in seq and a move seen on the chain. They run through the page's own mock doors
// (playMockScenario in kingdomMode.ts), so events and snapshots take the same path as real ones.
// The events mirror src/mockRound.ts and docs/EVENTS.md; src/mockRound.ts itself is not changed.
import { CONFIG } from "../config.ts";
import { clockAfterConquestMs, clockAfterOpenMs, wholeSeconds } from "../lib/kingdomClock.ts";
import { conquestMoney, protectAmounts } from "../lib/kingdom.ts";
import { MOCK_ROUND_ID } from "../mockRound.ts";
import type { MockHooks } from "../mockRound.ts";
import type { KingdomSnapshot, RefereeEvent, RoundSnapshot } from "../referee/api.ts";
import { CLOCK_SETTINGS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../refereeParams.ts";

const P = CONFIG.kingdom;
const clockSettings = CLOCK_SETTINGS;
const str = (n: bigint | number) => n.toString();
const fakeTx = (n: number) => n.toString(16).padStart(64, "0");
const KEYS = ["a1", "b2", "c3", "d4", "e5", "f6"].map((k) => k.repeat(20));
// The names and portraits the mock players chose (as the referee stores them: name without the title)
const PROFILES: Record<string, { name: string; avatarId: string; title: string }> = {
  [KEYS[0]!]: { name: "Charles", avatarId: "king_05", title: "King" },
  [KEYS[1]!]: { name: "Amina", avatarId: "king_04", title: "Queen" },
  [KEYS[2]!]: { name: "Kwame", avatarId: "king_06", title: "King" },
  [KEYS[3]!]: { name: "Ada", avatarId: "king_02", title: "Queen" },
  [KEYS[4]!]: { name: "Tunde", avatarId: "king_03", title: "King" },
  [KEYS[5]!]: { name: "Zoë", avatarId: "king_08", title: "Queen" },
};
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
  players: RoundSnapshot["players"] = {}; // the referee's players map: chosen names by key prefix

  constructor(h: MockHooks) {
    this.h = h;
  }

  lastClock: number | null = null; // seconds on the clock right after the last open or conquest
  private remaining = () => (this.deadline === null ? null : this.deadline - (this.paused ? this.paused.since : this.h.now()));

  // The clock fields every event and snapshot carry (the same rule as the referee: src/lib/kingdomClock.ts)
  private clockFields(): { clockSeconds: number | null; nextClockSeconds: number; clockCapSeconds: number; conquestAddSeconds: number; conquestMinSeconds: number } {
    const left = this.remaining();
    return {
      clockSeconds: this.lastClock,
      nextClockSeconds: wholeSeconds(left === null ? clockAfterOpenMs(clockSettings) : clockAfterConquestMs(left, clockSettings)),
      clockCapSeconds: clockSettings.capSeconds, conquestAddSeconds: clockSettings.addSeconds, conquestMinSeconds: clockSettings.minSeconds,
    };
  }

  // A conquest's new clock: the time left plus a minute, at most the cap. Returns the seconds actually added.
  private addToClock(): number {
    const left = Math.max(0, this.remaining() ?? 0);
    const ms = clockAfterConquestMs(left, clockSettings);
    this.deadline = this.h.now() + ms;
    this.lastClock = wholeSeconds(ms);
    return wholeSeconds(ms - left);
  }

  private sceneFields(): Data {
    return {
      king: this.king, previousKing: this.previous, passCount: this.passCount, conquests: Math.max(0, this.passCount - 1),
      value: str(this.value), treasury: str(this.treasury),
      protectsLeft: this.passCount >= 1 ? P.protectsPerReign - this.protectsUsed : 0,
      deadline: this.deadline, ...this.clockFields(),
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
      ...this.clockFields(), floorSeconds: null,
      protectLockoutSeconds: PROTECT_LOCKOUT_SECONDS,
      protectClosesInMs: this.status === "open" && rem !== null ? Math.max(0, rem - PROTECT_LOCKOUT_SECONDS * 1000) : null,
    };
    return {
      gameId: MOCK_ROUND_ID, network: CONFIG.network, status: this.status, deadline: this.deadline, remainingMs: rem,
      paused: this.paused, serverNow: this.h.now(), graceSeconds: GRACE_SECONDS, lastSeq: this.seq, passCount: this.passCount,
      king: this.king, price: money ? str(money.payment) : str(P.openingPrice), pot: str(this.treasury), stateCoin: null,
      refereePubkey: "", chainStale: false, kind: "kingdom", kingdom, players: this.players,
    };
  }

  // A player's open or conquest carries their chosen name (the first time it is stored, as the referee does)
  private chosen(key: string): Data {
    const p = PROFILES[key];
    if (!p) return {};
    const k = key.slice(0, 22);
    if (!this.players![k]) this.players = { ...this.players, [k]: { name: p.name, avatarId: p.avatarId, title: p.title, house: null } };
    const mine = this.players![k]!;
    return { actorName: mine.name, actorAvatar: mine.avatarId };
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
    this.deadline = this.h.now() + clockAfterOpenMs(clockSettings);
    this.lastClock = wholeSeconds(clockAfterOpenMs(clockSettings));
    this.send("deadline_changed", "open", {
      action: "open", txid: fakeTx(this.seq + 1), actor: key, paid: str(P.openingPrice), refunded: "0", toTreasury: str(P.openingPrice),
      ...this.chosen(key),
    });
  }

  protect(times: 1n | 5n | 10n): void {
    const amount = P.unit * times;
    this.value += amount; this.treasury += amount; this.protectsUsed++;
    this.send("protect_applied", "protect", {
      txid: fakeTx(this.seq + 1), actor: this.king, paid: str(amount), refunded: "0", toTreasury: str(amount), amount: str(amount), protectsUsed: this.protectsUsed,
      ...this.chosen(this.king!),
    });
  }

  conquer(key: string): void {
    const m = conquestMoney(this.value, P);
    this.previous = this.king; this.king = key; this.passCount++; this.protectsUsed = 0; this.treasury += m.poolGets;
    // The value stays: a conquest pays the value plus the fee, it does not raise it (src/mockRound.ts)
    const added = this.addToClock();
    this.send("deadline_changed", "conquer", {
      action: "conquer", txid: fakeTx(this.seq + 1), actor: key, paid: str(m.payment), refunded: str(m.kingGets), toTreasury: str(m.poolGets),
      addedSeconds: added, ...this.chosen(key),
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

  // The king cancels before anyone challenged: the whole pool goes back (round_settled, reason cancel)
  cancel(): void {
    const payout = this.treasury;
    this.treasury = 0n; this.status = "settled";
    this.send("round_settled", "cancel", {
      txid: fakeTx(this.seq + 1), winner: this.king, payout: str(payout), pot: str(payout), cancelled: true,
    });
  }

  // The server saw a conquest on the chain it did not make: scene fields only, the clock follows the same rule.
  // The money moved as in any conquest: the cut went into the Treasury.
  observed(key: string): void {
    this.treasury += conquestMoney(this.value, P).poolGets;
    this.previous = this.king; this.king = key; this.passCount++; this.protectsUsed = 0;
    this.addToClock();
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
    id: "protects", label: "Protects and walls",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Protect +5.00: a third wall drops in", 2500, (k) => k.protect(5n)],
      ["Protect +10.00: 25.00, the castle and two more walls", 2500, (k) => k.protect(10n)],
      ["Conquer (B)", 2500, (k) => k.conquer(B)],
      ["B protects +1.00 during the conquest: it does not wait", 1200, (k) => k.protect(1n)],
      ["Protect +10.00: 36.00, eight walls", 7000, (k) => k.protect(10n)],
    ]),
  },
  {
    id: "warnings", label: "Clock warnings and the end",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["One minute left: the bell swings", 2500, (k) => k.jumpTo(61_000)],
      ["30 seconds: dusk, protect closed", 4000, (k) => k.jumpTo(31_000)],
      ["10 seconds: the heartbeat", 4500, (k) => k.jumpTo(11_000)],
      ["Round over: the bell tolls", 4500, (k) => k.over()],
      ["Settled", 4000, (k) => k.settle()],
    ]),
  },
  {
    // The clock rule: each conquest adds 0:30 to the time left, at most the 5:00 cap; under 1:00 left it adds 0:10,
    // at most 1:00. Each jump and its conquest happen in the same step, so the time left is exact.
    id: "clock", label: "Clock rule",
    play: (h) => script(h, [
      ["Open (A): the clock starts at 5:00", 1000, (k) => k.open(A)],
      ["4:40 left, B conquers: +0:20 (the cap), 5:00", 3000, (k) => { k.jumpTo(280_000); k.conquer(B); }],
      ["3:20 left, C conquers: +0:30, 3:50", 7000, (k) => { k.jumpTo(200_000); k.conquer(C); }],
      ["1:30 left, D conquers: +0:30, 2:00", 7000, (k) => { k.jumpTo(90_000); k.conquer(D); }],
      ["0:55 left, E conquers: +0:05 (at most 1:00), 1:00", 7000, (k) => { k.jumpTo(55_000); k.conquer(E); }],
      ["30 seconds: dusk, protect closed", 7000, (k) => k.jumpTo(31_000)],
      ["0:10 left, A conquers: +0:10, 0:20, protect still closed", 4500, (k) => { k.jumpTo(10_000); k.conquer(A); }],
      ["10 seconds: the heartbeat", 4500, (k) => k.jumpTo(11_000)],
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
    id: "cancel", label: "Cancel round",
    play: (h) => script(h, [
      ["Open (A)", 1000, (k) => k.open(A)],
      ["Protect +5.00", 2500, (k) => k.protect(5n)],
      ["A cancels: 15.00 goes back from the chest", 3000, (k) => k.cancel()],
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
