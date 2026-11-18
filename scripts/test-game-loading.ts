// The referee's live round list (server/gameRegistry.ts): new rounds arrive from the round files while it runs, with
// the same checks as at start, and the prepared next round cannot be opened before the current one is settled.
// Real contracts are compiled for the fake rounds; nothing touches a network.   node scripts/test-game-loading.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binToHex, hexToBin, swapEndianness } from "@bitauth/libauth";
import { Contract, MockNetworkProvider, SignatureTemplate, type ElectrumNetworkProvider } from "cashscript";
import { fakeClock } from "../server/clock.ts";
import { readGameFiles, type ServerGame } from "../server/games.ts";
import { makeGameRegistry } from "../server/gameRegistry.ts";
import { loadKeyring } from "../server/keys.ts";
import { makeReferee } from "../server/referee.ts";
import { RoundManager } from "../server/rounds.ts";
import { Store } from "../server/store.ts";
import { buildApp, type AppDeps } from "../server/app.ts";
import { makeLocks } from "../server/lock.ts";
import { CLOCK_SETTINGS } from "../src/refereeParams.ts";

const KEY = randomBytes(32);
process.env.REFEREE_KEY_CHIPNET = binToHex(KEY); // the referee's key for this test only
const PUB = binToHex(new SignatureTemplate(KEY).publicKey);
const OTHER_PUB = binToHex(new SignatureTemplate(randomBytes(32)).publicKey);
const PUSD = "735d04cdead10c2eec0b608ab30b0e9c6edc1b07fa2f06c8ebe99b2e0d2a2163";
const provider = new MockNetworkProvider();
const artifact = (name: string) => JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));

// A game file as deploy-kingdom.ts writes it, for a made-up round
function gameFile(refereePubkey = PUB, tamper = false) {
  const category = randomBytes(32).toString("hex");
  const params = { openingPrice: 500n, feePercent: 2n, cutPercent: 10n, cap: 5000n, protectsPerReign: 2n, unit: 100n, fallbackBlocks: 12n };
  const pot = new Contract(artifact("FungePot"), [swapEndianness(category)], { provider });
  const state = new Contract(artifact("FungeKingdom"), [
    hexToBin(pot.lockingBytecode), swapEndianness(PUSD), hexToBin(refereePubkey),
    params.openingPrice, params.feePercent, params.cutPercent, params.cap, params.protectsPerReign, params.unit, params.fallbackBlocks,
  ], { provider });
  return {
    contractVersion: 3, network: "chipnet", gameCategory: category, pusdCategory: PUSD,
    state: { address: state.address, tokenAddress: state.tokenAddress, lockingBytecode: tamper ? pot.lockingBytecode : state.lockingBytecode },
    pot: { address: pot.address, tokenAddress: pot.tokenAddress, lockingBytecode: pot.lockingBytecode },
    refereePubkey,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === "protectsPerReign" ? Number(v) : String(v)])),
  };
}

// The published site: a map of file name -> contents that the test changes
const site = new Map<string, unknown>();
const fetchImpl = (async (url: string) => {
  const name = String(url).split("/").pop()!;
  if (!site.has(name)) return new Response("<!doctype html><p>page</p>", { status: 404 });
  return new Response(JSON.stringify(site.get(name)), { status: 200 });
}) as unknown as typeof fetch;
const CURRENT = "game.chipnet.kingdom.json";
const NEXT = "game.chipnet.next.json";

async function setup() {
  site.clear();
  const first = gameFile();
  site.set(CURRENT, first);
  const files = await readGameFiles("chipnet", { kind: "url", base: "https://site.test" }, fetchImpl);
  const games: ServerGame[] = [files.current];
  const keyring = loadKeyring({ network: "chipnet", games, chipnetPubkeys: [PUB] });
  const referee = makeReferee(provider as unknown as ElectrumNetworkProvider, keyring, games);
  const { store } = await Store.open(join(mkdtempSync(join(tmpdir(), "games-")), "rounds.json"));
  const manager = new RoundManager(store, fakeClock());
  manager.setClock(files.current.gameId, CLOCK_SETTINGS); // as index.ts does for the round it starts with
  const logs: string[] = [];
  const registry = makeGameRegistry({
    network: "chipnet", source: { kind: "url", base: "https://site.test" }, games, keyring, referee, manager, fetchImpl,
    log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`),
  });
  return { first, games, keyring, referee, manager, registry, logs };
}
const ids = (games: ServerGame[]) => games.map((g) => g.gameId).sort();
const settle = (manager: RoundManager, id: string) => manager.observe(id, { live: false, passCount: 3, scene: null as never });

// 1. The prepared next round is picked up without a restart, and the opening rule holds until the current one settles
{
  const { first, games, manager, registry } = await setup();
  await registry.refresh();
  assert.deepEqual(ids(games), [first.gameCategory], "only the current round so far");
  const next = gameFile();
  site.set(NEXT, next);
  await registry.refresh();
  assert.deepEqual(ids(games), [first.gameCategory, next.gameCategory].sort(), "the next round is served");
  assert.equal(registry.role(next.gameCategory), "next");
  assert.equal(registry.mayOpen(first.gameCategory), true);
  assert.equal(registry.mayOpen(next.gameCategory), false, "not while the current round is unsettled");
  settle(manager, first.gameCategory);
  assert.equal(registry.mayOpen(next.gameCategory), true, "once the current round is settled");

  // 2. The robot promotes: next becomes current and a fresh next appears; the settled round is dropped
  const third = gameFile();
  site.set(CURRENT, next);
  site.set(NEXT, third);
  await registry.refresh();
  assert.deepEqual(ids(games), [next.gameCategory, third.gameCategory].sort());
  assert.equal(registry.role(next.gameCategory), "current");
  assert.equal(registry.mayOpen(third.gameCategory), false);
  console.log("ok    the next round arrives live; it opens only after the current one is settled; promotion");
}

// 3. Bad files are refused and change nothing: a stranger's referee key, contracts that do not match, a broken next
{
  const { first, games, registry, logs } = await setup();
  site.set(NEXT, gameFile(OTHER_PUB));
  await registry.refresh();
  assert.deepEqual(ids(games), [first.gameCategory]);
  site.set(NEXT, gameFile(PUB, true));
  await registry.refresh();
  assert.deepEqual(ids(games), [first.gameCategory]);
  site.set(NEXT, { contractVersion: 2 });
  await registry.refresh();
  assert.deepEqual(ids(games), [first.gameCategory]);
  assert.equal(logs.filter((l) => l.startsWith("WARN")).length, 3, logs.join("\n"));
  site.set(CURRENT, gameFile(OTHER_PUB)); // a bad current file: the old roles stay
  await registry.refresh();
  assert.equal(registry.role(first.gameCategory), "current");
  console.log("ok    a wrong key, wrong contracts and a broken file are refused");
}

// 4. A round being played is kept even when no file names it; an unopened one is dropped
{
  const { first, games, manager, registry } = await setup();
  manager.observe(first.gameCategory, { live: true, passCount: 1, scene: null as never }); // opened: in play
  const replacement = gameFile();
  site.set(CURRENT, replacement);
  site.delete(NEXT);
  await registry.refresh();
  assert.ok(ids(games).includes(first.gameCategory), "still being played: kept");
  settle(manager, first.gameCategory);
  await registry.refresh();
  assert.deepEqual(ids(games), [replacement.gameCategory], "settled: dropped");
  const unopened = gameFile();
  site.set(CURRENT, unopened);
  await registry.refresh();
  assert.deepEqual(ids(games), [unopened.gameCategory], "the replaced round was never opened: dropped");
  console.log("ok    a round in play is kept until settled; an unopened one is dropped");
}

// 5. The routes: the next round answers, and opening it early is refused with not_started
{
  const { first, games, manager, registry } = await setup();
  const next = gameFile();
  site.set(NEXT, next);
  await registry.refresh();
  const app = await buildApp({
    games, manager, chain: { read: async () => { throw new Error("no chain"); }, last: () => undefined } as unknown as AppDeps["chain"],
    clock: { now: () => 0 } as AppDeps["clock"], allowedOrigins: ["http://localhost:5173"], referee: {} as AppDeps["referee"],
    locks: makeLocks(), unconfirmed: {} as AppDeps["unconfirmed"], sleep: async () => {}, mayOpen: registry.mayOpen,
  });
  const events = await app.inject({ method: "GET", url: `/rounds/${next.gameCategory}/events` });
  assert.equal(events.statusCode, 200, "the next round is known to the routes");
  const early = await app.inject({ method: "POST", url: `/rounds/${next.gameCategory}/act`, payload: { action: "open" } });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().error, "not_started");
  settle(manager, first.gameCategory);
  const later = await app.inject({ method: "POST", url: `/rounds/${next.gameCategory}/act`, payload: { action: "open" } });
  assert.notEqual(later.json().error, "not_started", "past the opening rule (then refused for its empty body)");
  assert.equal((await app.inject({ method: "GET", url: `/rounds/${"ab".repeat(32)}/events` })).statusCode, 404);
  await app.close();
  console.log("ok    the routes serve the next round and refuse to open it early");
}

console.log("\nall game loading tests passed");
