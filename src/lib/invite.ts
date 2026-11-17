// Invite links, the part with no page in it: build one, and read who sent the one this page was opened with.
//   https://funge.cash/play/?mode=battlefield&from=King%20Charles
// The name in a link is only ever shown as text, and only when it passes the same rules as a chosen name.
import { checkName } from "./playerName.ts";

// origin: "https://funge.cash" plus the site's base path ("/"); who: "King Charles", or null for no name
export function inviteUrl(origin: string, base: string, who: string | null): string {
  const url = new URL(`${base}play/`, origin);
  url.searchParams.set("mode", "battlefield");
  if (who) url.searchParams.set("from", who);
  return url.toString();
}

// "King Charles" from ?from=King%20Charles, or null when there is none or it is not a valid name
export function invitedBy(search: string): string | null {
  const raw = new URLSearchParams(search).get("from");
  const m = raw ? /^(King|Queen) (.+)$/.exec(raw.trim()) : null;
  if (!m) return null;
  const check = checkName(m[2]!);
  return check.ok && check.name === m[2] ? `${m[1]} ${check.name}` : null;
}
