// The battlefield scene: the field (day, dusk on top), the kingdom in the clearing, the HUD, and the scenes.
import * as Phaser from "phaser";
import { avatarKey, bannerKey, loadFirst, loadLater, makeBanners, makeFxTextures, portraitKey, portraitsOf } from "./assets.ts";
import type { FieldState } from "./director.ts";
import { C, css, FONT, H, Hud, HUD_DEPTH, money, W } from "./hud.ts";
import { displayName } from "./identity.ts";
import type { House, Identity, Portrait } from "./identity.ts";
import { COPY } from "../copy.ts";

const T = COPY.battlefield;
export type SceneRun = { done: Promise<void>; hurry: (totalMs: number, label?: string) => void };
export type Mode = "full" | "short" | "quick";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
const TREASURY_AT = { x: W - 12 - 240 + 48, y: 52 }; // the chest in the HUD

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
export const conquestLength = (m: Mode) => {
  const c = CONQUEST[m];
  return c.faceoff + c.march + c.clash + c.crown;
};

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

// One running scene: its objects, tweens and timers, all on a shared clock that hurry() can speed up.
// Times given to at() and tween durations are in scene time; the speed maps them to real time.
class Run {
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
    if (onTop) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(HUD_DEPTH + 10);
    else this.sc.fxLayer.add(o);
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

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.master.remove();
    for (const e of this.timers) e.remove();
    for (const t of this.tweens) t.remove();
    for (const o of this.objs) o.destroy();
    this.sc.endRun(this);
    this.resolve();
  }
}

type Soldier = { img: Phaser.GameObjects.Image; x: number; y: number; post: boolean }; // post: a guard or the bearer

export class BattlefieldScene extends Phaser.Scene {
  hud!: Hud;
  portraits: Portrait[] = [];
  fxLayer!: Phaser.GameObjects.Layer; // scene effects, over the kingdom and under the HUD
  private world!: Phaser.GameObjects.Layer; // the kingdom
  private garrison: Soldier[] = [];
  private flagSpots: [number, number][] = []; // castle flags and the banner, for the banner change glow
  private dusk: Phaser.GameObjects.Image | null = null;
  private duskWanted = false;
  private onReady: () => void;
  private runs = new Set<Run>();
  private extras = new Set<Phaser.GameObjects.GameObject>(); // loose effects (protect flashes)

  constructor(onReady: () => void) {
    super("battlefield");
    this.onReady = onReady;
  }

  preload(): void {
    loadFirst(this.load);
  }

  create(): void {
    this.cover(this.add.image(W / 2, H / 2, "field_day")).setDepth(-2);
    makeBanners(this);
    makeFxTextures(this);
    this.portraits = portraitsOf(this);
    this.world = this.add.layer();
    this.fxLayer = this.add.layer().setDepth(HUD_DEPTH - 1);
    this.hud = new Hud(this);
    this.onReady();

    // The dusk field and the portraits come after the first frame
    this.events.once(Phaser.Scenes.Events.RENDER, () =>
      loadLater(this, () => {
        this.dusk = this.cover(this.add.image(W / 2, H / 2, "field_dusk")).setAlpha(this.duskWanted ? 1 : 0).setDepth(-1);
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
    if (state.status === "waiting" || !king) {
      this.drawWaiting(state.openingPrice);
      return;
    }
    const kind = state.value >= CASTLE_FROM ? "castle" : "keep";
    const half = this.drawBuilding(kind, king.house);
    this.drawWalls(wallPieces(state.value), half);
    this.drawBanner(king.house);
    this.drawGarrison(garrisonSize(state.value), king.house, half);
  }

  private drawBuilding(kind: keyof typeof BUILDING, house: House): number {
    const spec = BUILDING[kind];
    const img = this.add.image(BASE_X, BASE_Y, kind).setOrigin(0.5, 1);
    const scale = spec.height / img.height;
    img.setScale(scale).setDepth(BASE_Y);
    this.world.add(img);
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
    }
  }

  // The house banner stands on the ground in front of the left wall, its top below the wall's foot
  private drawBanner(house: House): void {
    const img = this.add.image(BANNER_X, BASE_Y + BANNER_H + 6, bannerKey(house.id)).setOrigin(0.5, 1);
    img.setScale(BANNER_H / img.height).setDepth(img.y);
    this.world.add(img);
    this.flagSpots.push([BANNER_X, img.y - BANNER_H * 0.6]);
  }

  private soldier(x: number, y: number, house: House, rand: () => number, faceRight: boolean): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, house.soldier).setOrigin(0.5, 1);
    return img.setScale((SOLDIER_H / img.height) * (0.92 + rand() * 0.16)).setDepth(y).setFlipX(!faceRight);
  }

  // Two guards beside the gate door, a standard-bearer with the house banner, the rest in loose rows in front.
  // A corridor in front of the door stays clear.
  private drawGarrison(n: number, house: House, half: number): void {
    const rand = rng(n * 7919 + house.id.length);
    const still = reducedMotion();
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

  // No king yet: a faint keep and a card
  private drawWaiting(openingPrice: bigint): void {
    const keep = this.add.image(BASE_X, BASE_Y, "keep").setOrigin(0.5, 1).setAlpha(0.3);
    keep.setScale(BUILDING.keep.height / keep.height);
    const cw = 520, ch = 112, cx = W / 2 - cw / 2, cy = 440;
    const g = this.add.graphics().setDepth(1000);
    g.fillStyle(C.navy, 0.88).fillRoundedRect(cx, cy, cw, ch, 20);
    g.lineStyle(3, C.gold, 1).strokeRoundedRect(cx, cy, cw, ch, 20);
    const t1 = this.add.text(W / 2, cy + 26, T.waitingTitle, { fontFamily: FONT, fontSize: "32px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setDepth(1001);
    const t2 = this.add.text(W / 2, cy + 72, T.waitingDetail(money(openingPrice)), { fontFamily: FONT, fontSize: "20px", color: css(C.gold) })
      .setOrigin(0.5, 0).setDepth(1001);
    this.world.add([keep, g, t1, t2]);
  }

  // ---- Scenes ----

  endRun(run: Run): void {
    this.runs.delete(run);
  }

  // Stop every running scene and effect (a resync, a gap, or the queue was too long)
  cancelScenes(): void {
    for (const r of [...this.runs]) r.finish();
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

  // A short effect that never blocks other scenes (protect). A5b gives it the wall drop and shield ring.
  flash(text: string, color = C.gold): void {
    const t = this.add.text(BASE_X, BASE_Y - 160, text, { fontFamily: FONT, fontSize: "30px", color: css(color), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 6);
    this.fxLayer.add(t);
    this.extras.add(t);
    this.tweens.add({
      targets: t, y: t.y - 60, alpha: 0, duration: reducedMotion() ? 600 : 1200,
      onComplete: () => {
        this.extras.delete(t);
        t.destroy();
      },
    });
  }

  // The conquest: face-off cards, the army marching in, the clash, loot to the Treasury, the new king crowned.
  // With reduced motion it keeps its length but uses the calm quick parts (no march, no shake, no sparks).
  playConquest(p: ConquestPlay): SceneRun {
    const quiet = reducedMotion();
    const look: Mode = quiet ? "quick" : p.mode;
    const len = CONQUEST[look];
    const total = conquestLength(p.mode);
    const r = this.run(total);
    const k = total / conquestLength(look); // stretch the calm version to the same length
    const t1 = len.faceoff * k, t2 = t1 + len.march * k, t3 = t2 + len.clash * k;
    const dir = p.side === "left" ? 1 : -1;
    const army: Phaser.GameObjects.Image[] = [];

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

    // 2. The army marches in along the road; the amount paid floats up where it enters
    const path = ROAD[p.side];
    const end = path[path.length - 1];
    const count = look === "full" ? 7 : look === "short" ? 5 : 0;
    const rand = rng(p.after.conquests * 31 + count);
    if (count > 0) {
      r.at(t1, () => {
        const d = len.march * k;
        this.float(r, T.paid(money(p.paid)), p.side === "left" ? 170 : W - 170, 370, p.newKing.house.text);
        for (let i = 0; i < count; i++) {
          const spot: [number, number] = [end[0] - dir * ((i % 4) * 58 + 10), end[1] - 30 + Math.floor(i / 4) * 46 + (i % 2) * 10];
          const route = [...path.slice(0, -1), spot];
          const img = r.add(this.soldier(route[0][0], route[0][1], p.newKing.house, rand, dir > 0));
          army.push(img);
          const pos = { p: 0 };
          r.tween({
            targets: pos, p: 1, duration: d * 0.75, delay: i * d * 0.035, ease: "Sine.easeOut",
            onUpdate: () => {
              const [x, y] = along(route, pos.p);
              img.setPosition(x, y - Math.abs(Math.sin(pos.p * 14)) * 6); // a marching bounce
            },
          });
        }
      });
    }

    // 3. The clash: slashes and sparks where the lines meet; the nearest defenders fall and drop coins and gems
    r.at(t2, () => {
      const d = len.clash * k;
      const dist = (s: Soldier) => Math.abs(s.x - end[0]) + Math.abs(s.y - end[1]);
      const fallen = this.garrison.filter((s) => !s.post).sort((a, b) => dist(a) - dist(b)).slice(0, look === "quick" ? 2 : 4);
      if (!quiet) this.cameras.main.shake(Math.min(220, d * 0.25), 0.004);
      fallen.forEach((s, i) => {
        const foe = army[i % Math.max(1, army.length)];
        const mx = foe ? (foe.x + s.x) / 2 : s.x - dir * 30, my = (foe ? (foe.y + s.y) / 2 : s.y) - SOLDIER_H * 0.45;
        if (foe) r.tween({ targets: foe, x: foe.x + dir * 22, duration: d * 0.12, yoyo: true, repeat: 1 });
        r.at(t2 + d * (0.08 + i * 0.14), () => this.slash(r, mx, my, quiet));
        r.at(t2 + d * (0.3 + i * 0.12), () => {
          r.tween({ targets: s.img, angle: dir * 80, y: s.img.y + 10, alpha: 0.35, duration: d * 0.22 });
          this.loot(r, s.img.x, s.img.y - 30, i === 0, d * 0.5);
        });
      });
      if (fallen.length === 0) r.at(t2 + d * 0.2, () => this.slash(r, BASE_X, BASE_Y - 40, quiet));
      r.at(t2 + d * 0.55, () => {
        if (p.oldKing && p.refunded > 0n) this.float(r, T.refunded(money(p.refunded)), p.side === "left" ? W - 320 : 320, 300, p.oldKing.house.text);
        this.float(r, T.toTreasury(money(p.toTreasury)), W - 170, 160, C.gold);
      });
    });

    // 4. The new king: the field takes the new house (banner, flags, garrison) with a glow, then the coronation card
    r.at(t3, () => {
      const d = len.crown * k;
      for (const a of army) r.tween({ targets: a, alpha: 0, duration: d * 0.2 });
      this.showState(p.after, p.newKing, p.nextCost);
      for (const [x, y] of this.flagSpots) {
        const glow = r.add(this.add.image(x, y, "fx_glow").setTint(p.newKing.house.text).setScale(0.2).setAlpha(0.9));
        r.tween({ targets: glow, scale: 1.1, alpha: 0, duration: d * 0.5, ease: "Cubic.easeOut" });
      }
      this.coronation(r, p.newKing, look === "quick" ? 0.5 : 0.78, d, quiet);
    });

    return { done: r.done, hurry: (ms) => r.hurry(ms) };
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

  private coronation(r: Run, who: Identity, size: number, d: number, quiet: boolean): void {
    const y = 330, cardH = 640 * size * 0.62 + 68;
    const rays = r.add(this.add.image(W / 2, y, "fx_rays").setTint(who.house.text).setAlpha(0).setScale(0.9));
    r.tween({ targets: rays, alpha: 0.85, duration: d * 0.2 });
    if (!quiet) r.tween({ targets: rays, angle: 40, duration: d });
    const c = this.card(r, who, size).setPosition(W / 2, y).setScale(0.6).setAlpha(0);
    r.tween({ targets: c, scale: 1, alpha: 1, duration: d * 0.25, ease: "Back.easeOut" });
    const crownY = y - cardH / 2 - 8;
    const crown = r.add(this.add.image(W / 2, crownY - 110, "crown").setDisplaySize(84, 59).setAlpha(0));
    r.tween({ targets: crown, y: crownY, alpha: 1, duration: d * 0.3, delay: d * 0.12, ease: quiet ? "Linear" : "Bounce.easeOut" });
    const title = r.add(this.add.text(W / 2, y + cardH / 2 + 28, T.newRuler(who.portrait.title), { fontFamily: FONT, fontSize: "40px", color: css(C.gold), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 8).setAlpha(0));
    r.tween({ targets: title, alpha: 1, duration: d * 0.2, delay: d * 0.2 });
    r.tween({ targets: [rays, c, crown, title], alpha: 0, duration: d * 0.18, delay: d * 0.82 });
  }

  private slash(r: Run, x: number, y: number, quiet: boolean): void {
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

  // Coins (and a gem) burst from a fallen soldier and fly in an arc to the Treasury chest
  private loot(r: Run, x: number, y: number, gem: boolean, d: number): void {
    const items = gem ? ["coin", "coin", "gem"] : ["coin", "coin"];
    items.forEach((key, i) => {
      const img = r.add(this.add.image(x, y, key).setDisplaySize(key === "gem" ? 30 : 26, 26), true);
      const pos = { t: 0 };
      const cx = (x + TREASURY_AT.x) / 2 + (Math.random() - 0.5) * 120, cy = Math.min(y, TREASURY_AT.y) - 60 - Math.random() * 60;
      r.tween({
        targets: pos, t: 1, duration: d, delay: i * 70, ease: "Sine.easeIn",
        onUpdate: () => {
          const t = pos.t, u = 1 - t;
          img.setPosition(u * u * x + 2 * u * t * cx + t * t * TREASURY_AT.x, u * u * y + 2 * u * t * cy + t * t * TREASURY_AT.y);
        },
        onComplete: () => {
          img.setVisible(false);
          this.hud.bumpChest();
        },
      });
    });
  }

  // A number that rises and fades
  private float(r: Run, text: string, x: number, y: number, color: number): void {
    const t = r.add(this.add.text(x, y, text, { fontFamily: FONT, fontSize: "28px", color: css(color), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 8).setShadow(0, 3, "#000000", 6, true, true), true);
    r.tween({ targets: t, y: y - 50, duration: 1100, ease: "Sine.easeOut" });
    r.tween({ targets: t, alpha: 0, duration: 300, delay: 900 });
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
