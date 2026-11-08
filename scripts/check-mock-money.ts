// Checks every mock round against the money rules, without a browser: the battlefield scenarios
// (src/battlefield/mockScenarios.ts) and the page's own mock round (src/mockRound.ts).
// For each event: paid = refunded + toTreasury, the conquest money from conquestMoney (fee and cut), the protect
// amounts and limits, the value and Treasury after each step, the snapshot pot, the payout and the winner.
// And the clock rule: the open sets the cap, each conquest min(cap, max(min, left + add)), a protect nothing.
// Run: npm run check:mock-money
import { CONFIG } from "../src/config.ts";
import { conquestMoney } from "../src/lib/kingdom.ts";
import { clockAfterConquestMs, clockAfterOpenMs, wholeSeconds } from "../src/lib/kingdomClock.ts";
import { CLOCK_PRESETS } from "../src/refereeParams.ts";
import { SCENARIOS as EXTRA } from "../src/battlefield/mockScenarios.ts";
import { playMockRound } from "../src/mockRound.ts";
import type { RefereeEvent, RoundSnapshot } from "../src/referee/api.ts";

const SCENARIOS = [...EXTRA, { id: "mockRound.ts", label: "", play: playMockRound }];
const CLOCK = CLOCK_PRESETS.standard;
// The "Clock rule" scenario: conquests at 9:30, 8:00, 2:00 and 0:10 left
const CLOCK_RULE = { added: [30, 60, 60, 60], clock: [600, 540, 180, 70] };

const P = CONFIG.kingdom;
let failures = 0;
const fail = (sc: string, msg: string) => {
  failures++;
  console.log(`  FAIL [${sc}] ${msg}`);
};
const B = (v: unknown) => BigInt(String(v ?? 0));

for (const sc of SCENARIOS) {
  let clock = 1_780_000_000_000;
  let value = 0n, treasury = 0n, king: string | null = null, lastSeq = 0, protects = 0;
  const events: RefereeEvent[] = [];
  let deadline: number | null = null, paused: number | null = null;
  const added: number[] = [], clocks: number[] = [];
  await sc.play({
    now: () => clock,
    shiftClock: (ms) => (clock += ms),
    onEvent: (e) => {
      events.push(e);
      const d = e.data ?? {};
      const tag = `seq ${e.seq} ${e.type}/${e.reason}`;
      // The clock rule (pauses never overlap a move in the scenarios)
      if (e.type === "deadline_changed" && e.reason !== "observed_on_chain" && sc.id !== "gap") {
        const left = deadline === null ? 0 : Math.max(0, deadline - e.at);
        const ms = e.reason === "open" ? clockAfterOpenMs(CLOCK) : clockAfterConquestMs(left, CLOCK);
        if (d.deadline !== e.at + ms) fail(sc.id, `${tag}: deadline ${d.deadline}, the clock rule gives ${e.at + ms}`);
        if (d.clockSeconds !== wholeSeconds(ms)) fail(sc.id, `${tag}: clockSeconds ${d.clockSeconds}, should be ${wholeSeconds(ms)}`);
        if (e.reason === "conquer") {
          if (d.addedSeconds !== wholeSeconds(ms - left)) fail(sc.id, `${tag}: addedSeconds ${d.addedSeconds}, should be ${wholeSeconds(ms - left)}`);
          added.push(Number(d.addedSeconds));
          clocks.push(Number(d.clockSeconds));
        }
      }
      if (e.type === "protect_applied" && d.deadline !== deadline) fail(sc.id, `${tag}: a protect moved the deadline`);
      if (e.type !== "clock_warning" && d.clockCapSeconds !== CLOCK.capSeconds) fail(sc.id, `${tag}: clockCapSeconds ${d.clockCapSeconds}`);
      if (e.type === "clock_paused") paused = e.at;
      if (e.type === "clock_resumed" && paused !== null && deadline !== null && d.deadline !== deadline + (e.at - paused)) fail(sc.id, `${tag}: the pause was not added to the deadline`);
      if (typeof d.deadline === "number") deadline = d.deadline;
      if (e.type === "deadline_changed" && e.reason === "open") {
        if (B(d.paid) !== P.openingPrice) fail(sc.id, `${tag}: paid ${d.paid}, opening price is ${P.openingPrice}`);
        value = P.openingPrice; treasury = P.openingPrice; protects = 0;
      } else if (e.type === "deadline_changed" && e.reason === "conquer") {
        const m = conquestMoney(value, P);
        if (d.actor === king) fail(sc.id, `${tag}: the king conquers their own throne`);
        if (B(d.paid) !== m.payment) fail(sc.id, `${tag}: paid ${d.paid}, should be ${m.payment}`);
        if (B(d.refunded) !== m.kingGets) fail(sc.id, `${tag}: refunded ${d.refunded}, should be ${m.kingGets}`);
        if (B(d.toTreasury) !== m.poolGets) fail(sc.id, `${tag}: toTreasury ${d.toTreasury}, should be ${m.poolGets}`);
        if (d.previousKing !== king) fail(sc.id, `${tag}: previousKing is not the old king`);
        treasury += m.poolGets; protects = 0;
      } else if (e.type === "deadline_changed" && e.reason === "observed_on_chain") {
        treasury += conquestMoney(value, P).poolGets; protects = 0; // a conquest the server did not process
      } else if (e.type === "protect_applied") {
        const a = B(d.amount);
        if (![1n, 5n, 10n].map((x) => x * P.unit).includes(a)) fail(sc.id, `${tag}: amount ${a} is not 1, 5 or 10 units`);
        if (++protects > P.protectsPerReign) fail(sc.id, `${tag}: more than ${P.protectsPerReign} protects in one reign`);
        if (value + a > P.cap) fail(sc.id, `${tag}: value above the cap`);
        value += a; treasury += a;
      } else if (e.type === "round_settled") {
        if (B(d.payout) !== treasury) fail(sc.id, `${tag}: payout ${d.payout}, the Treasury held ${treasury}`);
        if (d.winner !== king) fail(sc.id, `${tag}: winner is not the last king`);
        treasury = 0n;
      }
      if (typeof d.king === "string") king = d.king;
      if (d.value !== undefined && B(d.value) !== value) fail(sc.id, `${tag}: value ${d.value}, should be ${value}`);
      if (d.treasury !== undefined && B(d.treasury) !== treasury) fail(sc.id, `${tag}: treasury ${d.treasury}, should be ${treasury}`);
      if (e.type !== "clock_warning" && e.seq !== lastSeq + 1 && sc.id !== "gap") fail(sc.id, `${tag}: seq jumps from ${lastSeq}`);
      if (d.paid !== undefined && B(d.paid) !== B(d.refunded) + B(d.toTreasury)) fail(sc.id, `${tag}: paid is not refunded + toTreasury`);
      lastSeq = e.seq;
    },
    onSnapshot: (s: RoundSnapshot) => {
      if (s.lastSeq > 0 && B(s.pot) !== treasury) fail(sc.id, `snapshot at seq ${s.lastSeq}: pot ${s.pot}, should be ${treasury}`);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    cancelled: () => false,
    label: () => {},
  });
  if (sc.id === "clock" && JSON.stringify({ added, clock: clocks }) !== JSON.stringify(CLOCK_RULE)) {
    fail(sc.id, `added ${added.join(", ")} and clocks ${clocks.join(", ")}, should be ${CLOCK_RULE.added.join(", ")} and ${CLOCK_RULE.clock.join(", ")}`);
  }
  console.log(`${sc.id}: ${events.length} events, Treasury at the end ${treasury}${added.length ? `, added ${added.map((a) => `+${a}s`).join(" ")}` : ""}`);
}
console.log(failures ? `${failures} problem(s)` : "all scenarios follow the money rules");
process.exit(failures ? 1 : 0);
