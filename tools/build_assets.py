"""Build the battlefield art: art-source/*.png (green screen) -> public/assets/*.webp (with transparency).

Run from the repo root:   python tools/build_assets.py
With contact sheets:      python tools/build_assets.py --sheet <folder>
Only some kinds:          python tools/build_assets.py --only portraits[,soldiers,...]

Needs Pillow and numpy (pip install --user pillow numpy). No AI models: a plain chroma key.
How the key works, per pixel:
  1. "Greenness" d = G - max(R, B). The screen is about (2, 250, 5), so d is about 245 there and 0 or less on art.
  2. Alpha falls from 1 to 0 as d rises from OPAQUE_BELOW to 78% of the screen's d.
  3. Edge pixels are unmixed: the screen's share is taken out of the colour, so hair and fur keep their own colour.
  4. Despill in a thin band along the edge: G is capped at max(R, B). Green inside the art (moss) is left alone.
  5. Alpha is eroded by one pixel and blurred slightly, so no green rim is left after resizing.
manifest.json: names and titles already in it are kept, so edit them there freely; re-running only refreshes files
and face crops.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path("art-source")
OUT = Path("public/assets")
OPAQUE_BELOW = 25  # greenness at or below this stays fully opaque
QUALITY = 86

# kind -> (fit, size).  "w": width, "h": height, "max": longest side, "box": exact frame (no trim)
SIZES = {
    "portraits": ("box", (512, 640)),
    "soldiers": ("h", 160),
    "castle": ("w", 400),
    "treasure": ("max", 128),
    "icons": ("max", 96),
}
BANNER_SIZE = ("h", 400)  # the banner is a tall pole: 400 wide would make it 800 tall
# Extra variants with a light rim, for art that is too dark to read on the field: name -> (rgb, rim px at output size).
# The black archer is the obsidian house; 4 px at 160 px tall is about 2 px at the 90 px the field shows.
RIMS = {"warrior_03": ((0xD0, 0xD3, 0xDE), 4)}
# Art with green inside it (the bushes at the base of the castle and keep, greenness about 65-100, the screen about 235):
# start the fade later so the bushes stay solid
OPAQUE_BELOW_BY_NAME = {"castle": 110, "keep": 110}
# Each soldier's eye line, in rows of the 160 px output. The game scales soldiers so the eyes-to-feet distance is the
# same for all four: these big-headed figures read as the same size that way, whatever sticks up above them (a plume,
# a spear tip, a halberd blade). Measured on tools' contact sheets; re-measure if the art changes.
EYE_Y = {"warrior_01": 62, "warrior_02": 62, "warrior_03": 55, "warrior_04": 62}
# Small light-blue patches (the wall caps beside the castle's side towers) are shifted to grey: name -> True
GREY_CYAN = {"castle": True}

# Face square per portrait, as fractions of the source (centre x, centre y, side). Used for the round avatar.
FACES = {
    "king_01": (0.60, 0.40, 0.46), "king_02": (0.58, 0.35, 0.46), "king_03": (0.53, 0.41, 0.48),
    "king_04": (0.62, 0.37, 0.46), "king_05": (0.57, 0.35, 0.48), "king_06": (0.58, 0.38, 0.48),
    "king_07": (0.57, 0.39, 0.52), "king_08": (0.58, 0.37, 0.46), "king_09": (0.60, 0.38, 0.48),
    "king_10": (0.57, 0.37, 0.46),
}
# House per portrait, by the colour of the outfit (first run only; edit it in public/assets/manifest.json).
HOUSES = {
    "king_01": "crimson", "king_02": "crimson", "king_05": "crimson",
    "king_06": "sapphire", "king_07": "sapphire", "king_08": "sapphire",
    "king_03": "violet", "king_04": "violet",
    "king_09": "obsidian", "king_10": "obsidian",
}
# Made-up names, first run only. Edit them in public/assets/manifest.json.
NAMES = {
    "king_01": ("King", "Taren Valecrest"), "king_02": ("Queen", "Maelis Emberwyn"),
    "king_03": ("King", "Brannoc Ironhorn"), "king_04": ("Queen", "Navira Solenne"),
    "king_05": ("King", "Rhovan Ardell"), "king_06": ("King", "Teodric Blueharrow"),
    "king_07": ("King", "Ostmar Silverhold"), "king_08": ("Queen", "Seraphine Pearlmoor"),
    "king_09": ("King", "Torvald Ashenmoor"), "king_10": ("Queen", "Amaranth Velloria"),
}


def key_color(rgb: np.ndarray) -> np.ndarray:
    """Median of the green pixels on the image border."""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    green = border[(border[:, 1] - border[:, [0, 2]].max(1)) > 150]
    return np.median(green, 0) if len(green) else np.array([0.0, 255.0, 0.0])


def chroma_key(im: Image.Image, opaque_below: int = OPAQUE_BELOW) -> Image.Image:
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    k = key_color(rgb)
    dk = k[1] - max(k[0], k[2])
    d = rgb[..., 1] - rgb[..., [0, 2]].max(-1)
    top = dk * 0.78  # the screen is not uniform: castle and keep have a second patch near (1, 250, 30)
    a = np.clip((top - d) / (top - opaque_below), 0.0, 1.0)

    # unmix partly transparent pixels: C = a*F + (1-a)*K  ->  F = (C - (1-a)*K) / a
    part = (a > 0.02) & (a < 1.0)
    fg = rgb.copy()
    fg[part] = (rgb[part] - (1 - a[part, None]) * k) / a[part, None]
    fg = np.clip(fg, 0, 255)

    # despill a band about 6 px wide along the edge
    clear = Image.fromarray(((a < 0.99) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))
    band = np.asarray(clear) > 0
    cap = fg[..., [0, 2]].max(-1)
    fg[..., 1] = np.where(band, np.minimum(fg[..., 1], cap), fg[..., 1])

    alpha = Image.fromarray((a * 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    al = np.asarray(alpha).copy()
    al[al < 16] = 0
    out = np.dstack([fg.astype(np.uint8), al])
    return Image.fromarray(out, "RGBA")


def grey_cyan(im: Image.Image) -> Image.Image:
    """Light-blue pixels (blue well above red, not green) become a stone grey of the same brightness."""
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    strength = np.clip((b - r - 30) / 30, 0, 1) * (b > 140) * (g - np.maximum(r, b) < 20)
    lum = 0.30 * r + 0.59 * g + 0.11 * b
    grey = np.stack([lum * 1.02, lum, lum * 0.97], -1)  # a touch warm, like the stone
    a[..., :3] = a[..., :3] * (1 - strength[..., None]) + grey * strength[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), im.mode)


def tower_tips(im: Image.Image, three: bool) -> list:
    """The topmost opaque point of each tower roof: the main tower, and for the three-tower castle the two side towers."""
    alpha = np.asarray(im.getchannel("A")) > 128
    h, w = alpha.shape
    top = np.where(alpha.any(0), alpha.argmax(0), h)
    def tip(x0, x1):
        x = x0 + int(np.argmin(top[x0:x1]))
        xs = [i for i in range(x0, x1) if top[i] == top[x]]  # the middle of a flat tip
        return [int(round(sum(xs) / len(xs))), int(top[x])]
    main = tip(0, w)
    tips = [main]
    if three:
        # the side towers: the highest point on each side, away from the main roof (its slopes are higher still)
        gap = int(w * 0.2)
        tips += [tip(0, max(1, main[0] - gap)), tip(min(w - 1, main[0] + gap), w)]
    return tips


def door_box(im: Image.Image) -> dict:
    """The wooden door: the brown pixels in the lower half, as x0, x1 and top in output pixels."""
    a = np.asarray(im).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    wood = (r > 110) & (g > 45) & (g < 130) & (b < 80) & (r - g > 35) & (al > 128)
    wood[: im.height // 2] = False
    # only the middle of the building (the doors are centred), and only columns and rows that are mostly wood
    w = im.width
    wood[:, : int(w * 0.3)] = False
    wood[:, int(w * 0.7):] = False
    rowsum = wood.sum(1)
    rows = np.nonzero(rowsum > rowsum.max() * 0.3)[0]
    if len(rows) == 0:
        return {}
    # the door is the lowest block of wood rows (the small window above it is another block)
    start = len(rows) - 1
    while start > 0 and rows[start - 1] >= rows[start] - 2:
        start -= 1
    rows = rows[start:]
    colsum = wood[rows.min(): rows.max() + 1].sum(0)
    cols = np.nonzero(colsum > colsum.max() * 0.4)[0]
    if len(cols) == 0 or len(rows) == 0:
        return {}
    return {"x0": int(cols.min()), "x1": int(cols.max()), "top": int(rows.min())}


def trim(im: Image.Image, pad: int = 2) -> Image.Image:
    al = np.asarray(im.getchannel("A"))
    ys, xs = np.nonzero(al > 8)
    if not len(xs):
        return im
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad)
    return im.crop((x0, y0, x1, y1))


def resize(im: Image.Image, fit: str, size) -> Image.Image:
    """Resize with premultiplied alpha, so transparent pixels do not bleed colour into the edges."""
    w, h = im.size
    if fit == "box":
        target = size
    else:
        scale = {"w": size / w, "h": size / h, "max": size / max(w, h)}[fit]
        target = (max(1, round(w * scale)), max(1, round(h * scale)))
    return im.convert("RGBa").resize(target, Image.LANCZOS).convert("RGBA")


def avatar(portrait: Image.Image, face) -> Image.Image:
    """128x128 round crop of the face."""
    cx, cy, side = face
    w, h = portrait.size
    s = side * w
    box = (round(cx * w - s / 2), round(cy * h - s / 2), round(cx * w + s / 2), round(cy * h + s / 2))
    sq = portrait.crop(box).convert("RGBa").resize((512, 512), Image.LANCZOS)
    mask = Image.new("L", (512, 512), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((4, 4, 508, 508), fill=255)
    sq = sq.convert("RGBA")
    sq.putalpha(Image.fromarray(np.minimum(np.asarray(sq.getchannel("A")), np.asarray(mask))))
    return sq.convert("RGBa").resize((128, 128), Image.LANCZOS).convert("RGBA")


def rim(im: Image.Image, rgb, px: int) -> Image.Image:
    """The art on a solid outline `px` wide in `rgb`, following its shape."""
    padded = Image.new("RGBA", (im.width + 2 * px, im.height + 2 * px), (0, 0, 0, 0))
    padded.alpha_composite(im, (px, px))
    grown = padded.getchannel("A").point(lambda a: 255 if a > 96 else 0).filter(ImageFilter.MaxFilter(2 * px + 1))
    grown = grown.filter(ImageFilter.GaussianBlur(0.6))
    out = Image.new("RGBA", padded.size, rgb + (0,))
    out.putalpha(grown)
    out.alpha_composite(padded)
    return out


def save(im: Image.Image, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=QUALITY, method=6, alpha_quality=95)
    return path.stat().st_size


def green_left(im: Image.Image) -> float:
    """Share of visible pixels that are still strongly green (leftover screen)."""
    a = np.asarray(im).astype(int)
    vis = a[..., 3] > 128
    g = (a[..., 1] - a[..., [0, 2]].max(-1)) > 60
    return float((vis & g).sum()) / max(1, int(vis.sum()))


def main() -> None:
    sheet_dir = Path(sys.argv[sys.argv.index("--sheet") + 1]) if "--sheet" in sys.argv else None
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    built: dict[str, Image.Image] = {}
    measured: dict[str, dict] = {"soldiers": {}, "buildings": {}}  # written into manifest.json for the game
    total = 0
    report = []

    for kind in ["backgrounds", *SIZES]:
        if only is not None and kind not in only:
            continue
        for src in sorted((SRC / kind).glob("*.png")):
            name = src.stem
            im = Image.open(src)
            if kind == "backgrounds":
                im = im.convert("RGB")
                if im.width > 1672:
                    im = im.resize((1672, round(im.height * 1672 / im.width)), Image.LANCZOS)
                out = im
                path = OUT / kind / f"{name}.webp"
                path.parent.mkdir(parents=True, exist_ok=True)
                out.save(path, "WEBP", quality=82, method=6)
                n = path.stat().st_size
            else:
                keyed = chroma_key(im, OPAQUE_BELOW_BY_NAME.get(name, OPAQUE_BELOW))
                if GREY_CYAN.get(name):
                    keyed = grey_cyan(keyed)
                fit, sz = BANNER_SIZE if name == "banner" else SIZES[kind]
                if fit != "box":
                    keyed = trim(keyed)
                out = resize(keyed, fit, sz)
                n = save(out, OUT / kind / f"{name}.webp")
                if name in RIMS:
                    rimmed = rim(out, *RIMS[name])
                    n += save(rimmed, OUT / kind / f"{name}_silver.webp")
                    built[f"{kind}/{name}_silver"] = rimmed
                    if kind == "soldiers":
                        measured["soldiers"][f"{name}_silver"] = {"height": rimmed.height, "eyeY": EYE_Y[name] + (rimmed.height - out.height) // 2}
                if kind == "soldiers":
                    # anchored at the feet (the bottom of the trimmed image); scaled in the game by body height
                    measured["soldiers"][name] = {"height": out.height, "eyeY": EYE_Y[name]}
                if name in ("castle", "keep"):
                    measured["buildings"][name] = {
                        "width": out.width, "height": out.height,
                        "tips": tower_tips(out, name == "castle"), "door": door_box(out),
                    }
                if kind == "portraits":
                    av = avatar(out, FACES[name])
                    n += save(av, OUT / kind / f"{name}_avatar.webp")
                    built[f"{kind}/{name}_avatar"] = av
            built[f"{kind}/{name}"] = out
            total += n
            g = green_left(out) if out.mode == "RGBA" else 0.0
            report.append(f"{kind}/{name:<12} {out.width:>5}x{out.height:<5} {n / 1024:7.1f} KB   green left {g * 100:5.2f}%")

    # manifest: keep names already there
    # Sound: art-source/audio/*.mp3 is copied as it is (MP3 plays in every browser; keep the files small)
    for src in sorted((SRC / "audio").glob("*.mp3")) if only is None or "audio" in only else []:
        dst = OUT / "audio" / src.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        total += dst.stat().st_size
        report.append(f"audio/{src.stem:<16} {dst.stat().st_size / 1024:7.1f} KB")

    mpath = OUT / "manifest.json"
    old = {}
    whole = {}
    if mpath.exists():
        whole = json.loads(mpath.read_text(encoding="utf-8"))
        old = {p["id"]: p for p in whole.get("portraits", [])}
    portraits = []
    for pid in sorted(FACES):
        cx, cy, side = FACES[pid]
        title, name = NAMES[pid]
        prev = old.get(pid, {})
        portraits.append({
            "id": pid,
            "title": prev.get("title", title),
            "name": prev.get("name", name),
            "house": prev.get("house", HOUSES[pid]),
            "image": f"portraits/{pid}.webp",
            "avatar": f"portraits/{pid}_avatar.webp",
            # face square in the 512x640 portrait, pixels
            "face": {"x": round((cx - side / 2) * 512), "y": round(cy * 640 - side * 512 / 2), "size": round(side * 512)},
        })
    mpath.write_text(json.dumps({**whole, **{k: {**whole.get(k, {}), **v} for k, v in measured.items() if v}, "portraits": portraits}, indent=2) + "\n", encoding="utf-8")

    print("\n".join(report))
    print(f"TOTAL {total / 1024 / 1024:.2f} MB")

    if sheet_dir:
        sheets(built, sheet_dir)


def sheets(built: dict[str, Image.Image], d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    items = [(k, v) for k, v in built.items() if not k.startswith("backgrounds")]
    for label, bg in [("dark", (16, 22, 44)), ("light", (238, 232, 214)), ("magenta", (255, 0, 255))]:
        cell, cols = 200, 6
        rows = (len(items) + cols - 1) // cols
        sh = Image.new("RGBA", (cols * cell, rows * cell), bg + (255,))
        for i, (_, im) in enumerate(items):
            t = im.copy()
            t.thumbnail((cell - 12, cell - 12), Image.LANCZOS)
            x, y = (i % cols) * cell + (cell - t.width) // 2, (i // cols) * cell + (cell - t.height) // 2
            sh.alpha_composite(t, (x, y))
        sh.convert("RGB").save(d / f"sheet_{label}.png")
    # hair and fur edges at full output size, on dark
    if "portraits/king_01" not in built:
        return
    zoom = Image.new("RGBA", (5 * 256, 2 * 320), (16, 22, 44, 255))
    for i in range(10):
        p = built[f"portraits/king_{i + 1:02d}"]
        zoom.alpha_composite(p.crop((0, 0, 512, 640)).resize((256, 320), Image.LANCZOS), ((i % 5) * 256, (i // 5) * 320))
    zoom.convert("RGB").save(d / "sheet_portraits_dark.png")
    light = Image.new("RGBA", zoom.size, (238, 232, 214, 255))
    for i in range(10):
        p = built[f"portraits/king_{i + 1:02d}"]
        light.alpha_composite(p.resize((256, 320), Image.LANCZOS), ((i % 5) * 256, (i // 5) * 320))
    light.convert("RGB").save(d / "sheet_portraits_light.png")


if __name__ == "__main__":
    main()
