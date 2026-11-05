// Who is who on the battlefield. Events carry only key hashes, so until players can choose a name and avatar,
// each key gets one here, per round: the next free house in order, and a portrait (with its name) picked by hash.
// Everything about identity lives in this file, so chosen names and avatars can replace it later.

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

export type Portrait = { id: string; title: string; name: string; image: string; avatar: string };

export type Identity = { key: string; house: House; portrait: Portrait };

// Keys are compared by their first 22 hex characters: the chain records only that much of the previous king.
const prefix = (key: string) => key.slice(0, 22).toLowerCase();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class IdentityBook {
  private round: string | null = null;
  private byKey = new Map<string, Identity>();

  private portraits: readonly Portrait[];

  constructor(portraits: readonly Portrait[]) {
    this.portraits = portraits;
  }

  // Start over when the round changes
  setRound(roundId: string): void {
    if (roundId === this.round) return;
    this.round = roundId;
    this.byKey.clear();
  }

  // A round that starts over (no events yet) hands out houses from the start again
  reset(): void {
    this.byKey.clear();
  }

  get(key: string): Identity {
    const p = prefix(key);
    const known = this.byKey.get(p);
    if (known) return known;
    const n = this.byKey.size;
    const house = HOUSES[n % HOUSES.length];
    // Portrait by hash; if it is taken, the next free one (while any are free)
    const used = new Set([...this.byKey.values()].map((i) => i.portrait.id));
    let at = hash(p) % this.portraits.length;
    for (let tries = 0; tries < this.portraits.length && used.has(this.portraits[at].id); tries++) {
      at = (at + 1) % this.portraits.length;
    }
    const id: Identity = { key, house, portrait: this.portraits[at] };
    this.byKey.set(p, id);
    return id;
  }
}

export const displayName = (p: Portrait) => `${p.title} ${p.name.split(" ")[0]}`;
