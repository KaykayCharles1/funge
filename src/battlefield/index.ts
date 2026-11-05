// The battlefield, mounted above the play page with ?mode=battlefield. Loaded by dynamic import from kingdomMode.ts,
// so Phaser is only downloaded on this page.
import * as Phaser from "phaser";
import { CONFIG } from "../config.ts";
import { COPY } from "../copy.ts";
import { conquestMoney } from "../lib/kingdom.ts";
import type { GameKingdom } from "../lib/game.ts";
import { onSceneEvent, onSceneSnapshot } from "../sceneBus.ts";
import { Director } from "./director.ts";
import type { DirectorStats, FieldState } from "./director.ts";
import { H, W } from "./hud.ts";
import { HOUSES, IdentityBook } from "./identity.ts";
import type { Identity } from "./identity.ts";
import { BattlefieldScene } from "./scene.ts";

const OUTAGE_AFTER_MS = 10_000; // no snapshot for this long after mounting: show the outage ribbon

let mounted = false;
type Fees = { feePercent: bigint; cutPercent: bigint };

export type MountOptions = { myKeys: () => string[] }; // the player's own key hashes (game wallet, own wallet)
const sameKey = (a: string, b: string) => a.slice(0, 22).toLowerCase() === b.slice(0, 22).toLowerCase();

// Safe to call more than once: only the first call creates the game.
export function mountBattlefield(opts: MountOptions): void {
  if (mounted || document.getElementById("battlefield")) return;
  mounted = true;
  const host = document.createElement("div");
  host.id = "battlefield";
  host.className = "mx-auto aspect-video w-full max-w-5xl";
  document.body.prepend(host);

  // The fee and cut come from the game file (the page reads the same file)
  let fees: Fees | null = null;
  void fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.kingdom.json`)
    .then((r) => r.json() as Promise<GameKingdom>)
    .then((g) => {
      fees = { feePercent: BigInt(g.params.feePercent), cutPercent: BigInt(g.params.cutPercent) };
      const s = director?.state;
      if (s && !held) director?.snap(s);
    })
    .catch(() => {});
  const nextCost = (s: FieldState) => (fees && s.king ? conquestMoney(s.value, fees).payment : null);

  let book: IdentityBook | null = null;
  let director: Director | null = null;
  let held = false; // the dev panel is in charge
  let seenSnapshot = false;
  let devMe: string | null = null; // dev panel: pretend to hold this key
  const isMe = (key: string | null) => !!key && (opts.myKeys().some((k) => sameKey(k, key)) || (devMe !== null && sameKey(devMe, key)));
  const kingOf = (s: FieldState): Identity | null => {
    if (!book || !s.king) return null;
    book.setRound(s.roundId);
    return book.get(s.king);
  };

  const scene = new BattlefieldScene(() => {
    book = new IdentityBook(scene.portraits);
    director = new Director({ scene, kingOf, nextCost, isMe, identityOf: (k) => book?.get(k) ?? null });
    scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
      if (!held) director?.tick();
    });
    if (!seenSnapshot) scene.hud.ribbon(COPY.battlefield.connecting);
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("dev") === "1") {
      const panel = devPanel(host, scene, (on) => {
        held = on;
        if (!on && director?.state) director.snap(director.state);
      }, () => fees, (key) => (devMe = key));
      director.onChange = (st) => {
        panel.stats(st);
        const s = director?.state;
        if (!held && s) panel.sync(s, kingOf(s)); // the panel follows the round while it is not holding
      };
    }
  });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: W,
    height: H,
    backgroundColor: "#0f1a33",
    banner: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene: [scene],
  });

  // No snapshot for a while: the referee is not answering
  setTimeout(() => {
    if (!seenSnapshot && director && !held) scene.hud.ribbon(COPY.network.unreachable, "alert");
  }, OUTAGE_AFTER_MS);

  onSceneSnapshot((s) => {
    seenSnapshot = true;
    if (s.lastSeq === 0) book?.reset();
    if (director && !held) director.onSnapshot(s, CONFIG.kingdom.openingPrice);
  });
  onSceneEvent((e) => {
    if (!director || held) return;
    // Register the dethroned king first, so houses follow the order keys appeared in
    const prev = e.data?.previousKing;
    if (book && typeof prev === "string") {
      book.setRound(e.roundId);
      book.get(prev);
    }
    director.onEvent(e);
  });

  if (import.meta.env.DEV) {
    // For poking at it from the console: window.__battlefield.scene / .director()
    (window as unknown as { __battlefield: unknown }).__battlefield = { scene, director: () => director, kingOf };
    // Press D to try the crossfade
    window.addEventListener("keydown", (e) => {
      if (director && e.key === "d" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        scene.setDusk(!scene.isDusk);
      }
    });
  }
}

// ---- Dev only (?mode=battlefield&dev=1): set the kingdom by hand, run mock scenarios, watch the queue. ----
// Not player-facing. It sits above the field, so the page's mock-round bar (bottom right) never covers it.
type DevPanel = { stats: (s: DirectorStats) => void; sync: (s: FieldState, king: Identity | null) => void };

function devPanel(host: HTMLElement, scene: BattlefieldScene, setHeld: (on: boolean) => void, getFees: () => Fees | null, setMe: (key: string | null) => void): DevPanel {
  const box = document.createElement("div");
  box.className = "mx-auto mb-2 flex w-full max-w-5xl flex-col gap-3 rounded-xl bg-slate-800 p-3 text-xs text-slate-200 ring-1 ring-slate-600";
  host.before(box);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };

  // Scenarios and the queue monitor
  const buttons = el("div", "flex flex-wrap items-center gap-2");
  const info = el("div", "flex flex-wrap gap-4 font-mono");
  const status = el("span", "text-slate-300");
  const monitor = el("span", "text-amber-300", "playing: — · waiting: 0");
  info.append(status, monitor);
  box.append(buttons, info);
  void Promise.all([import("./mockScenarios.ts"), import("../kingdomMode.ts")]).then(([{ SCENARIOS }, page]) => {
    for (const sc of SCENARIOS) {
      const b = el("button", "rounded-lg bg-amber-500 px-3 py-1 font-semibold text-slate-900", sc.label);
      b.addEventListener("click", () => {
        hold.checked = false;
        apply();
        void page.playMockScenario(sc.play, (t) => (status.textContent = t));
      });
      buttons.append(b);
    }
    // Pretend to be mock king A (a1a1…), to see "YOUR kingdom" and "Claim your reward"
    const meBox = el("label", "ml-2 flex items-center gap-1 text-slate-300");
    const me = el("input", "");
    me.type = "checkbox";
    me.addEventListener("input", () => setMe(me.checked ? "a1".repeat(20) : null));
    meBox.append(me, "I am king A (a1a1…)");
    const back = el("button", "rounded-lg bg-slate-600 px-3 py-1", "Back to the real round");
    back.addEventListener("click", () => {
      page.stopMockScenario();
      status.textContent = "";
    });
    buttons.append(back, meBox);
  });

  // Manual state
  const grid = el("div", "grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4");
  box.append(grid);
  const row = (label: string, input: HTMLElement, out?: HTMLElement) => {
    const l = el("label", "flex flex-col gap-1");
    const line = el("span", "flex items-center gap-2");
    line.append(input);
    if (out) line.append(out);
    l.append(el("span", "text-slate-400", label), line);
    grid.append(l);
  };
  const select = (opts: [string, string][]) => {
    const s = el("select", "rounded bg-slate-900 px-2 py-1");
    for (const [v, t] of opts) s.append(new Option(t, v));
    return s;
  };
  const range = (min: number, max: number, step: number, value: number) => {
    const r = el("input", "w-full");
    Object.assign(r, { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
    return r;
  };
  const out = () => el("span", "w-12 text-right font-mono");

  const hold = el("input", "");
  hold.type = "checkbox";
  hold.checked = true;
  const house = select([["waiting", "waiting (no king)"], ...HOUSES.map((h, i): [string, string] => [String(i), h.id])]);
  house.value = "0";
  const portrait = select(Array.from({ length: 10 }, (_, i): [string, string] => [String(i), `portrait ${i + 1}`]));
  const value = range(1000, 5000, 100, 1000), valueOut = out();
  const treasury = range(0, 8000, 100, 1000), treasuryOut = out();
  const protects = range(0, 2, 1, 2), protectsOut = out();
  const conquests = range(0, 20, 1, 0), conquestsOut = out();
  row("hold (ignore round updates)", hold);
  row("king house", house);
  row("portrait", portrait);
  row("protects left", protects, protectsOut);
  row("kingdom value", value, valueOut);
  row("treasury", treasury, treasuryOut);
  row("conquests", conquests, conquestsOut);

  function apply() {
    valueOut.textContent = (Number(value.value) / 100).toFixed(2);
    treasuryOut.textContent = (Number(treasury.value) / 100).toFixed(2);
    protectsOut.textContent = protects.value;
    conquestsOut.textContent = conquests.value;
    setHeld(hold.checked);
    if (!hold.checked) return;
    const waiting = house.value === "waiting";
    const state: FieldState = {
      roundId: "dev", status: waiting ? "waiting" : "open", king: waiting ? null : "dev",
      value: BigInt(value.value), treasury: waiting ? 0n : BigInt(treasury.value),
      protectsLeft: Number(protects.value), conquests: Number(conquests.value), openingPrice: CONFIG.kingdom.openingPrice,
      deadline: null, clockMs: null, pausedSince: null, payout: null,
    };
    const p = scene.portraits[Number(portrait.value)];
    const king: Identity | null = waiting || !p ? null : { key: "dev", house: HOUSES[Number(house.value)], portrait: p };
    const fees = getFees();
    scene.cancelScenes();
    scene.hud.ribbon(null);
    scene.hud.setClock(null, null);
    scene.showState(state, king, fees && king ? conquestMoney(state.value, fees).payment : null);
  }
  for (const e of [hold, house, portrait, value, treasury, protects, conquests]) e.addEventListener("input", apply);
  apply();

  return {
    sync: (s, king) => {
      house.value = king ? String(HOUSES.indexOf(king.house)) : "waiting";
      const i = king ? scene.portraits.findIndex((p) => p.id === king.portrait.id) : -1;
      if (i >= 0) portrait.value = String(i);
      value.value = String(s.value);
      treasury.value = String(s.treasury);
      protects.value = String(s.protectsLeft);
      conquests.value = String(s.conquests);
      valueOut.textContent = (Number(s.value) / 100).toFixed(2);
      treasuryOut.textContent = (Number(s.treasury) / 100).toFixed(2);
      protectsOut.textContent = String(s.protectsLeft);
      conquestsOut.textContent = String(s.conquests);
    },
    stats: (s) => {
      monitor.textContent = `playing: ${s.playing ?? "—"} · waiting: ${s.waiting} · dropped: ${s.dropped} · snaps: ${s.snaps} · last seq: ${s.lastSeq}`;
    },
  };
}
