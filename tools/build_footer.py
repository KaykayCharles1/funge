"""Build the footer painting: art-source/footer/throne.png -> public/assets/landing/throne.webp (and a smaller copy).

Run from the repo root:   python tools/build_footer.py

A full-frame painting (King Satoshi on his throne), so it is only resized and saved as WebP: 1536 px wide for large
screens and 768 px for phones. The page fades its edges into the background itself. The PNG original stays where it is.
Needs Pillow (pip install --user -r tools/requirements.txt).
"""
from pathlib import Path

from PIL import Image

SRC = Path("art-source/footer/throne.png")
OUT = Path("public/assets/landing")
WIDTHS = {"throne.webp": 1536, "throne-768.webp": 768}
QUALITY = 82


def main() -> None:
    with Image.open(SRC) as im:
        rgb = im.convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, width in WIDTHS.items():
        height = round(rgb.height * width / rgb.width)
        out = rgb if rgb.width == width else rgb.resize((width, height), Image.LANCZOS)
        dst = OUT / name
        out.save(dst, "WEBP", quality=QUALITY, method=6)
        print(f"{SRC.name} {rgb.width}x{rgb.height}  ->  {dst} {width}x{height} {dst.stat().st_size / 1024:,.0f} KB")


if __name__ == "__main__":
    main()
