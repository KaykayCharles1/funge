import type { RefereeEvent, RoundSnapshot } from "./referee/api.ts";

// Where the page announces what happens in the round, for anything that wants to draw it (the animation).
// It carries exactly the events the page itself reacts to, in the order it applies them:
//   "server"  an event pushed by the referee (or read from its history)
//   "client"  an event the page makes itself: only "clock_warning", when the countdown reaches 60, 30 and 10 seconds
//   "mock"    an event from the dev-only mock round player (same shape as a server event)
// and, separately, each full round snapshot the page receives. See docs/EVENTS.md.
export type SceneSource = "server" | "client" | "mock";
export type SceneEventListener = (event: RefereeEvent, source: SceneSource) => void;
export type SceneSnapshotListener = (snapshot: RoundSnapshot, source: "server" | "mock") => void;

const eventListeners = new Set<SceneEventListener>();
const snapshotListeners = new Set<SceneSnapshotListener>();

// Both return a function that stops listening. A listener that throws is skipped; it can never break the page.
export function onSceneEvent(fn: SceneEventListener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export function onSceneSnapshot(fn: SceneSnapshotListener): () => void {
  snapshotListeners.add(fn);
  return () => snapshotListeners.delete(fn);
}

export function emitSceneEvent(event: RefereeEvent, source: SceneSource): void {
  for (const fn of eventListeners) {
    try {
      fn(event, source);
    } catch (e) {
      console.error("scene listener failed:", e instanceof Error ? e.message : String(e));
    }
  }
}
export function emitSceneSnapshot(snapshot: RoundSnapshot, source: "server" | "mock"): void {
  for (const fn of snapshotListeners) {
    try {
      fn(snapshot, source);
    } catch (e) {
      console.error("scene listener failed:", e instanceof Error ? e.message : String(e));
    }
  }
}
