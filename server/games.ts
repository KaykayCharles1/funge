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

// Loads the Kingdom game file. The chipnet referee key is checked against the public key in that file.
export function loadGames(network: Network): { games: ServerGame[]; chipnetPubkeys: string[] } {
  const file = publicFile(`game.${network}.kingdom.json`);
  if (!existsSync(file)) throw new Error(`Missing public/game.${network}.kingdom.json (run scripts/deploy-kingdom.ts)`);
  const j = JSON.parse(readFileSync(file, "utf8"));
  const game = parseKingdomGameFile(j, network);
  return { games: [game], chipnetPubkeys: network === "chipnet" ? [game.refereePubkey] : [] };
}
