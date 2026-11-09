// A house flag drawn in code: a pole with a gold finial and a cloth in the house colour. The cloth waves on a Phaser
// Rope (only the cloth moves; the wave grows from the pole outwards, each flag with its own phase). A Rope needs WebGL:
// on the canvas renderer, or with reduced motion, the cloth is a still image. Used on the tower tips and in the corners.
import * as Phaser from "phaser";
import { C, reducedMotion } from "./hud.ts";
import { HOUSES, type House } from "./identity.ts";

const CLOTH_W = 120, CLOTH_H = 72; // texture size; flags are scaled from it
const SEGMENTS = 12;
export const flagKey = (houseId: string) => `flag_${houseId}`;

// One cloth texture per house: the colour with soft folds, a gold band at the pole, a swallowtail at the fly end
export function makeFlagCloths(scene: Phaser.Scene): void {
  for (const house of HOUSES) {
    const key = flagKey(house.id);
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, CLOTH_W, CLOTH_H);
    if (!tex) continue;
    const ctx = tex.getContext();
    const col = `#${house.color.toString(16).padStart(6, "0")}`;
    const notch = CLOTH_W - 22;
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(CLOTH_W, 0);
      ctx.lineTo(notch, CLOTH_H / 2);
      ctx.lineTo(CLOTH_W, CLOTH_H);
      ctx.lineTo(0, CLOTH_H);
      ctx.closePath();
    };
    outline();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.save();
    outline();
    ctx.clip();
    // folds: light and shade across the length
    for (let x = 0; x < CLOTH_W; x += 2) {
      const f = Math.sin(x / 9) * 0.5 + 0.5;
      ctx.fillStyle = f > 0.5 ? `rgba(255,255,255,${(f - 0.5) * 0.22})` : `rgba(0,0,0,${(0.5 - f) * 0.3})`;
      ctx.fillRect(x, 0, 2, CLOTH_H);
    }
    // gold band at the pole and a thin gold line along the edges
    ctx.fillStyle = "#e0a93a";
    ctx.fillRect(0, 0, 9, CLOTH_H);
    ctx.restore();
    outline();
    ctx.lineWidth = house.edge ? 4 : 2.5;
    ctx.strokeStyle = house.edge ? "#d0d3de" : "rgba(224,169,58,0.9)";
    ctx.stroke();
    tex.refresh();
  }
}

export type FlagOpts = { poleH: number; clothW: number; house: House; phase: number; depth: number };

export class WavingFlag {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  readonly clothCentre: { x: number; y: number };
  private rope: Phaser.GameObjects.Rope | null = null;
  private base: { x: number; y: number }[] = [];
  private phase: number;
  private amp: number;

  // x, y: the top of the pole (where the cloth hangs from); the pole goes down from there
  constructor(scene: Phaser.Scene, x: number, y: number, o: FlagOpts) {
    this.phase = o.phase;
    const scale = o.clothW / CLOTH_W, h = CLOTH_H * scale;
    this.amp = CLOTH_H * 0.12; // in the cloth's own pixels (the rope is scaled)
    const pole = scene.add.graphics().setDepth(o.depth);
    pole.lineStyle(Math.max(2, o.clothW * 0.05), 0x6b4a2a, 1).lineBetween(x, y - 2, x, y + o.poleH);
    pole.fillStyle(C.gold, 1).fillCircle(x, y - 3, Math.max(2.5, o.clothW * 0.06));
    this.objects.push(pole);
    const cx = x + o.clothW / 2, cy = y + h / 2 + 1;
    this.clothCentre = { x: cx, y: cy };
    const webgl = scene.game.renderer.type === Phaser.WEBGL;
    if (webgl && !reducedMotion()) {
      // points along the cloth, from -half to +half its width around the rope's position (Phaser's Rope convention)
      const points = Array.from({ length: SEGMENTS }, (_, i) => ({ x: -CLOTH_W / 2 + (i * CLOTH_W) / (SEGMENTS - 1), y: 0 }));
      const rope = scene.add.rope(cx, cy, flagKey(o.house.id), undefined, points, true);
      rope.setScale(scale).setDepth(o.depth + 0.1);
      this.base = rope.points.map((p) => ({ x: p.x, y: p.y }));
      this.rope = rope;
      this.objects.push(rope);
    } else {
      this.objects.push(scene.add.image(cx, cy, flagKey(o.house.id)).setScale(scale).setDepth(o.depth + 0.1));
    }
  }

  // Every frame: the cloth ripples, more towards the fly end; the pole side stays put
  update(timeMs: number): void {
    const r = this.rope;
    if (!r || !r.active) return;
    const t = timeMs / 1000;
    const n = r.points.length;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const p = r.points[i]!, b = this.base[i]!;
      p.y = b.y + Math.sin(t * 3.2 + this.phase - k * 4.2) * this.amp * k;
      p.x = b.x - Math.abs(Math.sin(t * 1.6 + this.phase)) * 3 * k; // the cloth gathers a little as it waves
    }
    r.setDirty();
  }
}
