// Who is who on the battlefield, per round. A player who chose a name and portrait (the referee's players map, and
// actorName/actorAvatar on their events) is shown with them: "King Charles". A key with no profile, or a round the
// referee no longer has saved state for, gets a derived one: a portrait (with its made-up name) picked by hash.
// Houses: the house of the portrait (manifest.json), so the army, banners, frame and plate ring match the outfit.
// Two players may share a house. Everything about identity lives in this file.

export type House = {
  id: "violet" | "crimson" | "obsidian" | "sapphire";
  color: number; // banner, soldiers, HUD ring
  text: number; // outlines and text in this house's colour, readable on dark backgrounds
  soldier: string; // texture key
  edge?: boolean; // draw a silver edge on the banner (a dark house)
};

export const HOUSES: readonly House[] = [
  { id: "violet", color: 0x8a55e0, text: 0xb48cf0, soldier: "soldier_violet" },
  { id: "crimson", color: 0xd63a3c, text: 0xf07a7b, soldier: "soldier_crimson" },
  { id: "obsidian", color: 0x4a4a58, text: 0xd0d3de, soldier: "soldier_obsidian", edge: true },
  { id: "sapphire", color: 0x2f73e0, text: 0x7fb0f5, soldier: "soldier_sapphire" },
];

// face: the face box in the full portrait's pixels (manifest.json), for round avatars cropped from the portrait
export type Portrait = { id: string; title: string; name: string; image: string; avatar: string; house?: string; face?: { x: number; y: number; size: number } };

// name: what the page shows, "King Charles" (chosen) or "Queen Maelis" (derived)
export type Identity = { key: string; house: House; portrait: Portrait; name: string };
export type Profile = { name: string; avatarId: string };

// Keys are compared by their first 22 hex characters: the chain records only that much of the previous king.
const prefix = (key: string) => key.slice(0, 22).toLowerCase();

// The house a portrait belongs to; a portrait without one (an older manifest) falls back to the order keys appeared in
export const houseOfPortrait = (p: Portrait, fallback: number): House => HOUSES.find((h) => h.id === p.house) ?? HOUSES[fallback % HOUSES.length]!;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class IdentityBook {
  private round: string | null = null;
  private byKey = new Map<string, Identity>();
  private profiles = new Map<string, Profile>(); // chosen names, by key prefix

  private portraits: readonly Portrait[];

  constructor(portraits: readonly Portrait[]) {
    this.portraits = portraits;
  }

  // Start over when the round changes
  setRound(roundId: string): void {
    if (roundId === this.round) return;
    this.round = roundId;
    this.byKey.clear();
    this.profiles.clear();
  }

  // The referee's players map (from a snapshot): chosen names, by key prefix
  setPlayers(players: Record<string, { name: string; avatarId: string }> | undefined): void {
    for (const [k, p] of Object.entries(players ?? {})) this.learn(k, p.name, p.avatarId);
  }

  // One player's chosen name and portrait (from a snapshot or an event). A key keeps the first one it got.
  learn(key: string, name: string, avatarId: string): void {
    const p = prefix(key);
    if (this.profiles.has(p) || !this.portraits.some((x) => x.id === avatarId)) return;
    this.profiles.set(p, { name, avatarId });
    const known = this.byKey.get(p);
    if (known) this.byKey.set(p, this.withProfile(known));
  }

  // The chosen name, if any, else the derived one
  private withProfile(id: Identity): Identity {
    const chosen = this.profiles.get(prefix(id.key));
    const portrait = chosen ? this.portraits.find((x) => x.id === chosen.avatarId) : undefined;
    if (!chosen || !portrait) return id;
    return { ...id, portrait, house: houseOfPortrait(portrait, HOUSES.indexOf(id.house)), name: `${portrait.title} ${chosen.name}` };
  }

  // A round that starts over (no events yet) forgets who was who
  reset(): void {
    this.byKey.clear();
    this.profiles.clear();
  }

  get(key: string): Identity {
    const p = prefix(key);
    const known = this.byKey.get(p);
    if (known) return known;
    // Portrait by hash; if it is taken (by anyone shown, or by a chosen profile), the next free one (while any are free)
    const used = new Set([...this.byKey.values()].map((i) => i.portrait.id));
    for (const pr of this.profiles.values()) used.add(pr.avatarId);
    let at = hash(p) % this.portraits.length;
    for (let tries = 0; tries < this.portraits.length && used.has(this.portraits[at].id); tries++) {
      at = (at + 1) % this.portraits.length;
    }
    const portrait = this.portraits[at];
    const id = this.withProfile({ key, house: houseOfPortrait(portrait, this.byKey.size), portrait, name: displayName(portrait) });
    this.byKey.set(p, id);
    return id;
  }
}

export const displayName = (p: Portrait) => `${p.title} ${p.name.split(" ")[0]}`;
