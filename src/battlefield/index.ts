// The battlefield, mounted above the play page with ?mode=battlefield. Loaded by dynamic import from kingdomMode.ts,
// so Phaser is only downloaded on this page.
import * as Phaser from "phaser";
import { CONFIG } from "../config.ts";
import { CLOCK_CAP_SECONDS } from "../refereeParams.ts";
import { COPY } from "../copy.ts";
import { conquestMoney } from "../lib/kingdom.ts";
import type { GameKingdom } from "../lib/game.ts";
import type { RoundSnapshot } from "../referee/api.ts";
import { onSceneEvent, onSceneSnapshot } from "../sceneBus.ts";
import { inviterName, mountInviteBanner, openInvite } from "./invite.ts";
import { mountActionBar } from "./actions.ts";
import type { PageDo, PageView } from "./actions.ts";
import { Director } from "./director.ts";
import type { DirectorStats, FieldState } from "./director.ts";
import { H, W } from "./hud.ts";
import { displayName, HOUSES, IdentityBook } from "./identity.ts";
import type { Identity } from "./identity.ts";
import { BattlefieldScene } from "./scene.ts";
import { installUnlock, preloadTracks } from "./sound.ts";
import { Banners } from "./banners.ts";
import { mountPanel } from "./panel.ts";
import { mountWalletPanel } from "./walletPanel.ts";
import { TopBar } from "./topbar.ts";

const OUTAGE_AFTER_MS = 10_000; // no snapshot for this long after mounting: show the outage ribbon
// The phone layout comes in Phase B of the redesign; until then the field covers every screen the same way
const COMPACT_BELOW_PX = 0;

let mounted = false;
type Fees = { feePercent: bigint; cutPercent: bigint };

export type MountOptions = {
  myKeys: () => string[]; // the player's own key hashes (game wallet, own wallet)
  page: () => PageView; // the page's own state, for the action bar
  run: PageDo; // the page's own handlers: conquer, protect, claim, cancel
};
const sameKey = (a: string, b: string) => a.slice(0, 22).toLowerCase() === b.slice(0, 22).toLowerCase();

// Safe to call more than once: only the first call creates the game.
export function mountBattlefield(opts: MountOptions): void {
  if (mounted || document.getElementById("battlefield")) return;
  mounted = true;
  const host = document.createElement("div");
  host.id = "battlefield";
  // The field fills the window (the redesign's "cover": a little sky and grass is cut, never the castle)
  host.className = "relative w-full overflow-hidden bg-[#0a1226]";
  host.style.height = "100dvh";
  // The page showed a placeholder while this code downloaded; the loading screen takes over from it
  document.getElementById("battlefield-boot")?.remove();
  document.body.prepend(host);
  const loading = loadingScreen(host);
  installUnlock(); // sound starts with the player's first tap or click
  preloadTracks(`${import.meta.env.BASE_URL}assets/audio/`); // the waiting theme and the war opening

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
  // The connection ribbon: "Connecting…", then the outage notice after 10 s. Only while nothing else is in
  // charge: never over a mock round or scenario, never while the dev panel holds, gone at the first real snapshot.
  let serverSeen = false; // a snapshot from the real server arrived
  let mockOn = false; // a mock round or scenario is feeding the page
  let waitFrom = performance.now();
  let connShown: "connecting" | "outage" | null = null;
  const connection = () => {
    if (!director) return;
    const want = serverSeen || mockOn || held ? null : performance.now() - waitFrom >= OUTAGE_AFTER_MS ? "outage" : "connecting";
    if (want === connShown) return;
    if (want === "outage") scene.hud.ribbon(COPY.network.unreachable, "alert");
    else if (want === "connecting") scene.hud.ribbon(COPY.battlefield.connecting);
    else if (connShown) scene.hud.ribbon(null); // only clears a ribbon it put up
    connShown = want;
  };
  setInterval(connection, 500);
  let banners: Banners | null = null;
  let early: RoundSnapshot | null = null; // a snapshot that came before the scene was ready
  let devMe: string | null = null; // dev panel: pretend to hold this key
  const isMe = (key: string | null) => !!key && (opts.myKeys().some((k) => sameKey(k, key)) || (devMe !== null && sameKey(devMe, key)));
  const kingOf = (s: FieldState): Identity | null => {
    if (!book || !s.king) return null;
    book.setRound(s.roundId);
    return book.get(s.king);
  };

  const scene = new BattlefieldScene(() => {
    book = new IdentityBook(scene.portraits);
    if (early) {
      book.setRound(early.gameId);
      book.setPlayers(early.players);
    }
    director = new Director({ scene, kingOf, nextCost, isMe, identityOf: (k) => book?.get(k) ?? null });
    scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
      if (!held) director?.tick();
    });
    // The top bar, the banners and the middle box over the field take over the canvas plates and cards
    banners = new Banners(host, isMe);
    scene.cardsOnPage = true;
    scene.hud.attachBanners(banners);
    scene.hud.attachDom(new TopBar(host, {
      isMe,
      onInvite: () => {
        const v = opts.page();
        openInvite(inviterName({ actingPkh: v.actingPkh, players: v.players, portraits: scene.portraits }));
      },
      onMenu: () => wallet.open(),
    }));
    connection();
    loading.done();
    layout();
    // The page may have sent its first snapshot while the art was still loading
    if (early && !held) director.onSnapshot(early, CONFIG.kingdom.openingPrice);
    early = null;
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("dev") === "1") {
      const panel = devPanel(host, scene, (on) => {
        held = on;
        connection();
        if (!on && director?.state) director.snap(director.state);
      }, () => fees, (key) => (devMe = key), () => {
        // Back to the real round: wait for the server again
        mockOn = false;
        waitFrom = performance.now();
        connection();
      });
      director.onChange = (st) => {
        panel.stats(st);
        const s = director?.state;
        if (!held && s) panel.sync(s, kingOf(s)); // the panel follows the round while it is not holding
      };
    }
  }, (share) => loading.progress(share));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: W,
    height: H,
    backgroundColor: "#0f1a33",
    banner: false,
    // No input in the canvas: every control is in the HTML bar. Phaser's input would capture the mouse wheel and
    // touch drags over the field, so the page could not scroll while the pointer or a finger was on it.
    // Each part is named: Phaser reads input.mouse, input.touch, ... and takes a missing one as "on".
    input: { mouse: false, touch: false, keyboard: false, gamepad: false },
    scale: { mode: Phaser.Scale.ENVELOP, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });

  // Phone or wide: the field box changes shape and the HUD moves into bands, when the width crosses the line
  let compact = false;
  function layout(): void {
    const want = host.clientWidth > 0 && host.clientWidth < COMPACT_BELOW_PX;
    if (want === compact || !director) return;
    compact = want;
    scene.setCompact(compact);
    game.scale.refresh();
  }
  let layoutQueued = false;
  window.addEventListener("resize", () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
    });
  });

  // The action bar and the folded old page, under the field
  const wallet = foldOldPage(host, opts.page);
  mountInviteBanner(host, wallet.open);
  mountActionBar(host, opts.page, opts.run, (text) => banners?.popup(text, true), wallet.open, () => scene.portraits, (off) => banners?.setOffline(off));

  onSceneSnapshot((s, source) => {
    if (source === "mock") mockOn = true;
    else serverSeen = true;
    connection();
    if (s.lastSeq === 0) book?.reset();
    if (book) {
      book.setRound(s.gameId);
      book.setPlayers(s.players); // chosen names
    }
    if (!director) early = s;
    else if (!held) director.onSnapshot(s, CONFIG.kingdom.openingPrice);
  });
  onSceneEvent((e) => {
    if (!director || held) return;
    // Register the dethroned king first, so derived portraits are handed out in the order keys appeared in
    const prev = e.data?.previousKing;
    if (book && typeof prev === "string") {
      book.setRound(e.roundId);
      book.get(prev);
    }
    // A chosen name and portrait travel with the player's own moves
    const d = e.data ?? {};
    if (book && typeof d.actor === "string" && typeof d.actorName === "string" && typeof d.actorAvatar === "string") {
      book.setRound(e.roundId);
      book.learn(d.actor, d.actorName, d.actorAvatar);
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

function devPanel(
  host: HTMLElement, scene: BattlefieldScene, setHeld: (on: boolean) => void, getFees: () => Fees | null,
  setMe: (key: string | null) => void, onBack: () => void,
): DevPanel {
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
  // Frames per second, as Phaser counts them (A8: 60 fps with 60 sprites)
  const fps = el("span", "text-emerald-300", "");
  info.append(status, monitor, fps);
  setInterval(() => {
    fps.textContent = `fps ${scene.game.loop.actualFps.toFixed(0)} · objects ${scene.objectCount()}`;
  }, 500);
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
    // The picker as a player would see it, with two portraits and a name taken (nothing is sent)
    const pick = el("button", "rounded-lg bg-slate-600 px-3 py-1 font-semibold", "Picker preview");
    pick.addEventListener("click", () =>
      void import("./picker.ts").then(({ openPicker }) =>
        openPicker({
          portraits: scene.portraits,
          players: {
            a1a1a1a1a1a1a1a1a1a1a1: { name: "Charles", avatarId: "king_05", title: "King", house: "crimson" },
            b2b2b2b2b2b2b2b2b2b2b2: { name: "Amina", avatarId: "king_04", title: "Queen", house: "violet" },
          },
          confirmLabel: () => COPY.battlefield.pickConfirmConquer("10.20"),
          onConfirm: (p) => (status.textContent = `picker chose ${p.name} (${p.avatarId})`),
        }),
      ),
    );
    buttons.append(pick);
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
      onBack();
    });
    // Stress test: 40 more bobbing soldiers on the field (gone at the next redraw)
    const stress = el("button", "rounded-lg bg-slate-600 px-3 py-1", "+40 soldiers");
    stress.addEventListener("click", () => scene.stress(40));
    buttons.append(back, stress, meBox);
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
      deadline: null, capMs: CLOCK_CAP_SECONDS * 1000, pausedSince: null, payout: null, cancelled: null,
    };
    const p = scene.portraits[Number(portrait.value)];
    const king: Identity | null = waiting || !p ? null : { key: "dev", house: HOUSES[Number(house.value)], portrait: p, name: displayName(p) };
    const fees = getFees();
    scene.cancelScenes();
    scene.hud.ribbon(null);
    scene.hud.setClock(null, 0);
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

// The old wallet sections move into the side panel's Wallet tab (until each screen is rebuilt); the rest of the old
// page folds into one section under the field. Nothing is removed: the same elements move, with their handlers.
// The old "Round is over" window gives way to the action bar's Claim.
function foldOldPage(host: HTMLElement, page: () => PageView): { open: () => void } {
  const panel = mountPanel(host, ["localWallet", "wallet", "faucet"]);
  const screens = mountWalletPanel(panel.walletPage, page);
  panel.onOpenWallet = screens.onOpen;
  const app = document.getElementById("app");
  const header = app?.querySelector("header") ?? null;
  const section = (label: string) => {
    const d = document.createElement("details");
    d.className = "rounded-2xl bg-slate-900/60 ring-1 ring-slate-800";
    const s = document.createElement("summary");
    s.className = "flex min-h-11 cursor-pointer select-none items-center px-5 font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300";
    s.textContent = label;
    const body = document.createElement("div");
    body.className = "flex flex-col gap-6 p-3";
    d.append(s, body);
    return { d, body };
  };
  const details = section(COPY.battlefield.roundDetails);
  const move = (to: HTMLElement, ids: string[]) => {
    for (const id of ids) {
      const e = document.getElementById(id);
      if (e) to.append(e);
    }
  };
  move(details.body, ["ended", "live", "refereeNotice", "status"]);
  if (header) header.after(details.d);
  else app?.append(details.d);
  const modal = document.getElementById("overModal");
  if (modal) modal.style.display = "none"; // stays hidden whatever the old page toggles
  return {
    open: () => panel.open("wallet"),
  };
}

// A loading screen over the field box until the art is in: the title and a bar that fills as files arrive
function loadingScreen(host: HTMLElement): { progress: (share: number) => void; done: () => void } {
  const box = document.createElement("div");
  box.className = "absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-[#0f1a33] text-[#f4ead2] transition-opacity duration-500";
  box.setAttribute("role", "status");
  const title = document.createElement("p");
  title.className = "text-lg font-bold sm:text-2xl";
  title.style.fontFamily = "Georgia, 'Times New Roman', serif";
  title.textContent = COPY.battlefield.loading;
  const track = document.createElement("div");
  track.className = "h-3 w-2/3 max-w-md overflow-hidden rounded-full border-2 border-[#e0a93a] bg-[#2a3550]";
  const bar = document.createElement("div");
  bar.className = "h-full bg-[#e0a93a] transition-[width] duration-200";
  bar.style.width = "5%";
  track.append(bar);
  box.append(title, track);
  host.append(box);
  return {
    progress: (share) => {
      bar.style.width = `${Math.max(5, Math.round(share * 100))}%`;
    },
    done: () => {
      bar.style.width = "100%";
      box.style.opacity = "0";
      window.setTimeout(() => box.remove(), 600);
    },
  };
}

