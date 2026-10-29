import { existsSync, readFileSync } from "node:fs";
import type { Network } from "./keys.ts";

export type ServerGame = {
  gameId: string; // the game's token category, also the round id in URLs
  network: Network;
  pusdCategory: string;
  refereePubkey: string;
  stateAddress: string;
  potAddress: string;
  stateLockingBytecode: string;
  potLockingBytecode: string;
  basePrice: bigint;
  priceStep: bigint;
  fallbackBlocks: number;
  waitingFallbackBlocks: number;
};

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url);

export function loadGames(network: Network): { games: ServerGame[]; chipnetPubkeys: string[] } {
  const f = publicFile(`game.${network}.v2.json`);
  if (!existsSync(f)) throw new Error(`Missing public/game.${network}.v2.json`);
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (j.contractVersion !== 2 || j.network !== network) {
    throw new Error(`public/game.${network}.v2.json is not a v2 ${network} game`);
  }
  const game: ServerGame = {
    gameId: j.gameCategory,
    network,
    pusdCategory: j.pusdCategory,
    refereePubkey: j.refereePubkey,
    stateAddress: j.state.address,
    potAddress: j.pot.address,
    stateLockingBytecode: j.state.lockingBytecode,
    potLockingBytecode: j.pot.lockingBytecode,
    basePrice: BigInt(j.params.basePrice),
    priceStep: BigInt(j.params.priceStep),
    fallbackBlocks: Number(j.params.fallbackBlocks),
    waitingFallbackBlocks: Number(j.params.waitingFallbackBlocks),
  };
  const chipnetFile = publicFile("game.chipnet.v2.json");
  const chipnetPubkeys = existsSync(chipnetFile)
    ? [JSON.parse(readFileSync(chipnetFile, "utf8")).refereePubkey as string]
    : [];
  return { games: [game], chipnetPubkeys };
}