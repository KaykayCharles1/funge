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
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

export type Urgency = 0 | 60 | 30 | 10; // 0: more than a minute left, or no clock
type Popup = { box: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; until: number; tween: Phaser.Tweens.Tween | null };
const POP_MS = 3500;

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

export class Hud {
  private s: Phaser.Scene;
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
  private chestScale: [number, number] = [1, 1]; // the chest's size for the current Treasury
  private coins: Phaser.GameObjects.Image;
  private ribbonBox: Phaser.GameObjects.Graphics;
  private ribbonText: Phaser.GameObjects.Text;
  private bell: Phaser.GameObjects.Image;
  private urgency: Urgency = 0;
  private urgencyFrozen = false;
  private closedMarks: Phaser.GameObjects.Graphics; // over the shields when protect is closed
  private edge: Phaser.GameObjects.Graphics; // red pulse around the field
  private tollRings: Phaser.GameObjects.Arc[]; // sound rings from the bell
  private plateGlow: Phaser.GameObjects.Image;
  private pops: Popup[] = [];
  private swing: Phaser.Tweens.Tween | null = null;
  private beat: Phaser.Tweens.Tween | null = null;

  constructor(s: Phaser.Scene) {
    this.s = s;
    const top = (...objs: Phaser.GameObjects.Components.Depth[]) => objs.forEach((o) => o.setDepth(HUD_DEPTH + 1));

    // Bell and ring, top left; the time and the conquest count below it
    top(s.add.circle(BX, BY, BR + 10, C.navy, 0.86).setStrokeStyle(3, C.gold));
    this.ring = s.add.graphics({ x: BX, y: BY }); // drawn around its own origin, so it can pulse in place
    const bell = s.add.image(BX, BY - 22, "bell").setOrigin(0.5, 0.1).setDisplaySize(44, 50); // swings from its top
    this.bell = bell;
    this.time = s.add.text(BX, BY + BR + 14, "", { fontFamily: FONT, fontSize: "22px", color: css(C.cream), fontStyle: "bold" })
      .setOrigin(0.5, 0).setStroke(css(C.navy), 5);
    this.conquests = s.add.text(BX, BY + BR + 52, "", { fontFamily: FONT, fontSize: "16px", color: css(C.cream) })
      .setOrigin(0.5, 0).setStroke(css(C.navy), 5);
    top(this.ring, bell, this.time, this.conquests);
    this.drawRing();

    // King plate, top centre, with a glow behind it for the end of the round
    this.plateGlow = s.add.image(W / 2, PY + PH / 2, "fx_glow").setDisplaySize(PW + 120, PH + 90).setTint(C.gold).setAlpha(0).setDepth(HUD_DEPTH - 1);
    panel(s, PX, PY, PW, PH);
    this.avatarBack = s.add.graphics();
    this.avatar = s.add.image(AX, AY, "crown").setVisible(false);
    this.avatarFront = s.add.graphics();
    this.crown = s.add.image(AX, AY, "crown").setDisplaySize(40, 28).setAlpha(0.35);
    this.name = s.add.text(PX + 94, PY + 10, T.noKing, { fontFamily: FONT, fontSize: "26px", color: css(C.cream), fontStyle: "bold" });
    this.value = s.add.text(PX + 94, PY + 46, `${T.kingdomValue}  —`, { fontFamily: FONT, fontSize: "18px", color: css(C.gold) });
    this.shields = [0, 1].map((i) => s.add.image(PX + PW - 82 + i * 46, AY, "shield").setDisplaySize(34, 41).setAlpha(0.35));
    this.closedMarks = s.add.graphics().setVisible(false);
    for (const sh of this.shields) {
      this.closedMarks.lineStyle(5, C.crimson, 1).lineBetween(sh.x - 16, sh.y + 18, sh.x + 16, sh.y - 18);
    }
    top(this.avatarBack, this.avatar, this.avatarFront, this.crown, this.name, this.value, ...this.shields, this.closedMarks);

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

    // Popups under the king plate (two slots), the red edge, the bell's sound rings
    for (let i = 0; i < 2; i++) {
      const box = s.add.graphics().setDepth(HUD_DEPTH + 4).setVisible(false);
      const text = s.add.text(W / 2, 0, "", { fontFamily: FONT, fontSize: "18px", color: css(C.cream), fontStyle: "bold" })
        .setOrigin(0.5).setDepth(HUD_DEPTH + 5).setVisible(false);
      this.pops.push({ box, text, until: 0, tween: null });
    }
    this.edge = s.add.graphics().setDepth(HUD_DEPTH + 6).setAlpha(0);
    this.edge.lineStyle(18, C.crimson, 1).strokeRect(9, 9, W - 18, H - 18);
    this.tollRings = [0, 1, 2].map(() => s.add.circle(BX, BY, BR, 0, 0).setStrokeStyle(4, C.gold).setAlpha(0).setDepth(HUD_DEPTH + 1));

    this.drawAvatar(null);
    this.setTreasure(0n);
  }

  // ---- Popups ----

  // A short message under the king plate that fades after a few seconds. At most two show; a third pushes
  // out the oldest. highlight: about the player's own kingdom.
  popup(text: string, highlight = false): void {
    const now = this.s.time.now;
    let slot = this.pops.find((p) => p.until <= now);
    if (!slot) slot = this.pops.reduce((a, b) => (a.until < b.until ? a : b));
    // The newest sits on top
    for (const p of this.pops) if (p !== slot && p.until > now) this.placePop(p, 1);
    slot.until = now + POP_MS;
    slot.text.setText(text).setColor(css(highlight ? C.navy : C.cream));
    const w = slot.text.width + 36, h = 30;
    slot.box.clear()
      .fillStyle(highlight ? C.gold : C.navy, 0.92).fillRoundedRect(-w / 2, -h / 2, w, h, 12)
      .lineStyle(2, highlight ? C.cream : C.gold, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    this.placePop(slot, 0);
    slot.tween?.remove();
    for (const o of [slot.box, slot.text]) o.setVisible(true).setAlpha(1);
    slot.tween = this.s.tweens.add({ targets: [slot.box, slot.text], alpha: 0, delay: POP_MS - 500, duration: 500 });
  }

  private placePop(p: Popup, row: number): void {
    const y = HUD_TOP + 22 + row * 36;
    p.box.setPosition(W / 2, y);
    p.text.setPosition(W / 2, y);
  }

  // ---- The bell and the clock's last minute ----

  // 60 s: the bell swings slowly. 30 s: protect closed. 10 s: the ring beats like a heart. frozen: the clock is paused.
  setUrgency(level: Urgency, frozen: boolean): void {
    if (level === this.urgency && frozen === this.urgencyFrozen) return;
    const s = this.s, calm = reducedMotion();
    if (level !== this.urgency) {
      this.swing?.remove();
      this.beat?.remove();
      this.swing = this.beat = null;
      this.bell.setAngle(0);
      this.ring.setScale(1);
      if (level > 0 && !calm) {
        this.swing = s.tweens.add({ targets: this.bell, angle: { from: -10, to: 10 }, duration: level <= 10 ? 500 : 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
      if (level === 10 && !calm) {
        // Lub-dub, once a second
        const pulse = { t: 0 };
        this.beat = s.tweens.add({
          targets: pulse, t: 1, duration: 1000, repeat: -1,
          onUpdate: () => {
            const t = pulse.t;
            const bump = (c: number, w: number, h: number) => Math.max(0, 1 - Math.abs(t - c) / w) * h;
            this.ring.setScale(1 + bump(0.1, 0.1, 0.14) + bump(0.32, 0.09, 0.09));
          },
        });
      }
      this.closedMarks.setVisible(level === 30 || level === 10);
      this.urgency = level;
      this.drawRing();
    }
    this.urgencyFrozen = frozen;
    for (const t of [this.swing, this.beat]) {
      if (!t) continue;
      if (frozen) t.pause();
      else t.resume();
    }
  }

  // The bell tolls three times, with rings going out from it
  toll(): void {
    const s = this.s, calm = reducedMotion();
    this.swing?.remove();
    this.swing = null;
    if (!calm) s.tweens.add({ targets: this.bell, angle: { from: -24, to: 24 }, duration: 260, yoyo: true, repeat: 2, ease: "Sine.easeInOut", onComplete: () => this.bell.setAngle(0) });
    this.tollRings.forEach((r, i) => {
      s.tweens.killTweensOf(r);
      r.setRadius(BR).setAlpha(0);
      s.tweens.add({ targets: r, radius: BR * (calm ? 1.4 : 2.4), alpha: { from: 0.9, to: 0 }, duration: 700, delay: i * 520 });
    });
  }

  // A red pulse around the edge of the field (30 seconds left)
  edgePulse(): void {
    this.s.tweens.killTweensOf(this.edge);
    this.s.tweens.add({ targets: this.edge, alpha: { from: 0, to: 0.7 }, duration: 260, yoyo: true, repeat: reducedMotion() ? 0 : 2 });
  }

  // The king plate glows while the round waits for its claim
  glowPlate(on: boolean): void {
    this.s.tweens.killTweensOf(this.plateGlow);
    if (!on) {
      this.plateGlow.setAlpha(0);
      return;
    }
    if (reducedMotion()) this.plateGlow.setAlpha(0.6);
    else this.s.tweens.add({ targets: this.plateGlow, alpha: { from: 0.35, to: 0.85 }, duration: 900, yoyo: true, repeat: -1 });
  }

  // A protect was used: that shield flashes and dims
  useShield(protectsLeft: number): void {
    const sh = this.shields[protectsLeft];
    if (!sh) return;
    const sx = sh.scaleX, sy = sh.scaleY;
    this.s.tweens.add({ targets: sh, scaleX: sx * 1.35, scaleY: sy * 1.35, duration: 140, yoyo: true, onComplete: () => sh.setScale(sx, sy) });
    this.s.tweens.add({ targets: sh, alpha: 0.3, duration: 500, delay: 200 });
  }

  // Fill every value from the field state. nextCost: what the next conquest costs, or null.
  show(state: FieldState, king: Identity | null, nextCost: bigint | null): void {
    const open = state.status !== "waiting" && king !== null;
    this.drawAvatar(open ? king : null);
    this.name.setText(open ? displayName(king.portrait) : T.noKing);
    this.value.setText(`${T.kingdomValue}  ${open ? money(state.value) : "—"}`);
    this.shields.forEach((sh, i) => sh.setAlpha(open && i < state.protectsLeft && this.urgency !== 30 && this.urgency !== 10 ? 1 : 0.3));
    this.conquests.setText(open && state.conquests > 0 ? T.conquests(state.conquests) : "");
    this.treasury.setText(state.status === "waiting" ? "—" : money(state.treasury));
    const canConquer = open && state.status === "open"; // no price once the bell has rung
    this.next.setText(`${T.nextConquest}  ${nextCost !== null && canConquer ? `${money(nextCost)} ${T.currency}` : "—"}`);
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

  // A coin landed in the chest
  bumpChest(): void {
    const c = this.chest, [sx, sy] = this.chestScale;
    this.s.tweens.killTweensOf(c);
    c.setScale(sx, sy);
    this.s.tweens.add({ targets: c, scaleX: sx * 1.15, scaleY: sy * 1.15, duration: 80, yoyo: true, onComplete: () => c.setScale(sx, sy) });
  }

  // The chest grows a little and the coin pile appears as the Treasury fills
  private setTreasure(t: bigint): void {
    const f = Number(t > TREASURY_FULL ? TREASURY_FULL : t < 0n ? 0n : t) / Number(TREASURY_FULL);
    this.s.tweens.killTweensOf(this.chest);
    this.chest.setDisplaySize(64 * (0.8 + 0.2 * f), 57 * (0.8 + 0.2 * f));
    this.chestScale = [this.chest.scaleX, this.chest.scaleY];
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
    g.lineStyle(8, C.empty, 1).strokeCircle(0, 0, BR);
    if (this.ringFrac > 0) {
      const start = -Math.PI / 2;
      const color = this.urgency > 0 && this.urgency <= 10 ? C.crimson : C.gold;
      g.lineStyle(8, color, 1).beginPath().arc(0, 0, BR, start, start + this.ringFrac * Math.PI * 2, false).strokePath();
    }
  }
}
