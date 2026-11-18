import { existsSync, readFileSync } from "node:fs";
import type { Network } from "./keys.ts";

// The Kingdom rules that are fixed in the contract when a game is deployed
export type KingdomParams = {
  openingPrice: bigint;
  feePercent: bigint;
  cutPercent: bigint;
  cap: bigint;
  protectsPerReign: number;
  unit: bigint; // the smallest protect amount (1 PUSD); the three amounts are 1x, 5x and 10x
};

export type ServerGame = {
  gameId: string; // the game's token category, also the round id in URLs
  network: Network;
  pusdCategory: string;
  refereePubkey: string;
  stateAddress: string;
  potAddress: string;
  stateLockingBytecode: string;
  potLockingBytecode: string;
  fallbackBlocks: number;
  kingdom: KingdomParams;
};

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url);
const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`, "i");

function need(ok: boolean, what: string): void {
  if (!ok) throw new Error(`Game file: ${what}`);
}

// The Kingdom game file (contractVersion 3), written by the deploy script
export function parseKingdomGameFile(j: any, network: Network): ServerGame {
  need(j && j.contractVersion === 3 && j.network === network, `not a Kingdom ${network} game (contractVersion 3)`);
  need(HEX(64).test(j.gameCategory) && HEX(64).test(j.pusdCategory), "gameCategory and pusdCategory must be 64 hex characters");
  need(HEX(66).test(j.refereePubkey), "refereePubkey must be 66 hex characters");
  need(typeof j.state?.address === "string" && typeof j.pot?.address === "string", "state and pot addresses are missing");
  need(/^[0-9a-f]+$/i.test(j.state?.lockingBytecode ?? "") && /^[0-9a-f]+$/i.test(j.pot?.lockingBytecode ?? ""), "locking bytecodes are missing");
  const p = j.params ?? {};
  const big = (name: string): bigint => {
    try {
      return BigInt(p[name]);
    } catch {
      throw new Error(`Game file: params.${name} is missing or not a whole number`);
    }
  };
  const params: KingdomParams = {
    openingPrice: big("openingPrice"), feePercent: big("feePercent"), cutPercent: big("cutPercent"),
    cap: big("cap"), protectsPerReign: Number(big("protectsPerReign")), unit: big("unit"),
  };
  const fallbackBlocks = Number(big("fallbackBlocks"));
  need(params.openingPrice > 0n && params.unit > 0n, "openingPrice and unit must be above zero");
  need(params.feePercent >= 0n && params.feePercent <= 100n && params.cutPercent >= 0n && params.cutPercent <= 100n, "fee and cut are whole percents from 0 to 100");
  need(params.cap >= params.openingPrice, "cap cannot be below the opening price");
  need(params.protectsPerReign >= 0 && params.protectsPerReign <= 255, "protectsPerReign must be 0 to 255");
  need(Number.isInteger(fallbackBlocks) && fallbackBlocks > 0, "fallbackBlocks must be a whole number above zero");
  return {
    gameId: j.gameCategory,
    network,
    pusdCategory: j.pusdCategory,
    refereePubkey: j.refereePubkey,
    stateAddress: j.state.address,
    potAddress: j.pot.address,
    stateLockingBytecode: j.state.lockingBytecode,
    potLockingBytecode: j.pot.lockingBytecode,
    fallbackBlocks,
    kingdom: params,
  };
}

// ---- The current round and the prepared next one (server/gameRegistry.ts) ----
// public/game.<network>.kingdom.json is the current round; public/game.<network>.next.json, when there is one, is the
// next round: already deployed, waiting, and not to be opened until the current one is settled.
// They are read from the published site (FUNGE_GAMES_URL, e.g. https://funge.cash) or, without it, from public/.
export type GameSource = { kind: "local" } | { kind: "url"; base: string };
export type GameFiles = { current: ServerGame; next: ServerGame | null; problems: string[] };
export const gameFileNames = (network: Network) => ({ current: `game.${network}.kingdom.json`, next: `game.${network}.next.json` });

async function readOne(source: GameSource, name: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  if (source.kind === "local") {
    const file = publicFile(name);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  }
  const res = await fetchImpl(`${source.base}/${name}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null; // a page instead of a file (the site answers unknown paths with a page): no such file
  }
}

// The current round must be there and valid. A next round that is missing is normal; one that is broken is reported
// in `problems` and ignored.
export async function readGameFiles(network: Network, source: GameSource, fetchImpl: typeof fetch = fetch): Promise<GameFiles> {
  const names = gameFileNames(network);
  const rawCurrent = await readOne(source, names.current, fetchImpl);
  if (rawCurrent === null) throw new Error(`Missing ${names.current} (${source.kind === "url" ? source.base : "public/"})`);
  const current = parseKingdomGameFile(rawCurrent, network);
  const problems: string[] = [];
  let next: ServerGame | null = null;
  try {
    const rawNext = await readOne(source, names.next, fetchImpl);
    if (rawNext !== null) next = parseKingdomGameFile(rawNext, network);
  } catch (e) {
    problems.push(`${names.next}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (next && next.gameId === current.gameId) next = null; // the robot promoted it: the same round
  return { current, next, problems };
}
