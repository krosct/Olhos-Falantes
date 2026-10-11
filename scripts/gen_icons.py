"""Generate the PWA icons (192, 512, maskable 512) and the favicon from the 👁️ emoji.

Run with the project venv: `~/.venv/bin/python scripts/gen_icons.py`.
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
OUT_DIR = os.path.join(PUBLIC_DIR, "icons")
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
BACKGROUND = (11, 18, 32)


def _eye() -> Image.Image:
    # Noto Color Emoji only ships bitmaps at 109px; render there, then scale.
    font = ImageFont.truetype(EMOJI_FONT, 109)
    glyph = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((10, 10), "\U0001f441️", font=font, embedded_color=True)
    glyph = glyph.crop(glyph.getbbox())
    side = max(glyph.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    return square


def generate(size: int, filename: str, emoji_ratio: float) -> None:
    canvas = Image.new("RGBA", (size, size), BACKGROUND + (255,))
    emoji_size = round(size * emoji_ratio)
    emoji = _eye().resize((emoji_size, emoji_size), Image.LANCZOS)
    offset = (size - emoji_size) // 2
    canvas.alpha_composite(emoji, (offset, offset))
    os.makedirs(OUT_DIR, exist_ok=True)
    canvas.convert("RGB").save(os.path.join(OUT_DIR, filename), optimize=True)


def generate_favicon(size: int = 64) -> None:
    _eye().resize((size, size), Image.LANCZOS).save(os.path.join(PUBLIC_DIR, "favicon.png"), optimize=True)


def main() -> None:
    generate(192, "icon-192.png", emoji_ratio=0.72)
    generate(512, "icon-512.png", emoji_ratio=0.72)
    # Maskable icons can be cropped to a circle of 80% of the size.
    generate(512, "maskable-512.png", emoji_ratio=0.52)
    generate_favicon()
    print(f"Icons written to {os.path.normpath(PUBLIC_DIR)}")


if __name__ == "__main__":
    main()
