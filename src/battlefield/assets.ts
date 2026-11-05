// Every image the battlefield uses, by texture key. Files are built by tools/build_assets.py into public/assets.
import type * as Phaser from "phaser";

const base = `${import.meta.env.BASE_URL}assets/`;

// Needed for the first frame
const FIRST: Record<string, string> = {
  field_day: "backgrounds/field_day.webp",
  bell: "icons/bell.webp",
  shield: "icons/shield.webp",
  crown: "icons/crown.webp",
  chest: "treasure/chest.webp",
};

// Loaded after the first frame
const LATER: Record<string, string> = {
  field_dusk: "backgrounds/field_dusk.webp",
};

export function loadFirst(load: Phaser.Loader.LoaderPlugin): void {
  for (const [key, file] of Object.entries(FIRST)) load.image(key, base + file);
}

export function loadLater(scene: Phaser.Scene, done: () => void): void {
  for (const [key, file] of Object.entries(LATER)) scene.load.image(key, base + file);
  scene.load.once("complete", done);
  scene.load.start();
}
