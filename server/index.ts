import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { HEARTBEAT_SECONDS, UNCONFIRMED_CAP } from "../src/refereeParams.ts";
import { buildApp } from "./app.ts";
import { makeChainReader } from "./chain.ts";
import { systemClock } from "./clock.ts";
import { loadGames } from "./games.ts";
import { loadKeyring, type Network } from "./keys.ts";
import { makeLocks } from "./lock.ts";
import { makeReferee } from "./referee.ts";
import { RoundManager } from "./rounds.ts";
import { Store } from "./store.ts";
import { makeUnconfirmed } from "./unconfirmed.ts";
import { createKeeper } from "./keeper.ts";

const network = CONFIG.network as Network;
const port = Number(process.env.FUNGE_PORT ?? 8787);
const allowedOrigins = (
  process.env.FUNGE_ALLOWED_ORIGINS ??
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
).split(",").map((s) => s.trim());
const dataDir = process.env.FUNGE_DATA_DIR ?? fileURLToPath(new URL("./data", import.meta.url));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

try {
  const { games, chipnetPubkeys } = loadGames(network);
  const keyring = loadKeyring({ network, games, chipnetPubkeys }); // throws if the key is missing or wrong
  console.log(`referee key OK for ${games.length} game(s) on ${network}`);

  const provider = makeProvider();
  const referee = makeReferee(provider, keyring, games); // throws if the contracts do not match the game

  const { store, source } = await Store.open(`${dataDir}/rounds.${network}.json`);
  if (source === "bak") console.warn("state file was damaged; recovered from backup");
  const manager = new RoundManager(store, systemClock);
  manager.onEvent((_id, e) => console.log(`event #${e.seq} ${e.type} (${e.reason})`));
  manager.resumeAfterRestart(); // downtime counts as a pause
  for (const g of games) manager.ensure(g.gameId);
  manager.heartbeat();
  await manager.flush();

  const chain = makeChainReader(provider, systemClock);
  const unconfirmed = makeUnconfirmed(UNCONFIRMED_CAP);
  const locks = makeLocks();
  const app = await buildApp({
    games, manager, chain, clock: systemClock, allowedOrigins,
    referee, locks, unconfirmed, sleep,
  });
  const keeper = createKeeper({ manager, chain, clock: systemClock, referee, locks, unconfirmed, sleep }, games);
  const stopKeeper = keeper.start();

  // Keep the chain view fresh (Step 7 replaces this polling with address subscriptions)
  setInterval(() => {
    for (const g of games) {
      chain.read(g).catch((e) => console.warn("chain read failed:", e instanceof Error ? e.message : String(e)));
    }
  }, 2000);
  // Check deadlines every second from the last known chain view (no network needed)
  setInterval(() => {
    for (const g of games) {
      const c = chain.last(g.gameId);
      if (c) manager.observe(g.gameId, { live: c.live, passCount: c.passCount });
    }
  }, 1000);
  setInterval(() => manager.heartbeat(), HEARTBEAT_SECONDS * 1000);

  // A new block clears the unconfirmed counter and lifts a "network busy" pause
  let lastHeight: number | undefined;
  setInterval(() => {
    provider.getBlockHeight().then(
      (h) => {
        if (lastHeight !== undefined && h !== lastHeight) {
          unconfirmed.resetAll();
          for (const g of games) {
            if (manager.get(g.gameId).paused?.reason === "network_busy") manager.resume(g.gameId, "network_ok");
          }
        }
        lastHeight = h;
      },
      (e) => console.warn("block height failed:", e instanceof Error ? e.message : String(e)),
    );
  }, 5000);

  const stop = async () => {
    stopKeeper();
    manager.heartbeat();
    await manager.flush().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const address = await app.listen({ host: "127.0.0.1", port }); // localhost only until Step 10
  console.log(`referee server listening on ${address}; allowed origins: ${allowedOrigins.join(", ")}`);
  for (const g of games) console.log(`round id: ${g.gameId}`);
} catch (e) {
  console.error("Cannot start:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}