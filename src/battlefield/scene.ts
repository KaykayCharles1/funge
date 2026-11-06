// The battlefield scene: the field (day, dusk on top), the kingdom in the clearing, the HUD, and the scenes.
import * as Phaser from "phaser";
import { avatarKey, bannerKey, loadFirst, loadLater, makeBanners, makeFxTextures, portraitKey, portraitsOf } from "./assets.ts";
import type { FieldState } from "./director.ts";
import { BAND_TOP, C, css, FONT, H, H_COMPACT, Hud, HUD_DEPTH, money, reducedMotion, W } from "./hud.ts";
import { displayName, HOUSES } from "./identity.ts";
import type { House, Identity, Portrait } from "./identity.ts";
import { COPY } from "../copy.ts";
import { sfx } from "./sound.ts";

const T = COPY.battlefield;
export type SceneRun = { done: Promise<void>; hurry: (totalMs: number, label?: string) => void };
export type Mode = "full" | "short" | "quick";


// What the value builds (docs/ANIMATION_BRIEF.md)
const steps = (value: bigint) => Math.max(0, Math.ceil((Number(value) - 1000) / 500));
export const wallPieces = (value: bigint) => Math.min(8, 2 + steps(value));
export const garrisonSize = (value: bigint) => 6 + 2 * steps(value); // includes the two gate guards and the standard-bearer
const CASTLE_FROM = 2500n; // the three-tower castle from 25.00

// Placement on the 1280x720 field. The castle stands on the far side of the clearing, its base on the grass.
// The road enters at the left edge (x < 200, y 340-450) and the right edge (x > 1060, y 330-420): keep those clear.
const BASE_X = 640, BASE_Y = 410;
const CASTLE_W = W * 0.22; // the three-tower castle is 22% of the field's width
const BUILDING = {
  keep: { height: CASTLE_W * (429 / 400) * 0.9, flags: [[209, 2, 54, 36]] },
  castle: { height: CASTLE_W * (429 / 400), flags: [[202, 2, 42, 26], [63, 99, 34, 21], [335, 99, 34, 21]] },
} as const; // flags: where the art's own flags are, in source pixels [x, y, w, h]
const WALL_W = 88, WALL_STEP = WALL_W * 0.86; // four a side end at about x 217 and x 1063
export const SOLDIER_H = 90; // 72 px at a 1024 px field
const BANNER_H = 88, BANNER_X = 320; // in front of the left wall, between two soldiers' places
const CORRIDOR = 45; // half the clear path in front of the gate door
// The garrison, in the order places fill. Rows 150 px apart (a soldier is about 85 px wide, so 65 px between
// neighbours), staggered, none inside the gate corridor. [x offset from the middle, base y]
const R1 = 538, R2 = 596, R3 = 642;
const PLACES: [number, number][] = [
  [-95, R1], [95, R1], [-170, R2], [-245, R1], [245, R1], [-320, R2], [320, R2], [-95, R3], [95, R3],
  [-395, R1], [395, R1], [-245, R3], [245, R3], [-470, R2], [470, R2], [-395, R3], [395, R3], [-545, R1], [545, R1],
];
const BEARER: [number, number] = [170, R2]; // the standard-bearer's place
type Pt = { x: number; y: number };
const HOUSE_FOR_STRESS = HOUSES[1]!; // dev stress test only

// The march in along the road, from the left or the right edge, ending at the front of the formation
const ROAD = {
  left: [[-70, 425], [90, 434], [210, 478], [330, 520]],
  right: [[1350, 380], [1225, 392], [1105, 452], [960, 520]],
} as const;

// Scene lengths per part, ms (docs/ANIMATION_BRIEF.md: full 1.4 + 1.8 + 1.5 + 1.6, short 3.5, quick 1.2)
const CONQUEST: Record<Mode, { faceoff: number; march: number; clash: number; crown: number }> = {
  full: { faceoff: 1400, march: 1800, clash: 1500, crown: 1600 },
  short: { faceoff: 600, march: 1000, clash: 900, crown: 1000 },
  quick: { faceoff: 0, march: 0, clash: 400, crown: 800 },
};
const OPEN: Record<Mode, number> = { full: 1800, short: 1000, quick: 400 };
export const OVER: Record<Mode, number> = { full: 1800, short: 900, quick: 400 };
export const SETTLE: Record<Mode, number> = { full: 3200, short: 1600, quick: 800 };
export const openLength = (m: Mode) => OPEN[m];
export const conquestLength = (m: Mode) => {
  const c = CONQUEST[m];
  return c.faceoff + c.march + c.clash + c.crown;
};

export type OpenPlay = { mode: Mode; after: FieldState; king: Identity; toTreasury: bigint; nextCost: bigint | null };
export type ProtectPlay = { before: FieldState; after: FieldState; king: Identity; amount: bigint; idle: boolean; nextCost: bigint | null };
export type EndPlay = { mode: Mode; state: FieldState; king: Identity | null; mine: boolean };

export type ConquestPlay = {
  mode: Mode;
  side: "left" | "right"; // where the army comes from
  before: FieldState;
  after: FieldState;
  oldKing: Identity | null;
  newKing: Identity;
  paid: bigint;
  refunded: bigint;
  toTreasury: bigint;
  nextCost: bigint | null;
};

// Small seeded random numbers, so the same state always draws the same field
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Point on a polyline at progress p (0..1)
function along(path: readonly (readonly [number, number])[], p: number): [number, number] {
  const segs = path.length - 1, f = Math.min(segs - 1e-6, Math.max(0, p) * segs), i = Math.floor(f), t = f - i;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
}

// Who owns an effect's objects and tweens: a timed scene (Run) or a loose effect (protect)
interface Fx {
  add<O extends Phaser.GameObjects.GameObject>(o: O, onTop?: boolean): O;
  tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween;
}

// One running scene: its objects, tweens and timers, all on a shared clock that hurry() can speed up.
// Times given to at() and tween durations are in scene time; the speed maps them to real time.
class Run implements Fx {
  private sc: BattlefieldScene;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private speed = 1;
  private clock = { t: 0 }; // scene time passed, advanced by a master tween
  private master: Phaser.Tweens.Tween;
  private startedAt: number;
  private total: number;
  private finished = false;
  private enders: (() => void)[] = [];
  private resolve!: () => void;
  readonly done: Promise<void>;

  constructor(sc: BattlefieldScene, total: number) {
    this.sc = sc;
    this.total = total;
    this.done = new Promise((r) => (this.resolve = r));
    this.startedAt = sc.time.now;
    this.master = sc.tweens.add({ targets: this.clock, t: total, duration: Math.max(1, total), onComplete: () => this.finish() });
  }

  // onTop: over the HUD (coins flying into the Treasury chest)
  add<O extends Phaser.GameObjects.GameObject>(o: O, onTop = false): O {
    this.objs.push(o);
    (onTop ? this.sc.topLayer : this.sc.fxLayer).add(o);
    return o;
  }
  tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween {
    const t = this.sc.tweens.add(cfg);
    t.timeScale = this.speed;
    this.tweens.push(t);
    return t;
  }
  // Run fn at scene time ms from the start
  at(ms: number, fn: () => void): void {
    const ev = this.sc.time.delayedCall(Math.max(0, ms - this.clock.t), () => {
      if (!this.finished) fn();
    });
    ev.timeScale = this.speed;
    this.timers.push(ev);
  }

  // Finish within totalMs of real time from the start
  hurry(totalMs: number): void {
    if (this.finished) return;
    const realLeft = totalMs - (this.sc.time.now - this.startedAt);
    const sceneLeft = this.total - this.clock.t;
    if (realLeft <= 30 || sceneLeft <= 0) {
      this.finish();
      return;
    }
    const speed = Math.max(this.speed, sceneLeft / realLeft);
    if (speed === this.speed) return;
    this.speed = speed;
    this.master.timeScale = speed;
    for (const t of this.tweens) t.timeScale = speed;
    for (const e of this.timers) e.timeScale = speed;
  }

  // Run fn when the scene ends, however it ends (done, hurried to the end, or cancelled)
  onEnd(fn: () => void): void {
    this.enders.push(fn);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const fn of this.enders) fn();
    this.master.remove();
    for (const e of this.timers) e.remove();
    for (const t of this.tweens) t.remove();
    for (const o of this.objs) o.destroy();
    this.sc.endRun(this);
    this.resolve();
  }
}

type Soldier = { img: Phaser.GameObjects.Image; x: number; y: number; post: boolean }; // post: a guard or the bearer
type Marcher = { img: Phaser.GameObjects.Image; base: number; x: number; y: number }; // an attacker and where it stops

export class BattlefieldScene extends Phaser.Scene {
  hud!: Hud;
  portraits: Portrait[] = [];
  fxLayer!: Phaser.GameObjects.Layer; // scene effects, over the kingdom and under the HUD
  topLayer!: Phaser.GameObjects.Layer; // over the HUD, drawn by the HUD camera (coins flying into the chest)
  private hudCam!: Phaser.Cameras.Scene2D.Camera; // draws only the HUD, so the field can shake and zoom under it
  private world!: Phaser.GameObjects.Layer; // the kingdom
  private garrison: Soldier[] = [];
  private building: Phaser.GameObjects.Image | null = null;
  private bannerImg: Phaser.GameObjects.Image | null = null;
  private walls: Phaser.GameObjects.Image[] = [];
  private flagSpots: [number, number][] = []; // castle flags and the banner, for the banner change glow
  private dusk: Phaser.GameObjects.Image | null = null;
  private duskWanted = false;
  private skyFrozen = false;
  private compactOn = false;
  private onReady: () => void;
  private onProgress: (share: number) => void;
  private runs = new Set<Run>();
  private extras = new Set<Phaser.GameObjects.GameObject>(); // loose effects (protect flashes)

  // onProgress: how much of the first load is done, 0..1, for the loading screen
  constructor(onReady: () => void, onProgress: (share: number) => void = () => {}) {
    super("battlefield");
    this.onReady = onReady;
    this.onProgress = onProgress;
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.PROGRESS, (share: number) => this.onProgress(share));
    loadFirst(this.load);
  }

  create(): void {
    const day = this.cover(this.add.image(W / 2, H / 2, "field_day")).setDepth(-2);
    makeBanners(this);
    makeFxTextures(this);
    this.portraits = portraitsOf(this);
    this.world = this.add.layer();
    this.fxLayer = this.add.layer().setDepth(HUD_DEPTH - 1);
    this.topLayer = this.add.layer().setDepth(HUD_DEPTH + 10);
    this.hud = new Hud(this);
    // Two cameras: the main one draws the field and the scenes (and shakes and zooms), the HUD one the HUD
    const notHud = new Set<unknown>([day, this.world, this.fxLayer, this.topLayer]);
    const hudObjects = this.children.list.filter((o) => !notHud.has(o));
    this.hudCam = this.cameras.add(0, 0, W, H);
    this.hudCam.ignore(day).ignore([this.world, this.fxLayer]);
    this.cameras.main.ignore(hudObjects).ignore(this.topLayer);
    this.onReady();

    // The dusk field and the portraits come after the first frame
    this.events.once(Phaser.Scenes.Events.RENDER, () =>
      loadLater(this, () => {
        this.dusk = this.cover(this.add.image(W / 2, H / 2, "field_dusk")).setAlpha(this.duskWanted ? 1 : 0).setDepth(-1);
        this.hudCam.ignore(this.dusk);
      }),
    );
  }

  // ---- The kingdom at rest ----

  // Draw the kingdom and the HUD for this state at once. king: who holds the throne, or null.
  showState(state: FieldState, king: Identity | null, nextCost: bigint | null): void {
    this.hud.show(state, king, nextCost);
    const w = this.world;
    this.tweens.killTweensOf(w.getChildren());
    w.removeAll(true);
    this.garrison = [];
    this.flagSpots = [];
    this.walls = [];
    this.building = this.bannerImg = null;
    if (state.status === "settled" && !king) {
      // Settled, and the server no longer has the round's details: the round is simply finished
      this.drawNotice(COPY.kingdom.finished, T.nextRound);
      return;
    }
    if (state.status === "waiting" || !king) {
      this.drawWaiting(state.openingPrice);
      return;
    }
    const kind = state.value >= CASTLE_FROM ? "castle" : "keep";
    const half = this.drawBuilding(kind, king.house);
    this.drawWalls(wallPieces(state.value), half);
    this.drawBanner(king.house);
    // Once the bell has rung the soldiers stand still
    this.drawGarrison(garrisonSize(state.value), king.house, half, state.status === "open");
    if (state.status === "settled") this.drawFinal(state, king);
  }

  private drawBuilding(kind: keyof typeof BUILDING, house: House): number {
    const spec = BUILDING[kind];
    const img = this.add.image(BASE_X, BASE_Y, kind).setOrigin(0.5, 1);
    const scale = spec.height / img.height;
    img.setScale(scale).setDepth(BASE_Y);
    this.world.add(img);
    this.building = img;
    // Cover the art's flags with pennants in the house colour
    const left = BASE_X - (img.width * scale) / 2, top = BASE_Y - img.height * scale;
    const g = this.add.graphics().setDepth(BASE_Y + 1);
    for (const [fx, fy, fw, fh] of spec.flags) {
      const x = left + (fx - 2) * scale, y = top + (fy - 2) * scale, w = (fw + 6) * scale, h = (fh + 4) * scale;
      const pts = this.points([x, y, x + w, y + h * 0.15, x + w * 0.78, y + h * 0.5, x + w, y + h * 0.85, x, y + h]);
      g.fillStyle(house.color, 1).fillPoints(pts, true);
      g.lineStyle(house.edge ? 2.5 : 1.5, house.text, 1).strokePoints(pts, true);
      this.flagSpots.push([x + w / 2, y + h / 2]);
    }
    this.world.add(g);
    return (img.width * scale) / 2;
  }

  // Walls extend left and right of the building, alternating sides
  private drawWalls(n: number, half: number): void {
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
      const x = BASE_X + side * (half * 0.82 + (k + 0.5) * WALL_STEP);
      const img = this.add.image(x, BASE_Y + 2 + k * 2, "wall").setOrigin(0.5, 1);
      img.setScale(WALL_W / img.width).setDepth(BASE_Y - 1 - k);
      this.world.add(img);
      this.walls.push(img);
    }
  }

  // The house banner stands on the ground in front of the left wall, its top below the wall's foot
  private drawBanner(house: House): void {
    const img = this.add.image(BANNER_X, BASE_Y + BANNER_H + 6, bannerKey(house.id)).setOrigin(0.5, 1);
    img.setScale(BANNER_H / img.height).setDepth(img.y);
    this.world.add(img);
    this.bannerImg = img;
    this.flagSpots.push([BANNER_X, img.y - BANNER_H * 0.6]);
  }

  private soldier(x: number, y: number, house: House, rand: () => number, faceRight: boolean): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, house.soldier).setOrigin(0.5, 1);
    return img.setScale((SOLDIER_H / img.height) * (0.92 + rand() * 0.16)).setDepth(y).setFlipX(!faceRight);
  }

  // Two guards beside the gate door, a standard-bearer with the house banner, the rest in loose rows in front.
  // A corridor in front of the door stays clear.
  private drawGarrison(n: number, house: House, half: number, bob: boolean): void {
    const rand = rng(n * 7919 + house.id.length);
    const still = reducedMotion() || !bob;
    const add = (x: number, y: number, faceRight: boolean, post: boolean) => {
      const img = this.soldier(x, y, house, rand, faceRight);
      this.world.add(img);
      if (!still) this.tweens.add({ targets: img, y: y - 3, duration: 700 + rand() * 300, delay: rand() * 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.garrison.push({ img, x, y, post });
      return img;
    };
    const gx = Math.max(CORRIDOR + 46, half * 0.3);
    add(BASE_X - gx, BASE_Y + 16, true, true);
    add(BASE_X + gx, BASE_Y + 16, false, true);

    const bx = BASE_X + BEARER[0], by = BEARER[1];
    const bearer = add(bx, by, false, true);
    const flag = this.add.image(bx - bearer.displayWidth * 0.28, by - SOLDIER_H * 0.3, bannerKey(house.id)).setOrigin(0.5, 1);
    flag.setScale((SOLDIER_H * 1.2) / flag.height).setDepth(by - 0.5);
    this.world.add(flag);

    for (const [dx, y] of PLACES.slice(0, Math.max(0, n - 3))) {
      const x = BASE_X + dx + (rand() - 0.5) * 6;
      const jy = y === R3 ? y - rand() * 6 : y + (rand() - 0.5) * 10; // the front row never reaches the price panel
      add(x, jy, x < BASE_X, false);
    }
  }

  // The round is settled: the winner's card stays on the field
  private drawFinal(state: FieldState, king: Identity): void {
    const objs = this.winnerCard(king, state, 0.5, 360);
    for (const o of objs) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(2000);
    this.world.add(objs);
  }

  // The winner's card: portrait, "Wins X" (or "No challengers"), and a summary. Returns its objects.
  private winnerCard(king: Identity, state: FieldState, size: number, y: number): Phaser.GameObjects.GameObject[] {
    const alone = state.conquests === 0;
    const pw = 512 * size * 0.62, ph = 640 * size * 0.62;
    const w = Math.max(pw + 60, 420), h = ph + 150;
    const g = this.add.graphics();
    g.fillStyle(C.navy, 0.95).fillRoundedRect(W / 2 - w / 2, y - h / 2, w, h, 18);
    g.fillStyle(king.house.color, 1).fillRoundedRect(W / 2 - w / 2, y - h / 2, w, 14, { tl: 18, tr: 18, bl: 0, br: 0 });
    g.lineStyle(4, C.gold, 1).strokeRoundedRect(W / 2 - w / 2, y - h / 2, w, h, 18);
    const full = this.textures.exists(portraitKey(king.portrait));
    const img = this.add.image(W / 2, y - h / 2 + 24 + ph / 2, full ? portraitKey(king.portrait) : avatarKey(king.portrait)).setDisplaySize(pw, full ? ph : pw);
    const name = this.add.text(W / 2, y + h / 2 - 104, displayName(king.portrait), { fontFamily: FONT, fontSize: "24px", color: css(C.cream), fontStyle: "bold" }).setOrigin(0.5);
    const head = alone ? T.noChallengers : state.payout !== null ? T.wins(money(state.payout)) : T.winsNoAmount;
    const wins = this.add.text(W / 2, y + h / 2 - 66, head, { fontFamily: FONT, fontSize: alone ? "22px" : "30px", color: css(C.gold), fontStyle: "bold" }).setOrigin(0.5);
    const sum = this.add.text(W / 2, y + h / 2 - 30, T.summary(state.conquests + 1, state.conquests), { fontFamily: FONT, fontSize: "17px", color: css(C.cream) }).setOrigin(0.5);
    return [g, img, name, wins, sum];
  }

  // No king yet: a faint keep and a card
  private drawWaiting(openingPrice: bigint): void {
    this.drawNotice(T.waitingTitle, T.waitingDetail(money(openingPrice)));
  }

  // A faint keep and a card with a title and a line under it
  private drawNotice(title: string, detail: string): void {
    const keep = this.add.image(BASE_X, BASE_Y, "keep").setOrigin(0.5, 1).setAlpha(0.3);
    keep.setScale(BUILDING.keep.height / keep.height);
    const cw = 560, ch = 140, cx = W / 2 - cw / 2, cy = 430;
    const g = this.add.graphics().setDepth(1000);
    g.fillStyle(C.navy, 0.88).fillRoundedRect(cx, cy, cw, ch, 20);
    g.lineStyle(3, C.gold, 1).strokeRoundedRect(cx, cy, cw, ch, 20);
    const t1 = this.add.text(W / 2, cy + 26, title, { fontFamily: FONT, fontSize: "32px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setDepth(1001);
    const t2 = this.add.text(W / 2, cy + 72, detail, { fontFamily: FONT, fontSize: "20px", color: css(C.gold), align: "center", wordWrap: { width: cw - 40 } })
      .setOrigin(0.5, 0).setDepth(1001);
    this.world.add([keep, g, t1, t2]);
  }

  // ---- Scenes ----

  endRun(run: Run): void {
    this.runs.delete(run);
  }

  // Phone or wide layout: on a phone the HUD moves into bands above and below the field, which keeps its size
  // and its coordinates; only its place on the canvas moves down by the top band.
  setCompact(on: boolean): void {
    if (on === this.compactOn) return;
    this.compactOn = on;
    const h = on ? H_COMPACT : H;
    this.scale.setGameSize(W, h); // FIT mode: setGameSize, not resize (that one is for the NONE mode)
    this.cameras.main.setViewport(0, on ? BAND_TOP : 0, W, H);
    this.hudCam.setSize(W, h);
    this.hud.layout(on);
  }

  // Stop every running scene and effect (a resync, a gap, or the queue was too long)
  cancelScenes(): void {
    for (const r of [...this.runs]) r.finish();
    this.unfreeze();
    const cam = this.cameras.main;
    cam.resetFX();
    cam.setZoom(1);
    for (const o of this.extras) o.destroy();
    this.extras.clear();
  }

  private run(total: number): Run {
    const r = new Run(this, total);
    this.runs.add(r);
    return r;
  }

  // A placeholder for scenes not built yet (A5b): a dev card naming the scene, with a progress bar
  playScene(label: string, ms: number): SceneRun {
    const r = this.run(ms);
    if (!import.meta.env.DEV) return { done: r.done, hurry: (t) => r.hurry(t) };
    const cw = 460, ch = 70, cx = W / 2 - cw / 2, cy = 120;
    const g = r.add(this.add.graphics());
    g.fillStyle(C.navy, 0.9).fillRoundedRect(cx, cy, cw, ch, 14).lineStyle(2, C.teal, 1).strokeRoundedRect(cx, cy, cw, ch, 14);
    const text = r.add(this.add.text(W / 2, cy + 14, label, { fontFamily: FONT, fontSize: "20px", color: css(C.cream), fontStyle: "bold" }).setOrigin(0.5, 0));
    const bar = r.add(this.add.rectangle(cx + 20, cy + ch - 18, 1, 6, C.gold).setOrigin(0, 0.5));
    r.tween({ targets: bar, width: cw - 40, duration: ms });
    return {
      done: r.done,
      hurry: (t, l) => {
        if (l) text.setText(l);
        r.hurry(t);
      },
    };
  }

  // Loose effects belong to no scene and block none (protect). They clean themselves up; cancelScenes() clears them.
  private loose(): Fx {
    return {
      add: <O extends Phaser.GameObjects.GameObject>(o: O, onTop = false): O => {
        this.extras.add(o);
        // When it goes, its tweens go too: after slow frames a tween can outlive the 4 s below, and a tween
        // writing to a destroyed object throws inside Phaser's loop
        o.once(Phaser.GameObjects.Events.DESTROY, () => {
          this.extras.delete(o);
          this.tweens.killTweensOf(o);
        });
        (onTop ? this.topLayer : this.fxLayer).add(o);
        this.time.delayedCall(4000, () => o.destroy());
        return o;
      },
      tween: (cfg) => this.tweens.add(cfg),
    };
  }

  // The first king: the castle pops up, the banner rises, coins go to the Treasury, then the "First king" card
  playOpen(p: OpenPlay): SceneRun {
    const calm = reducedMotion();
    const total = OPEN[p.mode];
    const r = this.run(total);
    this.showState(p.after, p.king, p.nextCost);
    const pop = Math.min(520, total * 0.4);
    sfx.drum();
    const b = this.building, bn = this.bannerImg;
    for (const o of this.world.getChildren()) {
      if (o === b || o === bn) continue;
      const v = o as unknown as Phaser.GameObjects.Components.Alpha;
      v.setAlpha(0);
      r.tween({ targets: o, alpha: 1, duration: pop, delay: pop * 0.35 });
    }
    if (b) {
      const sc = b.scale;
      b.setScale(sc * (calm ? 1 : 0.2)).setAlpha(0);
      r.tween({ targets: b, scale: sc, alpha: 1, duration: pop, ease: calm ? "Linear" : "Back.easeOut" });
      if (!calm) r.at(pop * 0.6, () => this.dustAt(r, BASE_X, BASE_Y, 14));
    }
    if (bn) {
      const y = bn.y;
      bn.setY(y + (calm ? 0 : BANNER_H)).setAlpha(0);
      r.tween({ targets: bn, y, alpha: 1, duration: pop * 1.3, delay: pop * 0.4, ease: "Cubic.easeOut" });
    }
    r.at(pop * 0.5, () => {
      this.loot(r, BASE_X - 40, BASE_Y - 80, true, total * 0.4);
      this.loot(r, BASE_X + 40, BASE_Y - 80, false, total * 0.4);
      this.floatTreasury(r, T.toTreasury(money(p.toTreasury)));
    });
    if (p.mode !== "quick") {
      const at = pop * 0.7;
      r.at(at, () => this.coronation(r, p.king, p.mode === "full" ? 0.72 : 0.6, total - at, calm, T.firstRuler(p.king.portrait.title)));
    }
    return { done: r.done, hurry: (ms) => r.hurry(ms) };
  }

  // A protect. Never blocks a scene: when the field is busy it only plays its effects, and the director
  // redraws the field when the scene ends. When the wall count rises, the new pieces drop in with a bounce.
  // Everything stays clear of the coronation card in the middle.
  playProtect(p: ProtectPlay): void {
    const fx = this.loose(), calm = reducedMotion();
    sfx.shield();
    if (p.idle) {
      const had = this.walls.length;
      const wasCastle = this.building?.texture.key === "castle";
      this.showState(p.after, p.king, p.nextCost);
      for (const w of this.walls.slice(had)) {
        const y = w.y;
        if (calm) {
          w.setAlpha(0);
          this.tweens.add({ targets: w, alpha: 1, duration: 300 });
          continue;
        }
        w.setY(y - 150);
        this.tweens.add({ targets: w, y, duration: 700, ease: "Bounce.easeOut", onComplete: () => this.dustAt(fx, w.x, y, 8) });
        this.time.delayedCall(260, () => sfx.drum()); // the first bounce lands about here
      }
      const b = this.building;
      if (b && !wasCastle && b.texture.key === "castle" && !calm) {
        const sc = b.scale;
        b.setScale(sc * 0.85);
        this.tweens.add({ targets: b, scale: sc, duration: 450, ease: "Back.easeOut" });
      }
    }
    // A shield ring around the castle, behind any card
    for (const [i, delay] of [0, 160].entries()) {
      const ring = fx.add(this.add.circle(BASE_X, BASE_Y - 110, 70, 0, 0).setStrokeStyle(i ? 3 : 6, p.king.house.text).setAlpha(0).setDepth(-100));
      fx.tween({ targets: ring, radius: calm ? 160 : 250, alpha: { from: 0.95, to: 0 }, duration: calm ? 500 : 900, delay, ease: "Cubic.easeOut" });
    }
    this.hud.useShield(p.after.protectsLeft);
    // Far left, clear of the face-off cards and the coronation card
    this.float(fx, `-${money(p.amount)}`, 150, BASE_Y - 170, C.cream);
    for (let i = 0; i < 3; i++) this.loot(fx, BANNER_X + 40 + i * 50, BASE_Y - 60, false, 750);
  }

  // The round is over: the bell tolls, the soldiers stand still, and the king's card glows
  playOver(p: EndPlay): SceneRun {
    const calm = reducedMotion();
    const total = OVER[p.mode];
    const r = this.run(total);
    this.hud.toll();
    this.showState(p.state, p.king, null);
    if (p.king && p.mode !== "quick") {
      const glow = r.add(this.add.image(W / 2, 360, "fx_glow").setTint(C.gold).setDisplaySize(520, 620).setAlpha(0));
      r.tween({ targets: glow, alpha: { from: 0, to: 0.9 }, duration: total * 0.3, yoyo: !calm, hold: total * 0.3 });
      const c = this.card(r, p.king, 0.62).setPosition(W / 2, 360).setAlpha(0).setScale(0.8);
      r.tween({ targets: c, alpha: 1, scale: 1, duration: total * 0.25, ease: calm ? "Linear" : "Back.easeOut" });
      r.tween({ targets: [c, glow], alpha: 0, duration: total * 0.2, delay: total * 0.8 });
    }
    return { done: r.done, hurry: (ms) => r.hurry(ms) };
  }

  // The round is settled: coins burst from the chest to the winner, then the winner's card stays on the field
  playSettle(p: EndPlay): SceneRun {
    const calm = reducedMotion();
    const total = SETTLE[p.mode];
    const r = this.run(total);
    this.showState(p.state, p.king, null);
    const card = this.world.getChildren().filter((o) => (o as unknown as Phaser.GameObjects.Components.Depth).depth === 2000);
    for (const o of card) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0);
    const n = p.mode === "full" ? 16 : p.mode === "short" ? 10 : 5;
    const to = this.toHud(W / 2, 300);
    sfx.fanfare();
    for (let i = 0; i < n; i++) {
      r.at(i * (total * 0.35 / n), () => {
        const c = this.hud.chestAt();
        this.loot(r, c.x, c.y + 20, i % 5 === 4, total * 0.35, to, true);
      });
    }
    if (!calm) r.at(total * 0.4, () => this.dustAt(r, W / 2, 300, 12, "fx_spark"));
    r.at(total * 0.45, () => {
      for (const o of card) r.tween({ targets: o, alpha: 1, duration: total * 0.25 });
    });
    return { done: r.done, hurry: (ms) => r.hurry(ms) };
  }

  // A puff of dust (or sparks) at a spot
  private dustAt(fx: Fx, x: number, y: number, count: number, key = "fx_dust"): void {
    const e = fx.add(this.add.particles(x, y, key, {
      speed: { min: 30, max: 120 }, angle: { min: 190, max: 350 }, lifespan: { min: 400, max: 700 },
      scale: { start: 0.5, end: 1.1 }, alpha: { start: 0.6, end: 0 }, emitting: false,
    }));
    e.explode(count);
  }

  // The conquest: face-off cards, the army marching in, the clash, loot to the Treasury, the new king crowned.
  // With reduced motion it keeps its length but uses the calm quick parts: no march, shake, zoom, spin or dust.
  playConquest(p: ConquestPlay): SceneRun {
    const quiet = reducedMotion();
    const look: Mode = quiet ? "quick" : p.mode;
    const len = CONQUEST[look];
    const total = conquestLength(p.mode);
    const r = this.run(total);
    const k = total / conquestLength(look); // stretch the calm version to the same length
    const t1 = len.faceoff * k, t2 = t1 + len.march * k, t3 = t2 + len.clash * k;
    const dir = p.side === "left" ? 1 : -1;
    const army: Marcher[] = [];
    const rand = rng(p.after.conquests * 31 + (p.side === "left" ? 1 : 2));
    const dust = quiet ? null : r.add(this.add.particles(0, 0, "fx_dust", {
      speed: { min: 10, max: 40 }, angle: { min: 200, max: 340 }, lifespan: { min: 380, max: 620 },
      scale: { start: 0.35, end: 0.9 }, alpha: { start: 0.55, end: 0 }, emitting: false,
    }));
    // The battle song plays while the challenger attacks, and gives way to the fanfare at the coronation.
    // A quick conquest is too short for it: a drum instead.
    if (p.mode === "quick") sfx.drum();
    else {
      const stopSong = sfx.battle();
      r.onEnd(stopSong);
      r.at(t3, stopSong);
    }

    // 1. Face-off: the challenger's card on the army's side, the old king's on the other, VS between
    if (len.faceoff > 0 && p.oldKing) {
      const d = len.faceoff * k;
      const y = 330, cx = W / 2 - dir * 250, ox = W / 2 + dir * 250;
      const challenger = this.card(r, p.newKing, 0.62).setPosition(cx - dir * 700, y);
      const defender = this.card(r, p.oldKing, 0.62).setPosition(ox + dir * 700, y);
      r.tween({ targets: challenger, x: cx, duration: d * 0.3, ease: "Back.easeOut" });
      r.tween({ targets: defender, x: ox, duration: d * 0.3, ease: "Back.easeOut" });
      const vs = r.add(this.add.text(W / 2, y, T.vs, { fontFamily: FONT, fontSize: "88px", color: css(C.gold), fontStyle: "bold" })
        .setOrigin(0.5).setStroke(css(C.navy), 10).setScale(0));
      r.at(d * 0.25, () => r.tween({ targets: vs, scale: 1, duration: d * 0.2, ease: "Back.easeOut" }));
      r.at(d * 0.8, () => r.tween({ targets: [challenger, defender, vs], alpha: 0, duration: d * 0.2 }));
    }

    // 2. The army marches in along the road, each soldier at their own pace, the leader in front.
    // At the end they spread into a wide front. The amount paid floats up where they enter.
    const path = ROAD[p.side];
    const end = path[path.length - 1];
    const count = look === "full" ? 7 : look === "short" ? 5 : 0;
    if (count > 0) {
      r.at(t1, () => {
        const d = len.march * k;
        this.float(r, T.paid(money(p.paid)), p.side === "left" ? 170 : W - 170, 370, p.newKing.house.text);
        for (let i = 0; i < count; i++) {
          const leader = i === 0;
          // The front line spreads up and down the field from the road's end; the rest stand a step behind
          const line = leader ? 0 : i <= 4 ? 1 : 2;
          const slot = leader ? 0 : ((i - 1) % 4) - 1.5;
          const spot: [number, number] = [
            end[0] + dir * (leader ? 26 : 0) - dir * Math.max(0, line - 1) * 64 - dir * Math.abs(slot) * 10,
            end[1] + slot * 44 + (line === 2 ? 22 : 0),
          ];
          const jitter = (rand() - 0.5) * 24;
          const route = [...path.slice(0, -1).map(([x, y]): [number, number] => [x, y + jitter]), spot];
          const img = r.add(this.soldier(route[0][0], route[0][1], p.newKing.house, rand, dir > 0));
          if (leader) img.setScale(img.scale * 1.08);
          const m: Marcher = { img, base: img.scale, x: spot[0], y: spot[1] };
          army.push(m);
          const delay = leader ? 0 : d * (0.04 + rand() * 0.2);
          const dur = Math.min(d * 0.92 - delay, d * (leader ? 0.6 : 0.55 + rand() * 0.25));
          const steps = 6 + Math.floor(rand() * 3);
          const pos = { p: 0 };
          let lastStep = -1;
          r.tween({
            targets: pos, p: 1, duration: dur, delay, ease: "Sine.easeOut",
            onUpdate: () => {
              const [x, y] = along(route, pos.p);
              const b = Math.abs(Math.sin(pos.p * steps * Math.PI)); // 0 on a footfall, 1 mid-stride
              img.setPosition(x, y - b * 6).setScale(m.base * (1 - 0.04 * b), m.base * (1 + 0.06 * b)); // stretch in the air
              const step = Math.floor(pos.p * steps);
              if (step !== lastStep) {
                lastStep = step;
                dust?.emitParticleAt(x, y, 1);
              }
            },
            onComplete: () => {
              // Stopping: squash, then settle
              img.setPosition(spot[0], spot[1]);
              r.tween({ targets: img, scaleX: m.base * 1.12, scaleY: m.base * 0.86, duration: 90, yoyo: true, ease: "Quad.easeOut" });
              dust?.emitParticleAt(spot[0], spot[1], 4);
            },
          });
        }
      });
    }

    // 3. The clash. A beat of anticipation (lean back, crouch), then the lunge: a hit pause on the first impact,
    // a punch-in, slashes and sparks. The nearest defenders spin back and puff away, dropping coins and gems.
    r.at(t2, () => {
      const d = len.clash * k;
      const beat = d * 0.16;
      const dist = (s: Soldier) => Math.abs(s.x - end[0]) + Math.abs(s.y - end[1]);
      const fallen = this.garrison.filter((s) => !s.post).sort((a, b) => dist(a) - dist(b)).slice(0, look === "quick" ? 2 : 4);
      if (!quiet) {
        for (const m of army) {
          r.tween({ targets: m.img, x: m.x - dir * 12, scaleX: m.base * 1.06, scaleY: m.base * 0.92, duration: beat, ease: "Quad.easeOut" });
        }
        for (const s of fallen) r.tween({ targets: s.img, y: s.img.y - 5, duration: beat, ease: "Quad.easeOut" });
      }
      // Two lunges: forward fast, back slower
      for (const at of [beat, d * 0.5]) {
        r.at(t2 + at, () => {
          for (const m of army) {
            r.tween({ targets: m.img, x: m.x + dir * 30, scaleX: m.base * 0.96, scaleY: m.base * 1.05, duration: d * 0.07, ease: "Quad.easeIn" });
            r.tween({ targets: m.img, x: m.x, scaleX: m.base, scaleY: m.base, duration: d * 0.14, delay: d * 0.08, ease: "Quad.easeOut" });
          }
        });
      }
      r.at(t2 + beat, () => {
        sfx.drum();
        if (quiet) return;
        this.freeze(60);
        this.punch(1.05, d * 0.5);
        this.cameras.main.shake(Math.min(200, d * 0.2), 0.004);
      });
      fallen.forEach((s, i) => {
        const foe = army[i % Math.max(1, army.length)];
        const mx = foe ? (foe.x + dir * 30 + s.x) / 2 : s.x - dir * 30, my = (foe ? (foe.y + s.y) / 2 : s.y) - SOLDIER_H * 0.45;
        r.at(t2 + beat + d * (0.02 + i * 0.13), () => this.slash(r, mx, my, quiet));
        r.at(t2 + beat + d * (0.08 + i * 0.12), () => {
          this.loot(r, s.img.x, s.img.y - 30, i === 0, d * 0.5);
          this.defeat(r, s, dir, d * 0.4, quiet, dust);
        });
      });
      if (fallen.length === 0) r.at(t2 + beat, () => this.slash(r, BASE_X, BASE_Y - 40, quiet));
      r.at(t2 + d * 0.6, () => {
        if (p.oldKing && p.refunded > 0n) this.float(r, T.refunded(money(p.refunded)), p.side === "left" ? W - 320 : 320, 300, p.oldKing.house.text);
        this.floatTreasury(r, T.toTreasury(money(p.toTreasury)));
      });
    });

    // 4. The new king: the field takes the new house (banner, flags, garrison) with a glow and a punch-in,
    // then the coronation card
    r.at(t3, () => {
      const d = len.crown * k;
      for (const m of army) r.tween({ targets: m.img, alpha: 0, duration: d * 0.2 });
      this.showState(p.after, p.newKing, p.nextCost);
      for (const [x, y] of this.flagSpots) {
        const glow = r.add(this.add.image(x, y, "fx_glow").setTint(p.newKing.house.text).setScale(0.2).setAlpha(0.9));
        r.tween({ targets: glow, scale: 1.1, alpha: 0, duration: d * 0.5, ease: "Cubic.easeOut" });
      }
      if (!quiet) this.punch(1.03, d * 0.7);
      this.coronation(r, p.newKing, look === "quick" ? 0.5 : 0.72, d, quiet);
    });

    return { done: r.done, hurry: (ms) => r.hurry(ms) };
  }

  // A defender knocked back: a spin and a hop backwards, then a puff of dust. The calm version fades.
  private defeat(r: Run, s: Soldier, dir: number, d: number, quiet: boolean, dust: Phaser.GameObjects.Particles.ParticleEmitter | null): void {
    const img = s.img;
    this.tweens.killTweensOf(img); // stop its idle bob
    sfx.whoosh();
    if (quiet) {
      r.tween({ targets: img, alpha: 0, duration: d });
      return;
    }
    const x0 = img.x, y0 = img.y, hop = { t: 0 };
    r.tween({
      targets: hop, t: 1, duration: d * 0.75, ease: "Quad.easeOut",
      onUpdate: () => img.setPosition(x0 + dir * 70 * hop.t, y0 - Math.sin(hop.t * Math.PI) * 40).setAngle(dir * 360 * hop.t),
      onComplete: () => {
        dust?.emitParticleAt(img.x, img.y - 20, 10);
        const pop = r.add(this.add.image(img.x, img.y - 30, "fx_glow").setScale(0.3).setAlpha(0.8));
        r.tween({ targets: pop, scale: 0.9, alpha: 0, duration: 260 });
        img.setVisible(false);
      },
    });
    r.tween({ targets: img, scale: img.scale * 0.7, duration: d * 0.75 });
  }

  // Hit pause: the scene's clocks stop for a moment of real time
  private freeze(ms: number): void {
    this.time.timeScale = 0;
    this.tweens.timeScale = 0;
    window.setTimeout(() => this.unfreeze(), ms);
  }
  private unfreeze(): void {
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
  }

  // A small zoom into the field and back; the HUD camera does not move
  private punch(zoom: number, ms: number): void {
    const cam = this.cameras.main;
    cam.zoomTo(zoom, ms * 0.25, "Sine.easeOut", true, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      if (progress === 1) cam.zoomTo(1, ms * 0.75, "Sine.easeInOut", true);
    });
  }

  // A king's card: the portrait in a frame of the house colour, the name below. Origin at the centre.
  private card(r: Run, who: Identity, size: number): Phaser.GameObjects.Container {
    const pw = 512 * size * 0.62, ph = 640 * size * 0.62, pad = 10, nameH = 48;
    const w = pw + pad * 2, h = ph + pad * 2 + nameH;
    const g = this.add.graphics();
    g.fillStyle(C.navy, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.fillStyle(who.house.color, 1).fillRoundedRect(-w / 2, -h / 2, w, 14, { tl: 16, tr: 16, bl: 0, br: 0 });
    g.lineStyle(4, who.house.text, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    // The full portrait once it has loaded, the round avatar before that
    const full = this.textures.exists(portraitKey(who.portrait));
    const img = this.add.image(0, -h / 2 + pad + ph / 2 + 4, full ? portraitKey(who.portrait) : avatarKey(who.portrait)).setDisplaySize(pw, full ? ph : pw);
    const name = this.add.text(0, h / 2 - nameH / 2 - 4, displayName(who.portrait), { fontFamily: FONT, fontSize: "24px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5);
    return r.add(this.add.container(0, 0, [g, img, name]));
  }

  private coronation(r: Run, who: Identity, size: number, d: number, quiet: boolean, title = T.newRuler(who.portrait.title)): void {
    const y = 380, cardH = 640 * size * 0.62 + 68;
    sfx.fanfare();
    // Gold rays, wide enough to show around the card on any sky
    const rays = r.add(this.add.image(W / 2, y, "fx_rays").setTint(0xffd75a).setAlpha(0).setScale(size * 2));
    r.tween({ targets: rays, alpha: 1, duration: d * 0.2 });
    if (!quiet) r.tween({ targets: rays, angle: 40, duration: d });
    const c = this.card(r, who, size).setPosition(W / 2, y).setScale(0.6).setAlpha(0);
    r.tween({ targets: c, scale: 1, alpha: 1, duration: d * 0.25, ease: "Back.easeOut" });
    const crownY = y - cardH / 2 - 8;
    const crown = r.add(this.add.image(W / 2, crownY - 110, "crown").setDisplaySize(84, 59).setAlpha(0));
    r.tween({ targets: crown, y: crownY, alpha: 1, duration: d * 0.3, delay: d * 0.12, ease: quiet ? "Linear" : "Bounce.easeOut" });
    const label = r.add(this.add.text(W / 2, y + cardH / 2 + 28, title, { fontFamily: FONT, fontSize: "40px", color: css(C.gold), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 8).setAlpha(0));
    r.tween({ targets: label, alpha: 1, duration: d * 0.2, delay: d * 0.2 });
    r.tween({ targets: [rays, c, crown, label], alpha: 0, duration: d * 0.18, delay: d * 0.82 });
  }

  private slash(r: Run, x: number, y: number, quiet: boolean): void {
    sfx.clash();
    // A dark shadow under a bright stroke, so the slash reads on grass and sky alike
    const angle = -30 + Math.random() * 60;
    const shadow = r.add(this.add.image(x + 3, y + 4, "fx_slash").setAngle(angle).setScale(0.5).setTint(C.navy).setAlpha(0.6));
    const s = r.add(this.add.image(x, y, "fx_slash").setAngle(angle).setScale(0.5));
    r.tween({ targets: [s, shadow], scale: 1.5, duration: 300, ease: "Cubic.easeOut" });
    r.tween({ targets: [s, shadow], alpha: 0, duration: 200, delay: 160 });
    if (quiet) return;
    const sparks = r.add(this.add.particles(x, y, "fx_spark", {
      speed: { min: 140, max: 360 }, lifespan: 420, scale: { start: 1.3, end: 0 }, gravityY: 600, tint: [0xffd75a, 0xffffff, 0xffa040], emitting: false,
    }));
    sparks.explode(18);
  }

  // A point on the field in the HUD camera's coordinates (on a phone the field sits below the top band)
  private toHud(x: number, y: number): Pt {
    return { x, y: y + this.hud.fieldTop };
  }

  // Coins (and a gem) burst from a spot on the field and fly in an arc to the Treasury chest (or to `to`, in HUD
  // coordinates). They fly over the HUD, so they are drawn by the HUD camera.
  private loot(r: Fx, x: number, y: number, gem: boolean, d: number, to: Pt | null = null, fromHud = false): void {
    const from = fromHud ? { x, y } : this.toHud(x, y);
    const end = to ?? this.hud.chestAt();
    const items = gem ? ["coin", "coin", "gem"] : ["coin", "coin"];
    items.forEach((key, i) => {
      const img = r.add(this.add.image(from.x, from.y, key).setDisplaySize(key === "gem" ? 30 : 26, 26), true);
      const pos = { t: 0 };
      const cx = (from.x + end.x) / 2 + (Math.random() - 0.5) * 120, cy = Math.min(from.y, end.y) - 60 - Math.random() * 60;
      r.tween({
        targets: pos, t: 1, duration: d, delay: i * 70, ease: "Sine.easeIn",
        onUpdate: () => {
          const t = pos.t, u = 1 - t;
          img.setPosition(u * u * from.x + 2 * u * t * cx + t * t * end.x, u * u * from.y + 2 * u * t * cy + t * t * end.y);
        },
        onComplete: () => {
          img.setVisible(false);
          if (!to) this.hud.bumpChest();
          else sfx.coin();
        },
      });
    });
  }

  // A number that rises and fades, at a spot on the field
  private float(r: Fx, text: string, x: number, y: number, color: number): void {
    this.floatAt(r, text, this.toHud(x, y), color);
  }

  // "+X to the Treasury", next to the chest wherever the HUD put it
  private floatTreasury(r: Fx, text: string): void {
    const c = this.hud.chestAt();
    const p = this.hud.fieldTop === 0 ? { x: Math.min(c.x + 34, W - 170), y: c.y + 108 } : { x: c.x + 60, y: c.y - 120 };
    this.floatAt(r, text, p, C.gold);
  }

  private floatAt(r: Fx, text: string, p: Pt, color: number): void {
    const t = r.add(this.add.text(p.x, p.y, text, { fontFamily: FONT, fontSize: "28px", color: css(color), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 8).setShadow(0, 3, "#000000", 6, true, true).setScale(this.hud.fieldTop === 0 ? 1 : 1.6), true);
    r.tween({ targets: t, y: p.y - 50, duration: 1100, ease: "Sine.easeOut" });
    r.tween({ targets: t, alpha: 0, duration: 300, delay: 900 });
  }

  // Everything drawn: the field's, the scenes' and the HUD's objects (dev panel)
  objectCount(): number {
    const layers = new Set<unknown>([this.world, this.fxLayer, this.topLayer]);
    const loose = this.children.list.filter((o) => !layers.has(o)).length;
    return loose + this.world.getChildren().length + this.fxLayer.getChildren().length + this.topLayer.getChildren().length;
  }

  // Dev stress test: n more bobbing soldiers in loose rows on the field; the next redraw removes them
  stress(n: number): void {
    const house = HOUSE_FOR_STRESS;
    const rand = rng(n);
    for (let i = 0; i < n; i++) {
      const x = 120 + (i % 10) * 104, y = 470 + Math.floor(i / 10) * 44;
      const img = this.soldier(x, y, house, rand, i % 2 === 0);
      this.world.add(img);
      this.tweens.add({ targets: img, y: y - 3, duration: 700 + rand() * 300, delay: rand() * 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  // ---- Sky ----

  // Crossfade the sky. Instant with reduced motion, or when the dusk image is not loaded yet.
  setDusk(on: boolean, ms = 2000): void {
    this.duskWanted = on;
    const d = this.dusk;
    if (!d) return;
    this.tweens.killTweensOf(d);
    const alpha = on ? 1 : 0;
    if (reducedMotion() || ms <= 0) d.setAlpha(alpha);
    else this.tweens.add({ targets: d, alpha, duration: ms, ease: "Sine.easeInOut" });
  }

  // A paused clock also holds the sky where it is
  freezeSky(on: boolean): void {
    if (!this.dusk || on === this.skyFrozen) return;
    this.skyFrozen = on;
    for (const t of this.tweens.getTweensOf(this.dusk)) {
      if (on) t.pause();
      else t.resume();
    }
  }

  get isDusk(): boolean {
    return this.duskWanted;
  }

  private points(flat: number[]): Phaser.Math.Vector2[] {
    const out: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
    return out;
  }

  // Scale a background so it fills the game, cropping the overflow
  private cover(img: Phaser.GameObjects.Image): Phaser.GameObjects.Image {
    return img.setScale(Math.max(W / img.width, H / img.height));
  }
}
