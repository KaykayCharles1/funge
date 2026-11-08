// Player names: one set of rules for the picker (live feedback) and the referee (the final word).
// A name is shown only as text (textContent or Phaser text), never as HTML.

export const NAME_MIN = 2;
export const NAME_MAX = 16;

export type NameProblem = "length" | "characters" | "link" | "word";
export type NameCheck = { ok: true; name: string; key: string } | { ok: false; problem: NameProblem };

// Words a name may not contain as a word. Short on purpose: it stops the obvious cases. Add to it freely.
const BLOCKED = [
  "fuck", "fucker", "shit", "cunt", "bitch", "bastard", "dick", "cock", "pussy", "whore", "slut", "twat", "wanker",
  "nigger", "nigga", "faggot", "fag", "retard", "rapist", "rape", "nazi", "hitler", "porn",
];
// Anything that looks like a link, a domain or a wallet address
const LINK = /https?|www|:\/\/|bitcoincash|bchtest|bchreg|simpleledger|\.(com|net|org|io|cash|xyz|app|gg|me|co)\b/i;
// Letters (with accents), digits, spaces, apostrophes and hyphens
const ALLOWED = /^[\p{L}\p{M}0-9' -]+$/u;

// The form two names are compared in: case does not matter, spaces do not count
export const nameKey = (name: string): string => name.normalize("NFC").toLowerCase().replace(/\s+/g, "");

// Cleans a name and says whether it may be used. The cleaned name is what gets stored and shown.
export function checkName(raw: string): NameCheck {
  if (typeof raw !== "string") return { ok: false, problem: "characters" };
  if (LINK.test(raw)) return { ok: false, problem: "link" };
  let name = raw.normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  // The title comes from the portrait, so "King Charles" is stored as "Charles"
  for (let prev = ""; prev !== name; ) {
    prev = name;
    name = name.replace(/^(king|queen)(\s+|$)/i, "").trim();
  }
  if (!ALLOWED.test(name) || !/\p{L}/u.test(name)) return name.length === 0 ? { ok: false, problem: "length" } : { ok: false, problem: "characters" };
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return { ok: false, problem: "length" };
  const words = name.toLowerCase().split(/[\s'-]+/).filter(Boolean);
  const joined = nameKey(name).replace(/['-]/g, "");
  if (words.some((w) => BLOCKED.includes(w)) || BLOCKED.includes(joined)) return { ok: false, problem: "word" };
  return { ok: true, name, key: nameKey(name) };
}
