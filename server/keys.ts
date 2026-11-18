import { existsSync, readFileSync } from "node:fs";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { SignatureTemplate } from "cashscript";

export type Network = "chipnet" | "mainnet";
export type GameKeyInfo = { gameId: string; refereePubkey: string };
const HEX32 = /^[0-9a-f]{64}$/i;
const CHIPNET_FILE = new URL("../.referee.chipnet.json", import.meta.url);

const pubOf = (key: Uint8Array) => binToHex(new SignatureTemplate(key).publicKey);

function hexStringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && HEX32.test(value)) out.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach((v) => hexStringsIn(v, out));
  return out;
}

// Candidate private keys for a network. Mainnet keys come ONLY from the environment.
function candidates(network: Network): Uint8Array[] {
  const envName = network === "chipnet" ? "REFEREE_KEY_CHIPNET" : "REFEREE_KEY_MAINNET";
  const fromEnv = process.env[envName];
  if (fromEnv) {
    if (!HEX32.test(fromEnv)) throw new Error(`${envName} must be 64 hex characters`);
    return [hexToBin(fromEnv)];
  }
  if (network === "chipnet" && existsSync(CHIPNET_FILE)) {
    return hexStringsIn(JSON.parse(readFileSync(CHIPNET_FILE, "utf8"))).map((h) => hexToBin(h));
  }
  return [];
}

// The per-game key function. v1: one key per network; the game id picks which game's key is returned,
// so per-game keys can be added later without touching callers. Throws at startup if anything is wrong.
export function loadKeyring(opts: { network: Network; games: GameKeyInfo[]; chipnetPubkeys: string[] }) {
  const { network, games, chipnetPubkeys } = opts;
  if (network === "mainnet" && process.env.REFEREE_KEY_CHIPNET) {
    throw new Error("Refusing to start: a chipnet referee key is present in a mainnet environment.");
  }
  const pool = candidates(network);
  if (games.length === 0) throw new Error("No games configured.");
  const byGame = new Map<string, Uint8Array>();
  const addGame = (g: GameKeyInfo, when: string) => {
    const key = pool.find((k) => pubOf(k) === g.refereePubkey);
    if (!key) throw new Error(`${when}: no ${network} referee key matches game ${g.gameId}.`);
    if (network === "mainnet" && chipnetPubkeys.includes(g.refereePubkey)) {
      throw new Error(`${when}: a mainnet game uses a chipnet referee key.`);
    }
    byGame.set(g.gameId, key);
  };
  for (const g of games) addGame(g, "Refusing to start");
  return {
    // A round that appears while the server runs (server/gameRegistry.ts): the same checks as at start
    add(g: GameKeyInfo): void {
      if (!byGame.has(g.gameId)) addGame(g, "Refusing this game");
    },
    keyFor(gameId: string): Uint8Array {
      const k = byGame.get(gameId);
      if (!k) throw new Error(`Unknown game ${gameId}`);
      return k;
    },
    templateFor(gameId: string, sighashType?: ConstructorParameters<typeof SignatureTemplate>[1]) {
      return new SignatureTemplate(this.keyFor(gameId), sighashType);
    },
  };
}