import { CONFIG } from "./config.ts";
import { clockAfterConquestMs, wholeSeconds } from "./lib/kingdomClock.ts";
import { conquestMoney, protectAmounts } from "./lib/kingdom.ts";
import type { KingdomSnapshot, RefereeEvent, RoundSnapshot } from "./referee/api.ts";
import { CLOCK_SETTINGS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "./refereeParams.ts";

// "Play a demo round": a round played on the page alone, with demo PUSD, so one person can feel the game without a
// wallet, a rival or any money. Nothing goes to the referee or the chain. Like the dev mock round (mockRound.ts),
// every step goes through the page's two doors (the event and snapshot handlers), so the field plays it for real.
// The script: King Satoshi (a bot) holds the throne with one minute left. The player's first conquest is answered:
// Satoshi takes the throne back a few seconds later and raises his walls (+1.00 PUSD). A second conquest wins: Satoshi stops, and the last king when
// the clock runs out takes the pool. The money follows the real rules (src/lib/kingdom.ts); so does the clock.

export const DEMO_ROUND_ID = "de".repeat(32);
export const DEMO_ME = "d1".repeat(20); // the player's key in the demo
const BOT = "b0".repeat(20);
const BOT_PLAYER = { name: "Satoshi", avatarId: "king_03", title: "King", house: null };
const OPENER = "c3".repeat(20); // who opened before Satoshi conquered (only the King box's "previous king" uses it)

const START_SECONDS = 60;
const START_BALANCE = 5_000n; // 50.00 demo PUSD
// How soon Satoshi takes the throne back: after the player's conquest has played on the field (the full fight is
// 6.3 s, src/battlefield/scene.ts CONQUEST) and about 3 s more as king
const FIGHT_MS = 6_300;
const BOT_ANSWER_MS: [number, number] = [FIGHT_MS + 3_000, FIGHT_MS + 3_600];
// Right after taking the throne back, Satoshi raises his walls with +1.00 PUSD: the player sees a protect, and the
// next conquest costs more. The field plays it after his fight.
const BOT_PROTECT_AFTER_MS = 1_500;

const P = CONFIG.kingdom;
const str = (n: bigint | number) => n.toString();
const fakeTx = (n: number) => `de${n.toString(16).padStart(62, "0")}`;

export type DemoHooks = {
  now: () => number; // the page's server clock
  onEvent: (e: RefereeEvent) => void;
  onSnapshot: (s: RoundSnapshot) => void;
  changed: () => void; // the demo's own state moved (balance, what can be pressed)
};

export class DemoRound {
  private h: DemoHooks;
  private seq = 0;
  private status: RoundSnapshot["status"] = "open";
  private deadline: number;
  private lastClock = START_SECONDS;
  private passCount = 2; // opened, then conquered by Satoshi
  private king = BOT;
  private previous: string | null = OPENER;
  private value = P.openingPrice;
  private treasury = P.openingPrice + conquestMoney(P.openingPrice, P).poolGets;
  private protectsUsed = 0;
  private players: NonNullable<RoundSnapshot["players"]> = { [BOT.slice(0, 22)]: BOT_PLAYER };
  private myConquests = 0;
  private timers: number[] = [];
  balance = START_BALANCE;

  constructor(h: DemoHooks) {
    this.h = h;
    this.deadline = h.now() + START_SECONDS * 1000;
  }

  start(): void {
    this.h.onSnapshot(this.snapshot());
    // The end of the round: the page's own countdown shows the clock; this notices zero (plus the grace second)
    this.timers.push(window.setInterval(() => {
      if (this.status === "open" && this.h.now() > this.deadline + GRACE_SECONDS * 1000) this.finish();
    }, 200));
  }

  stop(): void {
    for (const t of this.timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    this.timers = [];
  }

  // ---- what the player can do ----

  get over(): boolean {
    return this.status === "over";
  }
  hasProfile(): boolean {
    return !!this.players[DEMO_ME.slice(0, 22)];
  }
  private left(): number {
    return this.deadline - this.h.now();
  }
  conquestPrice(): bigint {
    return conquestMoney(this.value, P).payment;
  }
  canConquer(): boolean {
    return this.status === "open" && this.left() > 0 && this.king !== DEMO_ME && this.balance >= this.conquestPrice();
  }
  protectState(): { amount: string; enabled: boolean }[] {
    const open = this.status === "open" && this.king === DEMO_ME && this.left() - PROTECT_LOCKOUT_SECONDS * 1000 > 0;
    return protectAmounts(P.unit).map((a) => ({
      amount: str(a),
      enabled: open && this.protectsUsed < P.protectsPerReign && this.value + a <= P.cap && this.balance >= a,
    }));
  }

  conquer(profile?: { name: string; avatarId: string }): void {
    if (!this.canConquer()) return;
    if (profile && !this.hasProfile()) {
      this.players = { ...this.players, [DEMO_ME.slice(0, 22)]: { name: profile.name, avatarId: profile.avatarId, title: null, house: null } };
    }
    const money = conquestMoney(this.value, P);
    this.balance -= money.payment;
    this.takeThrone(DEMO_ME, money);
    this.myConquests++;
    // The first conquest is answered; the second one wins
    if (this.myConquests === 1) {
      const [lo, hi] = BOT_ANSWER_MS;
      this.timers.push(window.setTimeout(() => this.botAnswers(), lo + Math.random() * (hi - lo)));
    }
    this.h.changed();
  }

  protect(i: number): void {
    const p = this.protectState()[i];
    if (!p?.enabled) return;
    const amount = BigInt(p.amount);
    this.balance -= amount;
    this.value += amount;
    this.treasury += amount;
    this.protectsUsed++;
    this.deliver(this.event("protect_applied", "protect", {
      txid: fakeTx(this.seq + 1), actor: DEMO_ME, paid: str(amount), refunded: "0", toTreasury: str(amount), amount: str(amount),
      protectsUsed: this.protectsUsed, ...this.chosen(DEMO_ME),
    }));
    this.h.changed();
  }

  // ---- the script ----

  private botAnswers(): void {
    if (this.status !== "open" || this.king !== DEMO_ME || this.left() < 1_000) return;
    const money = conquestMoney(this.value, P);
    this.balance += money.kingGets; // the dethroned king's share, as in a real round
    this.takeThrone(BOT, money);
    this.h.changed();
    this.timers.push(window.setTimeout(() => this.botProtects(), BOT_PROTECT_AFTER_MS));
  }

  private botProtects(): void {
    const amount = P.unit; // 1.00 PUSD
    const open = this.status === "open" && this.king === BOT && this.left() - PROTECT_LOCKOUT_SECONDS * 1000 > 1_000;
    if (!open || this.protectsUsed >= P.protectsPerReign || this.value + amount > P.cap) return;
    this.value += amount;
    this.treasury += amount;
    this.protectsUsed++;
    this.deliver(this.event("protect_applied", "protect", {
      txid: fakeTx(this.seq + 1), actor: BOT, paid: str(amount), refunded: "0", toTreasury: str(amount), amount: str(amount),
      protectsUsed: this.protectsUsed, ...this.chosen(BOT),
    }));
    this.h.changed();
  }

  private takeThrone(who: string, money: ReturnType<typeof conquestMoney>): void {
    const left = Math.max(0, this.left());
    const ms = clockAfterConquestMs(left, CLOCK_SETTINGS);
    this.previous = this.king;
    this.king = who;
    this.passCount++;
    this.protectsUsed = 0;
    this.treasury += money.poolGets;
    this.deadline = this.h.now() + ms;
    this.lastClock = wholeSeconds(ms);
    this.deliver(this.event("deadline_changed", "conquer", {
      action: "conquer", txid: fakeTx(this.seq + 1), actor: who, paid: str(money.payment), refunded: str(money.kingGets),
      toTreasury: str(money.poolGets), addedSeconds: wholeSeconds(ms - left), ...this.chosen(who),
    }));
  }

  private finish(): void {
    this.status = "over";
    if (this.king === DEMO_ME) this.balance += this.treasury; // the pool, as if claimed
    this.deliver(this.event("round_over", "deadline", {}));
    this.h.changed();
  }

  // ---- what the page sees: the same shapes the referee sends ----

  private chosen(key: string): Record<string, string> {
    const p = this.players[key.slice(0, 22)];
    return p ? { actorName: p.name, actorAvatar: p.avatarId } : {};
  }
  private clockFields() {
    const left = this.status === "open" ? Math.max(0, this.left()) : 0;
    return {
      clockSeconds: this.lastClock,
      nextClockSeconds: wholeSeconds(clockAfterConquestMs(left, CLOCK_SETTINGS)),
      clockCapSeconds: CLOCK_SETTINGS.capSeconds, conquestAddSeconds: CLOCK_SETTINGS.addSeconds, conquestMinSeconds: CLOCK_SETTINGS.minSeconds,
    };
  }
  private snapshot(): RoundSnapshot {
    const money = conquestMoney(this.value, P);
    const rem = this.left();
    const kingdom: KingdomSnapshot = {
      holder: this.king, previousKing: this.previous ? this.previous.slice(0, 22) : null, value: str(this.value),
      openingPrice: str(P.openingPrice), cap: str(P.cap), wallsAtMaximum: this.value >= P.cap, protectsUsed: this.protectsUsed,
      protectsLeft: P.protectsPerReign - this.protectsUsed, protectsPerReign: P.protectsPerReign,
      protectAmounts: protectAmounts(P.unit).map(str),
      conquest: { pay: str(money.payment), fee: str(money.fee), kingGets: str(money.kingGets), poolGets: str(money.poolGets) },
      ...this.clockFields(), floorSeconds: null, protectLockoutSeconds: PROTECT_LOCKOUT_SECONDS,
      protectClosesInMs: this.status === "open" ? Math.max(0, rem - PROTECT_LOCKOUT_SECONDS * 1000) : null,
    };
    return {
      gameId: DEMO_ROUND_ID, network: CONFIG.network, status: this.status, deadline: this.deadline, remainingMs: rem, paused: null,
      serverNow: this.h.now(), graceSeconds: GRACE_SECONDS, lastSeq: this.seq, passCount: this.passCount, king: this.king,
      price: str(money.payment), pot: str(this.treasury), stateCoin: null, refereePubkey: "", chainStale: false, kind: "kingdom",
      kingdom, players: this.players,
    };
  }
  private event(type: string, reason: string, extra: Record<string, string | number | boolean | null>): RefereeEvent {
    return {
      seq: ++this.seq, roundId: DEMO_ROUND_ID, at: this.h.now(), type, reason,
      data: {
        king: this.king, previousKing: this.previous, passCount: this.passCount, conquests: Math.max(0, this.passCount - 1),
        value: str(this.value), treasury: str(this.treasury), protectsLeft: P.protectsPerReign - this.protectsUsed,
        deadline: this.deadline, ...this.clockFields(), ...extra,
      },
    };
  }
  private deliver(e: RefereeEvent): void {
    this.h.onEvent(e);
    this.h.onSnapshot(this.snapshot());
  }
}
