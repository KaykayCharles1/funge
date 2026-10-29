import { readFileSync } from "node:fs";
import { act, getEvents, getRound, watchRound } from "../src/referee/api.ts";
import { clockInfo, serverNow, syncClock } from "../src/referee/clock.ts";
import { errorText } from "../src/copy.ts";

const game = JSON.parse(readFileSync(new URL("../public/game.chipnet.v2.json", import.meta.url), "utf8"));
const id: string = game.gameCategory;

console.log("clock synced:", await syncClock(), clockInfo());

const unknown = await getRound("00".repeat(32));
console.log("unknown round ->", unknown.ok ? "UNEXPECTED ok" : `${unknown.error}: ${errorText(unknown.error)}`);
const bad = await act(id, {});
console.log("bad act ->", bad.ok ? "UNEXPECTED ok" : `${bad.error}: ${errorText(bad.error)}`);

const first = await getRound(id);
if (!first.ok) {
  console.log("round fetch failed:", first.error, errorText(first.error));
  process.exit(1);
}
let { deadline } = first.round;
const r = first.round;
console.log(`round ${r.status}, pass ${r.passCount}, price ${r.price}, pot ${r.pot}, lastSeq ${r.lastSeq}, paused ${!!r.paused}`);

const history = await getEvents(id, 0);
console.log("events from 0:", history.ok ? `${history.events.length} (resync ${history.resync})` : history.error);

const watch = watchRound(id, r.lastSeq, {
  onEvent: (e) => {
    console.log("event", e.seq, e.type, e.reason, JSON.stringify(e.data ?? {}));
    if (typeof e.data?.deadline === "number") deadline = e.data.deadline;
  },
  onResync: () => console.log("resync requested"),
  onStatus: (s) => console.log("socket", s),
});
const seconds = Number(process.env.WATCH_SECONDS ?? 45);
const ticker = setInterval(() => {
  console.log("countdown", deadline === null ? "no deadline yet" : `${((deadline - serverNow()) / 1000).toFixed(1)}s`);
}, 5000);
setTimeout(() => {
  clearInterval(ticker);
  watch.close();
  process.exit(0);
}, seconds * 1000);