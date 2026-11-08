import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { conquestMoney, protectAmounts } from "../src/lib/kingdom.ts";
import { ACT_BODY_LIMIT, ACT_RATE, GLOBAL_RATE, GRACE_SECONDS, PROTECT_LOCKOUT_SECONDS } from "../src/refereeParams.ts";
import { ActError, executeAct, type Referee } from "./act.ts";
import { settleRound } from "./keeper.ts";
import { playersView } from "./players.ts";
import type { ChainReader, ChainState } from "./chain.ts";
import type { Clock } from "./clock.ts";
import type { ServerGame } from "./games.ts";
import type { LockRunner } from "./lock.ts";
import type { ClockInfo, RoundManager } from "./rounds.ts";
import type { RoundRecord } from "./store.ts";
import type { Unconfirmed } from "./unconfirmed.ts";
import { sceneOf } from "./scene.ts";

export type AppDeps = {
  games: ServerGame[];
  manager: RoundManager;
  chain: ChainReader;
  clock: Clock;
  allowedOrigins: string[];
  referee: Referee;
  locks: LockRunner;
  unconfirmed: Unconfirmed;
  sleep: (ms: number) => Promise<void>;
  logger?: boolean;
  trustProxy?: boolean; // true only behind a host proxy, so rate limits see the visitor and not the proxy
};

// Everything a Kingdom page needs to show, computed on the server so the page and the contract cannot disagree
function describeKingdom(game: ServerGame, round: RoundRecord, chain: ChainState, now: number, clock: ClockInfo | null) {
  const params = game.kingdom;
  const k = chain.kingdom;
  if (!k || !chain.live) return null;
  const open = k.passCount >= 1;
  const money = open ? conquestMoney(k.value, params) : null;
  const protectsLeft = open ? Math.max(0, params.protectsPerReign - k.protects) : 0;
  const amounts = protectAmounts(params.unit).filter((a) => open && protectsLeft > 0 && k.value + a <= params.cap);
  const remainingMs = round.deadline === null ? null : round.paused ? round.deadline - round.paused.since : round.deadline - now;
  return {
    holder: open ? k.holderPkh : null,
    previousKing: open && !/^0+$/.test(k.previous) ? k.previous : null, // the first 11 bytes of the dethroned king's key hash
    value: k.value.toString(),
    openingPrice: params.openingPrice.toString(),
    cap: params.cap.toString(),
    wallsAtMaximum: open && k.value + params.unit > params.cap,
    protectsUsed: k.protects,
    protectsLeft,
    protectsPerReign: params.protectsPerReign,
    protectAmounts: amounts.map((a) => a.toString()),
    conquest: money
      ? { pay: money.payment.toString(), fee: money.fee.toString(), kingGets: money.kingGets.toString(), poolGets: money.poolGets.toString() }
      : null,
    clockSeconds: clock?.clockSeconds ?? null, // seconds on the clock right after the current king's move
    nextClockSeconds: clock?.nextClockSeconds ?? null, // deprecated: what a conquest right now would set the clock to
    floorSeconds: null, // deprecated: the bell's floor is gone (always null)
    clockCapSeconds: clock?.clockCapSeconds ?? null, // the most time the clock can show; the open starts here
    conquestAddSeconds: clock?.conquestAddSeconds ?? null, // what a conquest adds to the time left
    conquestMinSeconds: clock?.conquestMinSeconds ?? null, // a conquest never leaves less (0 = off)
    protectLockoutSeconds: PROTECT_LOCKOUT_SECONDS,
    protectClosesInMs: round.status === "open" && remainingMs !== null ? Math.max(0, remainingMs - PROTECT_LOCKOUT_SECONDS * 1000) : null,
  };
}

export function describeRound(game: ServerGame, round: RoundRecord, chain: ChainState, now: number, clock: ClockInfo | null = null) {
  const remainingMs =
    round.deadline === null ? null : round.paused ? round.deadline - round.paused.since : round.deadline - now;
  const kingdom = describeKingdom(game, round, chain, now, clock);
  // "price" is what it costs to take the throne right now
  const price = !chain.live
    ? null
    : kingdom?.conquest?.pay ?? game.kingdom.openingPrice.toString();
  return {
    gameId: game.gameId,
    network: game.network,
    kind: "kingdom", // the page checks this, so it never talks to a server of another kind
    status: round.status,
    deadline: round.deadline, // epoch ms on the SERVER clock
    remainingMs, // frozen while paused; clients should prefer this plus serverNow
    paused: round.paused,
    serverNow: now,
    graceSeconds: GRACE_SECONDS,
    lastSeq: round.nextSeq - 1,
    passCount: chain.passCount,
    king: chain.live && chain.passCount > 0 ? chain.holderPkh : null,
    price,
    pot: chain.potAmount === null ? null : chain.potAmount.toString(),
    stateCoin: chain.stateTxid ? { txid: chain.stateTxid, vout: chain.stateVout } : null,
    refereePubkey: game.refereePubkey,
    chainStale: chain.stale,
    kingdom,
    players: playersView(round.players), // chosen names: key prefix (22 hex) -> name, avatarId, title, house
  };
}

type Client = { send: (text: string) => void };

export async function buildApp(deps: AppDeps) {
  const { games, manager, chain, clock, allowedOrigins } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? false });
  await app.register(cors, { origin: allowedOrigins, methods: ["GET", "POST"] });
  await app.register(rateLimit, { global: true, max: GLOBAL_RATE.max, timeWindow: GLOBAL_RATE.windowMs });
  await app.register(websocket);

  const byId = new Map(games.map((g) => [g.gameId, g]));
  const clients = new Map<string, Set<Client>>();

  const stopListening = manager.onEvent((gameId, event) => {
    const text = JSON.stringify({ kind: "event", event });
    for (const c of clients.get(gameId) ?? []) c.send(text);
  });
  app.addHook("onClose", async () => stopListening());

  app.get("/health", async () => ({ ok: true, serverNow: clock.now() }));

  app.get("/rounds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = byId.get(id);
    if (!game) return reply.code(404).send({ error: "unknown_round" });
    try {
      const c = await chain.read(game);
      const round = manager.observe(id, { live: c.live, passCount: c.passCount, scene: sceneOf(game, c) });
      return describeRound(game, round, c, clock.now(), manager.clockInfo(id));
    } catch {
      return reply.code(503).send({ error: "chain_unavailable" });
    }
  });

  app.get("/rounds/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!byId.has(id)) return reply.code(404).send({ error: "unknown_round" });
    const after = Number((request.query as { after?: string }).after ?? 0);
    return { serverNow: clock.now(), ...manager.eventsAfter(id, Number.isInteger(after) && after >= 0 ? after : 0) };
  });

  app.post(
    "/rounds/:id/act",
    { bodyLimit: ACT_BODY_LIMIT, config: { rateLimit: { max: ACT_RATE.max, timeWindow: ACT_RATE.windowMs } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const game = byId.get(id);
      if (!game) return reply.code(404).send({ ok: false, error: "unknown_round", serverNow: clock.now() });
      try {
        const result = await executeAct(
          { manager, chain, clock, referee: deps.referee, locks: deps.locks, unconfirmed: deps.unconfirmed, sleep: deps.sleep },
          game,
          request.body,
        );
        return { ok: true, ...result };
      } catch (e) {
        if (e instanceof ActError) {
          return reply.code(e.status).send({ ok: false, error: e.code, message: e.message, serverNow: clock.now() });
        }
        console.error("act failed:", e instanceof Error ? e.message : String(e));
        return reply.code(500).send({ ok: false, error: "internal", message: "Something went wrong.", serverNow: clock.now() });
      }
    },
  );

  // The king's "Claim your reward" button. The contract pays the holder whoever asks, so no login is needed.
  // The client must send a JSON body such as {}.
  app.post(
    "/rounds/:id/claim",
    { config: { rateLimit: { max: ACT_RATE.max, timeWindow: ACT_RATE.windowMs } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const game = byId.get(id);
      if (!game) return reply.code(404).send({ ok: false, error: "unknown_round", serverNow: clock.now() });
      try {
        const result = await settleRound(
          { manager, chain, clock, referee: deps.referee, locks: deps.locks, unconfirmed: deps.unconfirmed, sleep: deps.sleep },
          game,
          "claim",
        );
        return { ok: true, ...result };
      } catch (e) {
        if (e instanceof ActError) {
          return reply.code(e.status).send({ ok: false, error: e.code, message: e.message, serverNow: clock.now() });
        }
        console.error("claim failed:", e instanceof Error ? e.message : String(e));
        return reply.code(500).send({ ok: false, error: "internal", message: "Something went wrong.", serverNow: clock.now() });
      }
    },
  );
  
  app.get("/rounds/:id/ws", { websocket: true }, (socket, request) => {
    // Browsers do not apply CORS to WebSockets, so the origin is checked here
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }
    const { id } = request.params as { id: string };
    if (!byId.has(id)) {
      socket.close(1008, "unknown round");
      return;
    }
    const client: Client = {
      send: (text) => {
        if (socket.readyState === 1) socket.send(text);
      },
    };
    const say = (msg: unknown) => client.send(JSON.stringify(msg));
    const afterRaw = Number((request.query as { after?: string }).after ?? NaN);

    say({ kind: "hello", serverNow: clock.now(), lastSeq: manager.get(id).nextSeq - 1 });
    if (Number.isInteger(afterRaw) && afterRaw >= 0) {
      const missed = manager.eventsAfter(id, afterRaw);
      if (missed.resync) say({ kind: "resync", lastSeq: missed.lastSeq });
      else for (const event of missed.events) say({ kind: "event", event });
    }
    let set = clients.get(id);
    if (!set) clients.set(id, (set = new Set()));
    set.add(client);
    socket.on("close", () => set.delete(client));
  });

  return app;
}