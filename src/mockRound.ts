import { CONFIG } from "./config.ts";
import { clockAfterConquestMs, clockAfterOpenMs, wholeSeconds } from "./lib/kingdomClock.ts";
import { conquestMoney, protectAmounts } from "./lib/kingdom.ts";
import type { KingdomSnapshot, RefereeEvent, RoundSnapshot } from "./referee/api.ts";
import { CLOCK_SETTINGS, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "./refereeParams.ts";

// A scripted round for testing the page (and the animation) without a server or chain transactions:
// open, protect, conquer, the clock warnings, round over. Every step goes through the same two doors a real
// round uses: the event handler and the snapshot handler. Dev page only.

export const MOCK_ROUND_ID = "00".repeat(32);
export const MOCK_KINGS = { alice: "a1".repeat(20), bob: "b2".repeat(20) };
// Their chosen names and portraits, as the referee would store them
const MOCK_PLAYERS = {
  [MOCK_KINGS.alice.slice(0, 22)]: { name: "Charles", avatarId: "king_05", title: "King", house: null },
  [MOCK_KINGS.bob.slice(0, 22)]: { name: "Amina", avatarId: "king_04", title: "Queen", house: null },
};

export type MockHooks = {
  now: () => number; // the page's server clock
  shiftClock: (ms: number) => void; // skip time (a negative number moves it back)
  onEvent: (e: RefereeEvent) => void;
  onSnapshot: (s: RoundSnapshot) => void;
  sleep: (ms: number) => Promise<void>;
  cancelled: () => boolean;
  label: (text: string) => void;
};

const P = CONFIG.kingdom;
const clockSettings = CLOCK_SETTINGS;
const str = (n: bigint | number) => n.toString();
const fakeTx = (n: number) => n.toString(16).padStart(64, "0");

export async function playMockRound(h: MockHooks): Promise<void> {
  let seq = 0;
  let status: RoundSnapshot["status"] = "waiting";
  let deadline: number | null = null;
  let passCount = 0;
  let king: string | null = null;
  let previous: string | null = null; // the dethroned king's full key hash
  let value = 0n;
  let treasury = 0n;
  let protectsUsed = 0;
  let players: NonNullable<RoundSnapshot["players"]> = {};
  const chosen = (key: string): Record<string, string> => {
    const k = key.slice(0, 22);
    if (!players[k] && MOCK_PLAYERS[k]) players = { ...players, [k]: MOCK_PLAYERS[k]! };
    const p = players[k];
    return p ? { actorName: p.name, actorAvatar: p.avatarId } : {};
  };

  let lastClock: number | null = null; // seconds on the clock right after the last open or conquest
  // The clock fields every event and snapshot carry (the same rule as the referee: src/lib/kingdomClock.ts)
  const clockFields = () => {
    const left = remaining();
    return {
      clockSeconds: lastClock,
      nextClockSeconds: wholeSeconds(left === null ? clockAfterOpenMs(clockSettings) : clockAfterConquestMs(left, clockSettings)),
      clockCapSeconds: clockSettings.capSeconds, conquestAddSeconds: clockSettings.addSeconds, conquestMinSeconds: clockSettings.minSeconds,
    };
  };
  const remaining = () => (deadline === null ? null : deadline - h.now());
  const sceneFields = () => ({
    king, previousKing: previous, passCount, conquests: Math.max(0, passCount - 1), value: str(value), treasury: str(treasury),
    protectsLeft: passCount >= 1 ? P.protectsPerReign - protectsUsed : 0,
    deadline, ...clockFields(),
  });

  function snapshot(): RoundSnapshot {
    const open = passCount >= 1;
    const money = open ? conquestMoney(value, P) : null;
    const rem = remaining();
    const kingdom: KingdomSnapshot = {
      holder: king, previousKing: previous ? previous.slice(0, 22) : null, value: str(value), openingPrice: str(P.openingPrice), cap: str(P.cap),
      wallsAtMaximum: open && value >= P.cap, protectsUsed, protectsLeft: open ? P.protectsPerReign - protectsUsed : 0,
      protectsPerReign: P.protectsPerReign, protectAmounts: open ? protectAmounts(P.unit).map(str) : [],
      conquest: money ? { pay: str(money.payment), fee: str(money.fee), kingGets: str(money.kingGets), poolGets: str(money.poolGets) } : null,
      ...clockFields(), floorSeconds: null,
      protectLockoutSeconds: PROTECT_LOCKOUT_SECONDS,
      protectClosesInMs: status === "open" && rem !== null ? Math.max(0, rem - PROTECT_LOCKOUT_SECONDS * 1000) : null,
    };
    return {
      gameId: MOCK_ROUND_ID, network: CONFIG.network, status, deadline, remainingMs: rem, paused: null, serverNow: h.now(),
      graceSeconds: GRACE_SECONDS, lastSeq: seq, passCount, king, price: money ? str(money.payment) : str(P.openingPrice),
      pot: str(treasury), stateCoin: null, refereePubkey: "", chainStale: false, kind: "kingdom", kingdom, players,
    };
  }
  function event(type: string, reason: string, extra: Record<string, string | number | boolean | null>): RefereeEvent {
    return { seq: ++seq, roundId: MOCK_ROUND_ID, at: h.now(), type, reason, data: { ...sceneFields(), ...extra } };
  }
  const deliver = (e: RefereeEvent) => {
    h.onEvent(e);
    h.onSnapshot(snapshot());
  };
  // Skip time so that `ms` are left on the clock
  const jumpTo = (ms: number) => {
    const rem = remaining();
    if (rem === null) return;
    h.shiftClock(rem - ms);
  };
  const step = async (label: string, wait: number): Promise<boolean> => {
    h.label(label);
    await h.sleep(wait);
    return !h.cancelled();
  };

  try {
    h.label("Waiting for the first player");
    h.onSnapshot(snapshot());
    if (!(await step("Alice opens: 5.00 into the treasury", 2000))) return;

    status = "open"; passCount = 1; king = MOCK_KINGS.alice; value = P.openingPrice; treasury = P.openingPrice;
    deadline = h.now() + clockAfterOpenMs(clockSettings);
    lastClock = wholeSeconds(clockAfterOpenMs(clockSettings));
    deliver(event("deadline_changed", "open", {
      action: "open", txid: fakeTx(1), actor: king, paid: str(P.openingPrice), refunded: "0", toTreasury: str(P.openingPrice),
      ...chosen(king),
    }));
    if (!(await step("Alice protects the throne with +5.00", 2500))) return;

    const amount = P.unit * 5n;
    value += amount; treasury += amount; protectsUsed = 1;
    deliver(event("protect_applied", "protect", {
      txid: fakeTx(2), actor: king, paid: str(amount), refunded: "0", toTreasury: str(amount), amount: str(amount), protectsUsed,
      ...chosen(king),
    }));
    if (!(await step("Bob conquers the throne", 2500))) return;

    const money = conquestMoney(value, P);
    previous = king; king = MOCK_KINGS.bob; passCount = 2; protectsUsed = 0; treasury += money.poolGets;
    // The new clock: the same rule as the referee (src/lib/kingdomClock.ts)
    const left = Math.max(0, remaining() ?? 0);
    const ms = clockAfterConquestMs(left, clockSettings);
    deadline = h.now() + ms;
    lastClock = wholeSeconds(ms);
    deliver(event("deadline_changed", "conquer", {
      action: "conquer", txid: fakeTx(3), actor: king, paid: str(money.payment), refunded: str(money.kingGets), toTreasury: str(money.poolGets),
      addedSeconds: wholeSeconds(ms - left), ...chosen(king),
    }));

    // The page's own countdown raises the clock warnings (60, 30 and 10 seconds) as time passes
    for (const [seconds, label] of [[61, "Clock warning at 60 seconds"], [31, "Clock warning at 30 seconds"], [11, "Clock warning at 10 seconds"]] as const) {
      if (!(await step(label, 2200))) return;
      jumpTo(seconds * 1000);
      h.onSnapshot(snapshot());
    }
    if (!(await step("Round over", 2200))) return;
    jumpTo(-(GRACE_SECONDS * 1000 + 100));
    status = "over";
    deliver(event("round_over", "deadline", {}));
    h.label("Mock round finished: Bob is the last king");
  } catch (e) {
    h.label(`Mock round stopped: ${e instanceof Error ? e.message : String(e)}`);
  }
}
