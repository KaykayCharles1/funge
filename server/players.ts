import { readFileSync } from "node:fs";
import { checkName, nameKey } from "../src/lib/playerName.ts";
import { ActError } from "./actTypes.ts";

// Player profiles: the name and portrait a player chose, stored per round and keyed by the first 22 hex characters
// of the key (the part of a key the chain records for the previous king). A profile is stored only together with a
// valid open or conquest by that same key, and a key keeps the first profile it got in a round.

export type Profile = { name: string; avatarId: string };
export type ProfileClaim = { name: string; avatarId: string };
type PortraitInfo = { title: string; house: string | null };

export const playerKey = (key: string): string => key.slice(0, 22).toLowerCase();

// The portraits, from the page's own manifest: their ids, titles ("King"/"Queen") and houses
let portraits: Map<string, PortraitInfo> | null = null;
export function portraitInfo(): Map<string, PortraitInfo> {
  if (!portraits) {
    const m = JSON.parse(readFileSync(new URL("../public/assets/manifest.json", import.meta.url), "utf8")) as {
      portraits: { id: string; title: string; house?: string }[];
    };
    portraits = new Map(m.portraits.map((p) => [p.id, { title: p.title, house: p.house ?? null }]));
  }
  return portraits;
}

// What the player sent, checked: the cleaned profile to store, or null when this key already has one (it keeps it).
// Throws bad_name, name_taken or avatar_taken; nothing is broadcast then.
export function vetProfile(players: Record<string, Profile>, key: string, claim: ProfileClaim): Profile | null {
  const me = playerKey(key);
  if (players[me]) return null;
  const checked = checkName(claim.name);
  if (!checked.ok) throw new ActError("bad_name", `That name cannot be used (${checked.problem}).`);
  if (!portraitInfo().has(claim.avatarId)) throw new ActError("invalid", "Unknown portrait.");
  for (const [other, p] of Object.entries(players)) {
    if (other === me) continue;
    if (nameKey(p.name) === checked.key) throw new ActError("name_taken", "Another player in this round already uses that name.");
    if (p.avatarId === claim.avatarId) throw new ActError("avatar_taken", "Another player in this round already uses that portrait.");
  }
  return { name: checked.name, avatarId: claim.avatarId };
}

// The players map of the round snapshot: key prefix -> name, portrait, title and house
export function playersView(players: Record<string, Profile> | undefined) {
  const info = portraitInfo();
  return Object.fromEntries(
    Object.entries(players ?? {}).map(([k, p]) => {
      const i = info.get(p.avatarId);
      return [k, { name: p.name, avatarId: p.avatarId, title: i?.title ?? null, house: i?.house ?? null }];
    }),
  );
}
