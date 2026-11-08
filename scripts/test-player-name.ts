// The player name rules (src/lib/playerName.ts), shared by the picker and the referee. Run: node scripts/test-player-name.ts
import assert from "node:assert/strict";
import { checkName, nameKey } from "../src/lib/playerName.ts";

const good = (raw: string, name: string) => {
  const r = checkName(raw);
  assert.ok(r.ok, `"${raw}" should be allowed`);
  assert.equal(r.ok && r.name, name, `"${raw}" should become "${name}"`);
};
const bad = (raw: string, problem: string) => {
  const r = checkName(raw);
  assert.deepEqual(r, { ok: false, problem }, `"${raw}" should be refused (${problem})`);
};

// allowed, and cleaned
good("Charles", "Charles");
good("  Charles   the   Bold ", "Charles the Bold"); // repeated spaces collapse
good("Zoë", "Zoë");
good("José María", "José María");
good("Ngozi O'Neil", "Ngozi O'Neil");
good("Anne-Marie", "Anne-Marie");
good("O’Brien", "O'Brien"); // a curly apostrophe becomes a straight one
good("Kofi 2", "Kofi 2");
good("Al", "Al"); // 2 characters: the shortest
good("Abcdefghijklmnop", "Abcdefghijklmnop"); // 16: the longest
good("Łucja Żak", "Łucja Żak");
console.log("ok: letters with accents, digits, spaces, apostrophes and hyphens; spaces collapse; 2 to 16 characters");

// a leading King or Queen is stripped (the title comes from the portrait)
good("King Charles", "Charles");
good("queen Amina", "Amina");
good("KING   Kwame", "Kwame");
good("King Queen Ada", "Ada");
good("Kingsley", "Kingsley"); // only the whole word
good("Queenie", "Queenie");
bad("King", "length");
bad("Queen ", "length");
console.log("ok: a leading King or Queen (any case) is stripped; Kingsley and Queenie stay");

// length
bad("A", "length");
bad("Abcdefghijklmnopq", "length"); // 17
bad("   ", "length");
bad("", "length");
console.log("ok: shorter than 2 or longer than 16 is refused");

// characters
bad("Bob!", "characters");
bad("<b>Bob</b>", "characters");
bad("Bob_Smith", "characters");
bad("12345", "characters"); // needs at least one letter
bad("--", "characters");
bad("Bob\u0000", "characters");
bad("Bob 🙂", "characters");
console.log("ok: anything else is refused, and a name needs a letter (no HTML, emoji or symbols)");

// links, domains and wallet addresses
bad("http bob", "link");
bad("www bob", "link");
bad("bob.com", "link");
bad("visit x.io", "link");
bad("bitcoincash:qq", "link");
bad("bchtest:qpf50", "link");
bad("BitcoinCash", "link");
console.log("ok: anything that looks like a link, a domain or a wallet address is refused");

// offensive words, as words only
bad("Shit", "word");
bad("Big Fuck", "word");
bad("Mr-Nazi", "word");
good("Dickens", "Dickens"); // not a word match
good("Scunthorpe", "Scunthorpe");
console.log("ok: blocked words are refused as whole words; names that only contain them are allowed");

// the comparison key: case and spaces do not matter
assert.equal(nameKey("Anne Marie"), nameKey("annemarie"));
assert.equal(nameKey("ZOË"), nameKey("zoë"));
assert.notEqual(nameKey("Anne-Marie"), nameKey("Anne Marie"));
console.log("ok: names compare without case and spaces");

console.log("\nAll player name tests passed.");
