"""Build the "How a round is played" images: art-source/howto/howto-*.png -> public/assets/howto/*.webp.

Run from the repo root:   python tools/build_howto.py

These are full-frame square paintings, so unlike tools/build_assets.py there is no chroma key, no trim and no edge
softening: each one is only resized to SIZE x SIZE and saved as WebP. Only files named howto-*.png are read (the
reference frames in art-source/howto/cypheir_frames/ are never touched). The PNG originals stay where they are.
Needs Pillow (pip install --user -r tools/requirements.txt).
"""
from pathlib import Path

from PIL import Image

SRC = Path("art-source/howto")
OUT = Path("public/assets/howto")
SIZE = 1200  # px, square
QUALITY = 82


def kb(n: int) -> str:
    return f"{n / 1024:,.0f} KB"


def main() -> None:
    sources = sorted(SRC.glob("howto-*.png"))
    if not sources:
        raise SystemExit(f"No howto-*.png files in {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    before = after = 0
    for src in sources:
        with Image.open(src) as im:
            if im.width != im.height:
                raise SystemExit(f"{src.name} is {im.width}x{im.height}; these images must be square")
            out = im.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS) if im.width != SIZE else im.convert("RGB")
        dst = OUT / f"{src.stem}.webp"
        out.save(dst, "WEBP", quality=QUALITY, method=6)
        a, b = src.stat().st_size, dst.stat().st_size
        before += a
        after += b
        print(f"{src.name:28} {im.width}x{im.height} {kb(a):>9}  ->  {dst.name:30} {SIZE}x{SIZE} {kb(b):>7}")
    print(f"{'total':28} {'':9} {kb(before):>9}  ->  {'':30} {'':9} {kb(after):>7}")


if __name__ == "__main__":
    main()
