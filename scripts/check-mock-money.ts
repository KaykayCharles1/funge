// Checks every mock round against the money rules, without a browser: the battlefield scenarios
// (src/battlefield/mockScenarios.ts) and the page's own mock round (src/mockRound.ts).
// For each event: paid = refunded + toTreasury, the conquest money from conquestMoney (fee and cut), the protect
// amounts and limits, the value and Treasury after each step, the snapshot pot, the payout and the winner.
// Run: npm run check:mock-money
import { CONFIG } from "../src/config.ts";
import { conquestMoney } from "../src/lib/kingdom.ts";
import { SCENARIOS as EXTRA } from "../src/battlefield/mockScenarios.ts";
import { playMockRound } from "../src/mockRound.ts";
import type { RefereeEvent, RoundSnapshot } from "../src/referee/api.ts";

const SCENARIOS = [...EXTRA, { id: "mockRound.ts", label: "", play: playMockRound }];

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
  await sc.play({
    now: () => clock,
    shiftClock: (ms) => (clock += ms),
    onEvent: (e) => {
      events.push(e);
      const d = e.data ?? {};
      const tag = `seq ${e.seq} ${e.type}/${e.reason}`;
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
  console.log(`${sc.id}: ${events.length} events, Treasury at the end ${treasury}`);
}
console.log(failures ? `${failures} problem(s)` : "all scenarios follow the money rules");
process.exit(failures ? 1 : 0);
