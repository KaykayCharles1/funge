// The battlefield scene: the field (day, dusk on top) and the HUD. Later steps add the castle, people and scenes.
import * as Phaser from "phaser";
import { loadFirst, loadLater } from "./assets.ts";
import { H, Hud, W } from "./hud.ts";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class BattlefieldScene extends Phaser.Scene {
  hud!: Hud;
  private dusk: Phaser.GameObjects.Image | null = null;
  private duskWanted = false;
  private onReady: () => void;

  constructor(onReady: () => void) {
    super("battlefield");
    this.onReady = onReady;
  }

  preload(): void {
    loadFirst(this.load);
  }

  create(): void {
    this.cover(this.add.image(W / 2, H / 2, "field_day")).setDepth(-2);
    this.hud = new Hud(this);
    this.onReady();

    // The dusk field comes after the first frame, underneath the HUD
    this.events.once(Phaser.Scenes.Events.RENDER, () =>
      loadLater(this, () => {
        this.dusk = this.cover(this.add.image(W / 2, H / 2, "field_dusk")).setAlpha(this.duskWanted ? 1 : 0).setDepth(-1);
      }),
    );
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
