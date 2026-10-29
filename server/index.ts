import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { HEARTBEAT_SECONDS } from "../src/refereeParams.ts";
import { buildApp } from "./app.ts";
import { makeChainReader } from "./chain.ts";
import { systemClock } from "./clock.ts";
import { loadGames } from "./games.ts";
import { loadKeyring, type Network } from "./keys.ts";
import { RoundManager } from "./rounds.ts";
import { Store } from "./store.ts";

const network = CONFIG.network as Network;
const port = Number(process.env.FUNGE_PORT ?? 8787);
const allowedOrigins = (
  process.env.FUNGE_ALLOWED_ORIGINS ??
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
).split(",").map((s) => s.trim());
const dataDir = process.env.FUNGE_DATA_DIR ?? fileURLToPath(new URL("./data", import.meta.url));

try {
  const { games, chipnetPubkeys } = loadGames(network);
  loadKeyring({ network, games, chipnetPubkeys });
  console.log(`referee key OK for ${games.length} game(s) on ${network}`);

  const { store, source } = await Store.open(`${dataDir}/rounds.${network}.json`);
  if (source === "bak") console.warn("state file was damaged; recovered from backup");
  const manager = new RoundManager(store, systemClock);
  manager.onEvent((_id, e) => console.log(`event #${e.seq} ${e.type} (${e.reason})`));
  manager.resumeAfterRestart(); // downtime counts as a pause
  for (const g of games) manager.ensure(g.gameId);
  manager.heartbeat();
  await manager.flush();

  const chain = makeChainReader(makeProvider(), systemClock);
  const app = await buildApp({ games, manager, chain, clock: systemClock, allowedOrigins });

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

  const stop = async () => {
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