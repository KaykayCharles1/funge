"""Build the Fair Game Rules scroll roller: art-source/game_rules/scroll-roller.png -> public/assets/rules/roller.webp.

Run from the repo root:   python tools/build_rules.py

The roller was painted on a plain white background. The background is the white area joined to the image's edge
(found by a flood fill from a corner), so white highlights inside the gold are never touched. Its outermost pixels,
where the roller blends into the white, get partial transparency with the white taken out of their colour, so the
edge is smooth on any background. The result is trimmed to the roller and saved as a WebP with transparency.
The PNG original stays where it is. Needs Pillow and NumPy (pip install --user -r tools/requirements.txt).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SRC = Path("art-source/game_rules/scroll-roller.png")
DST = Path("public/assets/rules/roller.webp")
NEAR_WHITE = 40  # how far from pure white a pixel may be and still count as background (0-255)
NOISE = 6  # the white is not perfectly flat: anything this close to pure white is fully clear
PAD = 2  # px of clear space kept around the trimmed roller
QUALITY = 86


def main() -> None:
    with Image.open(SRC) as im:
        rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    h, w, _ = rgb.shape
    # how far each pixel is from white: 0 for pure white
    away = 255.0 - rgb.min(axis=2)

    # the background: the near-white area reachable from the top-left corner
    # (a copy: an image made from an array shares its memory, and a flood fill on it changes nothing)
    mask = Image.fromarray(np.where(away < NEAR_WHITE, 255, 0).astype(np.uint8)).copy()
    if mask.getpixel((0, 0)) != 255:
        raise SystemExit("The top-left corner is not white; is this the white-background roller?")
    ImageDraw.floodfill(mask, (0, 0), 128)
    background = np.array(mask) == 128

    # the roller is opaque; the background fades from opaque (at the roller's edge) to clear (pure white)
    alpha = np.where(background, np.clip((away - NOISE) / (NEAR_WHITE - NOISE), 0.0, 1.0), 1.0)
    # take the white out of the partly clear pixels: shown = a * colour + (1 - a) * white
    a = np.maximum(alpha, 1e-3)[..., None]
    colour = np.clip((rgb - 255.0 * (1.0 - a)) / a, 0, 255)
    rgba = np.dstack([colour, alpha * 255.0]).round().astype(np.uint8)

    out = Image.fromarray(rgba, "RGBA")
    box = out.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        raise SystemExit("Nothing left after removing the background")
    l, t, r, b = box
    out = out.crop((max(0, l - PAD), max(0, t - PAD), min(w, r + PAD), min(h, b + PAD)))

    DST.parent.mkdir(parents=True, exist_ok=True)
    out.save(DST, "WEBP", quality=QUALITY, alpha_quality=100, method=6)
    print(f"{SRC.name} {w}x{h} {SRC.stat().st_size / 1024:,.0f} KB  ->  {DST} {out.width}x{out.height} "
          f"{DST.stat().st_size / 1024:,.0f} KB")


if __name__ == "__main__":
    main()
