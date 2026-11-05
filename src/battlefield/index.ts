// The battlefield, mounted above the play page with ?mode=battlefield. Loaded by dynamic import from kingdomMode.ts,
// so Phaser is only downloaded on this page.
import * as Phaser from "phaser";
import { onSceneEvent, onSceneSnapshot } from "../sceneBus.ts";
import { H, W } from "./hud.ts";
import { BattlefieldScene } from "./scene.ts";

export function mountBattlefield(): void {
  const host = document.createElement("div");
  host.id = "battlefield";
  host.className = "mx-auto aspect-video w-full max-w-5xl";
  document.body.prepend(host);

  let ready = false;
  const scene = new BattlefieldScene(() => (ready = true));
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

  // Dusk for the last 30 seconds. A4 moves this into the director.
  onSceneEvent((e) => {
    if (!ready) return;
    if (e.type === "clock_warning" && e.reason === "30s") scene.setDusk(true);
    if (e.type === "deadline_changed") scene.setDusk(false);
  });
  // A snapshot (page load mid-round) snaps the sky. 28 s, not 30, so the 30 s warning's crossfade is not cut short.
  onSceneSnapshot((s) => {
    if (!ready || s.status !== "open" || s.remainingMs === null) return;
    const late = s.remainingMs <= 28_000;
    if (late !== scene.isDusk) scene.setDusk(late, 0);
  });

  // Dev only: press D to try the crossfade
  if (import.meta.env.DEV) {
    window.addEventListener("keydown", (e) => {
      if (ready && e.key === "d" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        scene.setDusk(!scene.isDusk);
      }
    });
  }
}
