import assert from "node:assert/strict";
import { safeText, warnThrottled } from "../src/lib/safeLog.ts";

// debug links and keys are removed
const err = "Transaction failed\n\nWARNING: see https://ide.bitauth.com/import-template/abc123secret for details";
const cleaned = safeText(err);
assert.ok(!cleaned.includes("bitauth") && !cleaned.includes("abc123secret"));
assert.ok(cleaned.startsWith("Transaction failed"));
assert.equal(safeText(`wif ${"L" + "1".repeat(51)} end`), "wif [key removed] end");
assert.equal(safeText(`xprv${"1".repeat(107)}`), "[key removed]");
assert.equal(safeText(`privateKey: ${"ab".repeat(32)}`), "privateKey: [key removed]");

// ordinary text, txids and addresses are left alone
const txid = "967dc4c8296f1ea85559b23bf5b2ae3414216d762f39e615883b0eb70f91625f";
assert.equal(safeText(`tx ${txid}`), `tx ${txid}`);
assert.equal(safeText("bchtest:qret2r6tyzdvzqav46m85wcnrwvmmgqjpgvh8dz449"), "bchtest:qret2r6tyzdvzqav46m85wcnrwvmmgqjpgvh8dz449");
assert.equal(safeText("Electrum chipnet.imaginary.cash failed"), "Electrum chipnet.imaginary.cash failed");
console.log("ok: secrets removed, ordinary text untouched");

// throttle: once per window, with a count
const lines: string[] = [];
const realWarn = console.warn;
console.warn = (m: string) => void lines.push(m);
warnThrottled("k", "server down", 60_000, 0);
warnThrottled("k", "server down", 60_000, 1_000);
warnThrottled("k", "server down", 60_000, 2_000);
warnThrottled("other", "other problem", 60_000, 2_500);
warnThrottled("k", "server down", 60_000, 61_000);
console.warn = realWarn;
assert.deepEqual(lines, ["server down", "other problem", "server down (2 similar skipped)"]);
console.log("ok: repeating warnings are throttled");

console.log("\nAll safe-log tests passed.");