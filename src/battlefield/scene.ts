// The battlefield scene: the field (day, dusk on top), the kingdom in the clearing, and the HUD.
import * as Phaser from "phaser";
import { bannerKey, loadFirst, loadLater, makeBanners, portraitsOf } from "./assets.ts";
import type { FieldState } from "./director.ts";
import { C, css, FONT, H, Hud, HUD_DEPTH, money, W } from "./hud.ts";
import type { House, Identity, Portrait } from "./identity.ts";
import { COPY } from "../copy.ts";

export type SceneRun = { done: Promise<void>; hurry: (totalMs: number, label?: string) => void };

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
const BANNER_H = 88;
// The garrison: loose rows in front of the castle, between the banner and the price panel
const RANKS: [number, number[]][] = [
  [520, [640, 740, 540, 840, 490, 940]],
  [572, [590, 690, 790, 490, 890, 990]],
  [626, [640, 740, 540, 840, 440, 940, 340]],
]; // [base y, x positions from the middle out]

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

export class BattlefieldScene extends Phaser.Scene {
  hud!: Hud;
  portraits: Portrait[] = [];
  private world!: Phaser.GameObjects.Layer; // the kingdom, under the HUD
  private fx!: Phaser.GameObjects.Layer; // scene effects, cleared by cancelScenes()
  private dusk: Phaser.GameObjects.Image | null = null;
  private duskWanted = false;
  private onReady: () => void;
  private pending = new Set<() => void>(); // resolvers of running scenes

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
    this.portraits = portraitsOf(this);
    this.world = this.add.layer();
    this.fx = this.add.layer().setDepth(HUD_DEPTH - 1);
    this.hud = new Hud(this);
    this.onReady();

    // The dusk field comes after the first frame, underneath everything else
    this.events.once(Phaser.Scenes.Events.RENDER, () =>
      loadLater(this, () => {
        this.dusk = this.cover(this.add.image(W / 2, H / 2, "field_dusk")).setAlpha(this.duskWanted ? 1 : 0).setDepth(-1);
      }),
    );
  }

  // Draw the kingdom and the HUD for this state at once. king: who holds the throne, or null.
  showState(state: FieldState, king: Identity | null, nextCost: bigint | null): void {
    this.hud.show(state, king, nextCost);
    const w = this.world;
    this.tweens.killTweensOf(w.getChildren());
    w.removeAll(true);
    if (state.status === "waiting" || !king) {
      this.drawWaiting(state.openingPrice);
      return;
    }
    const kind = state.value >= CASTLE_FROM ? "castle" : "keep";
    const half = this.drawBuilding(kind, king.house);
    this.drawWalls(wallPieces(state.value), half);
    this.drawBanner(king.house, half);
    this.drawGarrison(garrisonSize(state.value), king.house, half);
  }

  // A timed scene. A4: a dev placeholder card naming the scene; A5 replaces it with the real animation.
  // done resolves when it ends, or at once when cancelScenes() runs. hurry() shortens it to a new total length.
  playScene(label: string, ms: number): SceneRun {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const cw = 460, ch = 70, cx = W / 2 - cw / 2, cy = 120;
    let text: Phaser.GameObjects.Text | null = null, bar: Phaser.GameObjects.Rectangle | null = null;
    if (import.meta.env.DEV) {
      const g = this.add.graphics();
      g.fillStyle(C.navy, 0.9).fillRoundedRect(cx, cy, cw, ch, 14).lineStyle(2, C.teal, 1).strokeRoundedRect(cx, cy, cw, ch, 14);
      text = this.add.text(W / 2, cy + 14, label, { fontFamily: FONT, fontSize: "20px", color: css(C.cream), fontStyle: "bold" }).setOrigin(0.5, 0);
      bar = this.add.rectangle(cx + 20, cy + ch - 18, 1, 6, C.gold).setOrigin(0, 0.5);
      objs.push(g, text, bar);
      this.fx.add(objs);
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const growBar = (rest: number) => {
      if (!bar) return;
      this.tweens.killTweensOf(bar);
      this.tweens.add({ targets: bar, width: cw - 40, duration: Math.max(1, rest) });
    };
    const finish = () => {
      if (!this.pending.delete(finish)) return;
      timer.remove();
      this.tweens.killTweensOf(objs);
      for (const o of objs) o.destroy();
      resolve();
    };
    let timer = this.time.delayedCall(ms, finish);
    const started = this.time.now;
    growBar(ms);
    this.pending.add(finish);
    return {
      done,
      hurry: (total, newLabel) => {
        if (!this.pending.has(finish)) return;
        const rest = total - (this.time.now - started);
        if (newLabel) text?.setText(newLabel);
        timer.remove();
        if (rest <= 0) finish();
        else {
          timer = this.time.delayedCall(rest, finish);
          growBar(rest);
        }
      },
    };
  }

  // A short effect that never blocks other scenes (protect). A4: a floating line of text.
  flash(text: string, color = C.gold): void {
    const t = this.add.text(BASE_X, BASE_Y - 140, text, { fontFamily: FONT, fontSize: "30px", color: css(color), fontStyle: "bold" })
      .setOrigin(0.5).setStroke(css(C.navy), 6);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, duration: reducedMotion() ? 600 : 1200, onComplete: () => t.destroy() });
  }

  // Stop every running scene and effect (a resync, a gap, or the queue was too long)
  cancelScenes(): void {
    for (const finish of [...this.pending]) finish();
    this.tweens.killTweensOf(this.fx.getChildren());
    this.fx.removeAll(true);
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
  private drawBanner(house: House, half: number): void {
    const x = BASE_X - half * 0.82 - 1.5 * WALL_STEP;
    const img = this.add.image(x, BASE_Y + BANNER_H + 6, bannerKey(house.id)).setOrigin(0.5, 1);
    img.setScale(BANNER_H / img.height).setDepth(img.y);
    this.world.add(img);
  }

  private soldier(x: number, y: number, house: House, rand: () => number, faceRight: boolean): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, house.soldier).setOrigin(0.5, 1);
    img.setScale((SOLDIER_H / img.height) * (0.92 + rand() * 0.16)).setDepth(y).setFlipX(!faceRight);
    this.world.add(img);
    if (!reducedMotion()) {
      this.tweens.add({ targets: img, y: y - 3, duration: 700 + rand() * 300, delay: rand() * 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    return img;
  }

  // Two guards at the gate, a standard-bearer with the house banner, and the rest in loose rows in front
  private drawGarrison(n: number, house: House, half: number): void {
    const rand = rng(n * 7919 + house.id.length);
    const gx = half * 0.32;
    this.soldier(BASE_X - gx, BASE_Y + 14, house, rand, true);
    this.soldier(BASE_X + gx, BASE_Y + 14, house, rand, false);

    const bx = BASE_X + half + 40, by = BASE_Y + 64;
    const bearer = this.soldier(bx, by, house, rand, false);
    const flag = this.add.image(bx - bearer.displayWidth * 0.28, by - SOLDIER_H * 0.3, bannerKey(house.id)).setOrigin(0.5, 1);
    flag.setScale((SOLDIER_H * 1.2) / flag.height).setDepth(by - 0.5);
    this.world.add(flag);

    let left = n - 3;
    for (const [y, xs] of RANKS) {
      for (const x of xs) {
        if (left-- <= 0) return;
        const jx = x + (rand() - 0.5) * 36, jy = y + (rand() - 0.5) * 20;
        this.soldier(jx, jy, house, rand, jx < BASE_X);
      }
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
    const t1 = this.add.text(W / 2, cy + 26, COPY.battlefield.waitingTitle, { fontFamily: FONT, fontSize: "32px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setDepth(1001);
    const t2 = this.add.text(W / 2, cy + 72, COPY.battlefield.waitingDetail(money(openingPrice)), { fontFamily: FONT, fontSize: "20px", color: css(C.gold) })
      .setOrigin(0.5, 0).setDepth(1001);
    this.world.add([keep, g, t1, t2]);
  }

  private points(flat: number[]): Phaser.Math.Vector2[] {
    const out: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
    return out;
  }

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

  // Scale a background so it fills the game, cropping the overflow
  private cover(img: Phaser.GameObjects.Image): Phaser.GameObjects.Image {
    return img.setScale(Math.max(W / img.width, H / img.height));
  }
}
