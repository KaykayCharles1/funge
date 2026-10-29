import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { GRACE_SECONDS } from "../src/refereeParams.ts";
import type { ChainReader, ChainState } from "./chain.ts";
import type { Clock } from "./clock.ts";
import type { ServerGame } from "./games.ts";
import type { RoundManager } from "./rounds.ts";
import type { RoundRecord } from "./store.ts";

export type AppDeps = {
  games: ServerGame[];
  manager: RoundManager;
  chain: ChainReader;
  clock: Clock;
  allowedOrigins: string[];
  logger?: boolean;
};

export function describeRound(game: ServerGame, round: RoundRecord, chain: ChainState, now: number) {
  const remainingMs =
    round.deadline === null ? null : round.paused ? round.deadline - round.paused.since : round.deadline - now;
  return {
    gameId: game.gameId,
    network: game.network,
    status: round.status,
    deadline: round.deadline, // epoch ms on the SERVER clock
    remainingMs, // frozen while paused; clients should prefer this plus serverNow
    paused: round.paused,
    serverNow: now,
    graceSeconds: GRACE_SECONDS,
    lastSeq: round.nextSeq - 1,
    passCount: chain.passCount,
    king: chain.live && chain.passCount > 0 ? chain.holderPkh : null,
    price: chain.live ? (game.basePrice + game.priceStep * BigInt(chain.passCount)).toString() : null,
    pot: chain.potAmount === null ? null : chain.potAmount.toString(),
    stateCoin: chain.stateTxid ? { txid: chain.stateTxid, vout: chain.stateVout } : null,
    refereePubkey: game.refereePubkey,
    chainStale: chain.stale,
  };
}

type Client = { send: (text: string) => void };

export async function buildApp(deps: AppDeps) {
  const { games, manager, chain, clock, allowedOrigins } = deps;
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cors, { origin: allowedOrigins, methods: ["GET", "POST"] });
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
      const round = manager.observe(id, { live: c.live, passCount: c.passCount });
      return describeRound(game, round, c, clock.now());
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