// Every image the battlefield uses, by texture key. Files are built by tools/build_assets.py into public/assets.
import type * as Phaser from "phaser";
import { HOUSES } from "./identity.ts";
import type { Portrait } from "./identity.ts";

const base = `${import.meta.env.BASE_URL}assets/`;

// Needed for the first frame
const FIRST: Record<string, string> = {
  field_day: "backgrounds/field_day.webp",
  bell: "icons/bell.webp",
  shield: "icons/shield.webp",
  crown: "icons/crown.webp",
  chest: "treasure/chest.webp",
  coin_pile: "treasure/coin_pile.webp",
  keep: "castle/keep.webp",
  castle: "castle/castle.webp",
  wall: "castle/wall.webp",
  banner: "castle/banner.webp",
  soldier_violet: "soldiers/warrior_01.webp",
  soldier_crimson: "soldiers/warrior_02.webp",
  soldier_obsidian: "soldiers/warrior_03.webp",
  soldier_sapphire: "soldiers/warrior_04.webp",
};

// Loaded after the first frame
const LATER: Record<string, string> = {
  field_dusk: "backgrounds/field_dusk.webp",
};

export const avatarKey = (p: Portrait) => `avatar_${p.id}`;

export function loadFirst(load: Phaser.Loader.LoaderPlugin): void {
  for (const [key, file] of Object.entries(FIRST)) load.image(key, base + file);
  // The manifest lists the portraits; their round avatars join the same load
  load.json("manifest", base + "manifest.json");
  load.once("filecomplete-json-manifest", (_key: string, _type: string, data: { portraits: Portrait[] }) => {
    for (const p of data.portraits) load.image(avatarKey(p), base + p.avatar);
  });
}

export function loadLater(scene: Phaser.Scene, done: () => void): void {
  for (const [key, file] of Object.entries(LATER)) scene.load.image(key, base + file);
  scene.load.once("complete", done);
  scene.load.start();
}

export const portraitsOf = (scene: Phaser.Scene): Portrait[] =>
  (scene.cache.json.get("manifest") as { portraits: Portrait[] } | undefined)?.portraits ?? [];

// One banner per house: the white cloth takes the house colour, the gold pole and trim stay.
export const bannerKey = (houseId: string) => `banner_${houseId}`;

export function makeBanners(scene: Phaser.Scene): void {
  const src = scene.textures.get("banner").getSourceImage() as HTMLImageElement;
  const w = src.width, h = src.height;
  for (const house of HOUSES) {
    const tex = scene.textures.createCanvas(bannerKey(house.id), w, h);
    if (!tex) continue; // already made
    const ctx = tex.getContext();
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    const cloth = new Uint8Array(w * h); // 1 where the white cloth was recoloured
    const cr = (house.color >> 16) & 255, cg = (house.color >> 8) & 255, cb = house.color & 255;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max < 110 || (max - min) / max > 0.18) continue; // not the white cloth
      cloth[i / 4] = 1;
      const shade = 0.45 + 0.75 * (max / 255); // keep the cloth's folds
      px[i] = Math.min(255, cr * shade);
      px[i + 1] = Math.min(255, cg * shade);
      px[i + 2] = Math.min(255, cb * shade);
    }
    if (house.edge) silverEdge(px, cloth, w, h, house.text);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }
}

// A 2 px edge in the given colour along the recoloured cloth, so a dark house banner stays visible on dark skies.
function silverEdge(px: Uint8ClampedArray, cloth: Uint8Array, w: number, h: number, color: number): void {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cloth[y * w + x]) continue;
      let edge = false;
      for (let dy = -2; dy <= 2 && !edge; dy++) {
        for (let dx = -2; dx <= 2 && !edge; dx++) {
          const xx = x + dx, yy = y + dy;
          edge = xx < 0 || yy < 0 || xx >= w || yy >= h || !cloth[yy * w + xx];
        }
      }
      if (edge) {
        const i = (y * w + x) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  }
}
