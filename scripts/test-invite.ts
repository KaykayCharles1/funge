// Invite links (src/lib/invite.ts): the link, and which names a link may show.   node scripts/test-invite.ts
import assert from "node:assert/strict";
import { invitedBy, inviteUrl } from "../src/lib/invite.ts";

assert.equal(inviteUrl("https://funge.cash", "/", "King Charles"), "https://funge.cash/play/?mode=battlefield&from=King+Charles");
assert.equal(inviteUrl("https://funge.cash", "/", null), "https://funge.cash/play/?mode=battlefield");
assert.equal(invitedBy(new URL(inviteUrl("https://funge.cash", "/", "Queen Ada")).search), "Queen Ada", "a link reads back");
console.log("ok    the link");

const ok: [string, string][] = [
  ["?mode=battlefield&from=King%20Charles", "King Charles"],
  ["?from=Queen+Ada", "Queen Ada"],
  ["?from=King%20Jos%C3%A9", "King José"],
  ["?from=King%20Mary-Jane%20O'Neil", "King Mary-Jane O'Neil"],
];
for (const [q, want] of ok) assert.equal(invitedBy(q), want, q);
console.log("ok    good names are shown");

const bad = [
  "", "?mode=battlefield", "?from=", "?from=Charles", "?from=Emperor%20Charles", "?from=King%20%3Cscript%3Ealert(1)%3C%2Fscript%3E",
  "?from=King%20www.evil.com", "?from=King%20https%3A%2F%2Fx.io", "?from=King%20bchtest%3Aqqq", "?from=King%20fuck",
  `?from=King%20${"A".repeat(30)}`, "?from=King%20A", "?from=King%20%20Charles", "?from=King%20King%20Charles",
];
for (const q of bad) assert.equal(invitedBy(q), null, q);
console.log("ok    anything else shows no banner");
console.log("\nall invite tests passed");
