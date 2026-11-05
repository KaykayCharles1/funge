// The HUD frame over the field: bell with its ring, king plate with two shields, Treasury, next conquest price.
// A2 draws the frame with empty values; later steps fill it from the events.
import type * as Phaser from "phaser";
import { COPY } from "../copy.ts";

export const W = 1280;
export const H = 720;

export const C = {
  navy: 0x0f1a33,
  teal: 0x1f8a8a,
  gold: 0xe0a93a,
  crimson: 0xd63a3c,
  cream: 0xf4ead2,
  empty: 0x2a3550,
};
const FONT = "Georgia, 'Times New Roman', serif";
const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const T = COPY.battlefield;

function panel(s: Phaser.Scene, x: number, y: number, w: number, h: number): void {
  const g = s.add.graphics();
  g.fillStyle(C.navy, 0.86).fillRoundedRect(x, y, w, h, 18);
  g.lineStyle(3, C.gold, 1).strokeRoundedRect(x, y, w, h, 18);
}

export class Hud {
  private ring: Phaser.GameObjects.Graphics;
  private ringFrac = 1;
  readonly time: Phaser.GameObjects.Text;
  readonly name: Phaser.GameObjects.Text;
  readonly value: Phaser.GameObjects.Text;
  readonly treasury: Phaser.GameObjects.Text;
  readonly next: Phaser.GameObjects.Text;
  readonly avatarRing: Phaser.GameObjects.Graphics;
  readonly shields: Phaser.GameObjects.Image[];

  constructor(s: Phaser.Scene) {
    // Bell and ring, top left
    const bx = 82, by = 82;
    s.add.circle(bx, by, 58, C.navy, 0.86).setStrokeStyle(3, C.gold);
    this.ring = s.add.graphics();
    s.add.image(bx, by, "bell").setDisplaySize(52, 58);
    this.time = s.add.text(bx, by + 76, "—", { fontFamily: FONT, fontSize: "24px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setStroke(css(C.navy), 5);
    this.drawRing();

    // King plate, top centre
    const px = W / 2 - 280, py = 18, pw = 560, ph = 96;
    panel(s, px, py, pw, ph);
    this.avatarRing = s.add.graphics();
    this.avatarRing.fillStyle(C.empty, 1).fillCircle(px + 56, py + ph / 2, 38);
    this.avatarRing.lineStyle(5, C.cream, 0.5).strokeCircle(px + 56, py + ph / 2, 38);
    s.add.image(px + 56, py + ph / 2, "crown").setDisplaySize(44, 31).setAlpha(0.35);
    this.name = s.add.text(px + 108, py + 18, T.noKing, { fontFamily: FONT, fontSize: "28px", color: css(C.cream), fontStyle: "bold" });
    this.value = s.add.text(px + 108, py + 58, `${T.kingdomValue}  —`, { fontFamily: FONT, fontSize: "19px", color: css(C.gold) });
    this.shields = [0, 1].map((i) => s.add.image(px + pw - 92 + i * 52, py + ph / 2, "shield").setDisplaySize(40, 49).setAlpha(0.35));

    // Treasury, top right
    const tw = 250, tx = W - tw - 18;
    panel(s, tx, py, tw, ph);
    s.add.image(tx + 52, py + ph / 2, "chest").setDisplaySize(72, 64);
    s.add.text(tx + 100, py + 18, T.treasury, { fontFamily: FONT, fontSize: "17px", color: css(C.cream) });
    this.treasury = s.add.text(tx + 100, py + 42, "—", { fontFamily: FONT, fontSize: "32px", color: css(C.gold), fontStyle: "bold" });

    // Next conquest price, bottom centre
    const nw = 460, nh = 60;
    panel(s, W / 2 - nw / 2, H - nh - 18, nw, nh);
    this.next = s.add.text(W / 2, H - 18 - nh / 2, `${T.nextConquest}  —`, { fontFamily: FONT, fontSize: "24px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5);
  }

  // Share of the bell left, 0..1. Drawn clockwise from the top.
  setRing(frac: number): void {
    this.ringFrac = Math.max(0, Math.min(1, frac));
    this.drawRing();
  }

  private drawRing(): void {
    const g = this.ring, x = 82, y = 82, r = 50;
    g.clear();
    g.lineStyle(9, C.empty, 1).strokeCircle(x, y, r);
    if (this.ringFrac > 0) {
      const start = -Math.PI / 2;
      g.lineStyle(9, C.gold, 1).beginPath().arc(x, y, r, start, start + this.ringFrac * Math.PI * 2, false).strokePath();
    }
  }
}
