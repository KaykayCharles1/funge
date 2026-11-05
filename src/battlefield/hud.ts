// The HUD over the field: bell with its ring, king plate with two shields, Treasury, next conquest price,
// and a ribbon for notices (connecting, outage).
import type * as Phaser from "phaser";
import { CONFIG } from "../config.ts";
import { COPY } from "../copy.ts";
import { formatUnits } from "../lib/format.ts";
import { avatarKey } from "./assets.ts";
import type { FieldState } from "./director.ts";
import { displayName } from "./identity.ts";
import type { Identity } from "./identity.ts";

export const W = 1280;
export const H = 720;
export const HUD_TOP = 92; // the top HUD row ends here: nothing on the field may reach above it
export const HUD_BOTTOM = H - 70; // the price panel starts here
export const HUD_DEPTH = 5000; // the HUD draws over the field and the scenes

export const C = {
  navy: 0x0f1a33,
  teal: 0x1f8a8a,
  gold: 0xe0a93a,
  crimson: 0xd63a3c,
  cream: 0xf4ead2,
  empty: 0x2a3550,
};
export const FONT = "Georgia, 'Times New Roman', serif";
export const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const T = COPY.battlefield;

// The one money formatter: base units -> "12.34"
export const money = (units: bigint) => formatUnits(units, CONFIG.pusdDecimals);

const TREASURY_FULL = 6000n; // the chest and coin pile are full from here

function panel(s: Phaser.Scene, x: number, y: number, w: number, h: number): void {
  const g = s.add.graphics().setDepth(HUD_DEPTH);
  g.fillStyle(C.navy, 0.86).fillRoundedRect(x, y, w, h, 16);
  g.lineStyle(3, C.gold, 1).strokeRoundedRect(x, y, w, h, 16);
}

// Top row geometry
const PY = 12, PH = HUD_TOP - PY;
const PX = W / 2 - 270, PW = 540;
const AX = PX + 48, AY = PY + PH / 2, AR = 32; // avatar
const BX = 70, BY = 58, BR = 44; // bell ring

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

export class Hud {
  private ring: Phaser.GameObjects.Graphics;
  private ringFrac = 1;
  private time: Phaser.GameObjects.Text;
  private name: Phaser.GameObjects.Text;
  private value: Phaser.GameObjects.Text;
  private conquests: Phaser.GameObjects.Text;
  private treasury: Phaser.GameObjects.Text;
  private next: Phaser.GameObjects.Text;
  private avatarBack: Phaser.GameObjects.Graphics; // disc in the house colour
  private avatar: Phaser.GameObjects.Image;
  private avatarFront: Phaser.GameObjects.Graphics; // ring over the avatar's edge
  private crown: Phaser.GameObjects.Image;
  private shields: Phaser.GameObjects.Image[];
  private chest: Phaser.GameObjects.Image;
  private coins: Phaser.GameObjects.Image;
  private ribbonBox: Phaser.GameObjects.Graphics;
  private ribbonText: Phaser.GameObjects.Text;

  constructor(s: Phaser.Scene) {
    const top = (...objs: Phaser.GameObjects.Components.Depth[]) => objs.forEach((o) => o.setDepth(HUD_DEPTH + 1));

    // Bell and ring, top left; the time and the conquest count below it
    top(s.add.circle(BX, BY, BR + 10, C.navy, 0.86).setStrokeStyle(3, C.gold));
    this.ring = s.add.graphics();
    const bell = s.add.image(BX, BY, "bell").setDisplaySize(44, 50);
    this.time = s.add.text(BX, BY + BR + 16, "", { fontFamily: FONT, fontSize: "22px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setStroke(css(C.navy), 5);
    this.conquests = s.add.text(BX, BY + BR + 44, "", { fontFamily: FONT, fontSize: "16px", color: css(C.cream) })
      .setOrigin(0.5, 0).setStroke(css(C.navy), 5);
    top(this.ring, bell, this.time, this.conquests);
    this.drawRing();

    // King plate, top centre
    panel(s, PX, PY, PW, PH);
    this.avatarBack = s.add.graphics();
    this.avatar = s.add.image(AX, AY, "crown").setVisible(false);
    this.avatarFront = s.add.graphics();
    this.crown = s.add.image(AX, AY, "crown").setDisplaySize(40, 28).setAlpha(0.35);
    this.name = s.add.text(PX + 94, PY + 10, T.noKing, { fontFamily: FONT, fontSize: "26px", color: css(C.cream), fontStyle: "bold" });
    this.value = s.add.text(PX + 94, PY + 46, `${T.kingdomValue}  —`, { fontFamily: FONT, fontSize: "18px", color: css(C.gold) });
    this.shields = [0, 1].map((i) => s.add.image(PX + PW - 82 + i * 46, AY, "shield").setDisplaySize(34, 41).setAlpha(0.35));
    top(this.avatarBack, this.avatar, this.avatarFront, this.crown, this.name, this.value, ...this.shields);

    // Treasury, top right
    const tw = 240, tx = W - tw - 12;
    panel(s, tx, PY, tw, PH);
    this.chest = s.add.image(tx + 48, PY + PH / 2 + 2, "chest");
    this.coins = s.add.image(tx + 48, PY + PH - 6, "coin_pile").setOrigin(0.5, 1);
    const label = s.add.text(tx + 92, PY + 10, T.treasury, { fontFamily: FONT, fontSize: "16px", color: css(C.cream) });
    this.treasury = s.add.text(tx + 92, PY + 32, "—", { fontFamily: FONT, fontSize: "30px", color: css(C.gold), fontStyle: "bold" });
    top(this.chest, this.coins, label, this.treasury);

    // Next conquest price, bottom centre
    const nw = 460, nh = H - 14 - HUD_BOTTOM;
    panel(s, W / 2 - nw / 2, HUD_BOTTOM, nw, nh);
    this.next = s.add.text(W / 2, HUD_BOTTOM + nh / 2, `${T.nextConquest}  —`, { fontFamily: FONT, fontSize: "23px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5);
    top(this.next);

    // Ribbon for notices, across the middle of the field
    this.ribbonBox = s.add.graphics().setDepth(HUD_DEPTH + 2).setVisible(false);
    this.ribbonText = s.add.text(W / 2, 250, "", { fontFamily: FONT, fontSize: "26px", color: css(C.cream), fontStyle: "bold", align: "center", wordWrap: { width: 700 } })
      .setOrigin(0.5).setDepth(HUD_DEPTH + 3).setVisible(false);

    this.drawAvatar(null);
    this.setTreasure(0n);
  }

  // Fill every value from the field state. nextCost: what the next conquest costs, or null.
  show(state: FieldState, king: Identity | null, nextCost: bigint | null): void {
    const open = state.status !== "waiting" && king !== null;
    this.drawAvatar(open ? king : null);
    this.name.setText(open ? displayName(king.portrait) : T.noKing);
    this.value.setText(`${T.kingdomValue}  ${open ? money(state.value) : "—"}`);
    this.shields.forEach((sh, i) => sh.setAlpha(open && i < state.protectsLeft ? 1 : 0.3));
    this.conquests.setText(open && state.conquests > 0 ? T.conquests(state.conquests) : "");
    this.treasury.setText(state.status === "waiting" ? "—" : money(state.treasury));
    this.next.setText(`${T.nextConquest}  ${nextCost !== null && open ? `${money(nextCost)} ${T.currency}` : "—"}`);
    this.setTreasure(state.treasury);
  }

  // The bell: time left and the ring. remainingMs null: no clock running.
  setClock(remainingMs: number | null, totalMs: number | null): void {
    this.time.setText(remainingMs === null ? "" : clockText(remainingMs));
    const frac = remainingMs === null || !totalMs ? 1 : remainingMs / totalMs;
    if (Math.abs(frac - this.ringFrac) > 0.001) this.setRing(frac);
  }

  // A notice across the field, or null to hide it. "alert" draws it in crimson.
  ribbon(text: string | null, tone: "info" | "alert" = "info"): void {
    const on = text !== null;
    this.ribbonBox.setVisible(on);
    this.ribbonText.setVisible(on);
    if (!on) return;
    this.ribbonText.setText(text);
    const w = Math.max(420, this.ribbonText.width + 80), h = this.ribbonText.height + 30;
    this.ribbonBox.clear()
      .fillStyle(tone === "alert" ? C.crimson : C.navy, 0.92).fillRoundedRect(W / 2 - w / 2, 250 - h / 2, w, h, 14)
      .lineStyle(3, C.gold, 1).strokeRoundedRect(W / 2 - w / 2, 250 - h / 2, w, h, 14);
  }

  // The chest grows a little and the coin pile appears as the Treasury fills
  private setTreasure(t: bigint): void {
    const f = Number(t > TREASURY_FULL ? TREASURY_FULL : t < 0n ? 0n : t) / Number(TREASURY_FULL);
    this.chest.setDisplaySize(64 * (0.8 + 0.2 * f), 57 * (0.8 + 0.2 * f));
    this.coins.setVisible(f > 0).setDisplaySize(80 * (0.3 + 0.7 * f), 52 * (0.3 + 0.7 * f));
  }

  private drawAvatar(king: Identity | null): void {
    const back = this.avatarBack.clear(), front = this.avatarFront.clear();
    this.crown.setVisible(!king);
    this.avatar.setVisible(!!king);
    if (!king) {
      back.fillStyle(C.empty, 1).fillCircle(AX, AY, AR);
      front.lineStyle(4, C.cream, 0.5).strokeCircle(AX, AY, AR);
      return;
    }
    back.fillStyle(king.house.color, 1).fillCircle(AX, AY, AR);
    this.avatar.setTexture(avatarKey(king.portrait)).setDisplaySize(AR * 2 - 6, AR * 2 - 6);
    front.lineStyle(4, king.house.text, 1).strokeCircle(AX, AY, AR);
  }

  // Share of the bell left, 0..1. Drawn clockwise from the top.
  setRing(frac: number): void {
    this.ringFrac = Math.max(0, Math.min(1, frac));
    this.drawRing();
  }

  private drawRing(): void {
    const g = this.ring;
    g.clear();
    g.lineStyle(8, C.empty, 1).strokeCircle(BX, BY, BR);
    if (this.ringFrac > 0) {
      const start = -Math.PI / 2;
      g.lineStyle(8, C.gold, 1).beginPath().arc(BX, BY, BR, start, start + this.ringFrac * Math.PI * 2, false).strokePath();
    }
  }
}
