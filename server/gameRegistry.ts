// The rounds this referee serves, kept up to date while it runs: no restart for a new round.
// Every 10 seconds index.ts calls refresh(), which reads the current round's file and the prepared next round's file
// (server/games.ts). A round it has not seen gets the same checks as at start: our referee key, and contracts that
// match the compiled ones; one that fails is reported and never served. Rounds that no file names any more are
// dropped once nobody is playing them (settled, or never opened).
//   The opening rule: the next round cannot be opened until the current one is settled. The referee co-signs every
//   open, so this holds on chain too.
import { CLOCK_SETTINGS } from "../src/refereeParams.ts";
import { readGameFiles, type GameSource, type ServerGame } from "./games.ts";
import type { Network } from "./keys.ts";
import type { RoundManager } from "./rounds.ts";

export type GameRegistry = {
  refresh: () => Promise<void>;
  mayOpen: (gameId: string) => boolean;
  role: (gameId: string) => "current" | "next" | "other";
};

export function makeGameRegistry(o: {
  network: Network;
  source: GameSource;
  games: ServerGame[]; // shared with the routes, the keeper and the timers: changed in place
  keyring: { add: (g: ServerGame) => void };
  referee: { add: (g: ServerGame) => void };
  manager: RoundManager;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  fetchImpl?: typeof fetch;
}): GameRegistry {
  const log = o.log ?? console.log;
  const warn = o.warn ?? console.warn;
  let currentId: string | null = o.games[0]?.gameId ?? null;
  let nextId: string | null = null;

  // A round not served yet: check it, then serve it
  function admit(g: ServerGame): boolean {
    if (o.games.some((x) => x.gameId === g.gameId)) return true;
    try {
      o.keyring.add(g);
      o.referee.add(g);
    } catch (e) {
      warn(`ignoring round ${g.gameId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    o.games.push(g);
    o.manager.setClock(g.gameId, CLOCK_SETTINGS);
    o.manager.ensure(g.gameId);
    log(`round loaded: ${g.gameId}`);
    return true;
  }

  return {
    async refresh() {
      const files = await readGameFiles(o.network, o.source, o.fetchImpl);
      for (const p of files.problems) warn(p);
      if (!admit(files.current)) return; // a bad current file changes nothing
      currentId = files.current.gameId;
      nextId = files.next && admit(files.next) ? files.next.gameId : null;
      for (let i = o.games.length - 1; i >= 0; i--) {
        const id = o.games[i]!.gameId;
        if (id === currentId || id === nextId) continue;
        const status = o.manager.get(id).status;
        if (status === "settled" || status === "waiting") {
          o.games.splice(i, 1); // a round being played is kept until it is settled
          log(`round dropped: ${id}`);
        }
      }
      o.manager.pruneSettled(o.games.map((g) => g.gameId));
    },
    mayOpen(gameId) {
      if (gameId === currentId) return true;
      if (gameId === nextId) return currentId === null || o.manager.get(currentId).status === "settled";
      return false;
    },
    role: (gameId) => (gameId === currentId ? "current" : gameId === nextId ? "next" : "other"),
  };
}
