"""
One-off helper to generate the PWA icons (192px and 512px).
Run once with `python generate_icons.py`. Outputs into ./icons/.
You can delete this file after running it; the icons it produces are
what actually get committed to the repo.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path


def draw_icon(size: int, out_path: Path) -> None:
    # Match the app's primary blue (theme_color in manifest)
    bg = (31, 111, 235)
    fg = (255, 255, 255)

    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)

    # Pick a font that's likely available on Windows; fall back to default
    font_size = int(size * 0.55)
    try:
        font = ImageFont.truetype("arialbd.ttf", font_size)
    except OSError:
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except OSError:
            font = ImageFont.load_default()

    # Center the dollar sign
    text = "$"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_w, text_h = right - left, bottom - top
    pos = ((size - text_w) / 2 - left, (size - text_h) / 2 - top)
    draw.text(pos, text, fill=fg, font=font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")
    print(f"wrote {out_path} ({size}x{size})")


if __name__ == "__main__":
    here = Path(__file__).parent
    draw_icon(192, here / "icons" / "icon-192.png")
    draw_icon(512, here / "icons" / "icon-512.png")
