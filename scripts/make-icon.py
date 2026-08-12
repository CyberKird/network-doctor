"""Generate the app icon from the UI's own design tokens.

Produces build/icon.png (1024, used for Linux and as the macOS source) and
build/icon.ico (multi-size, Windows). Run after changing the brand colours:

    python scripts/make-icon.py

The mark is the hero button in miniature: a raised mint tile with the comet
tracing its rim. Everything is drawn at 4x and downsampled, because the arc
and the rounded corners are the parts that show aliasing first.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SS = 4
SIZE = 1024
D = SIZE * SS

MINT_LIGHT = (184, 229, 210)
MINT_DARK = (104, 186, 156)
CREAM = (247, 246, 242)
INK = (31, 90, 72)

OUT = Path(__file__).resolve().parent.parent / "build"


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return m


def diagonal_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    """Light falling from the top-left, matching --sheen in the UI."""
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(0, size, 8):  # coarse then blurred; 4x res hides the steps
            t = (x / size * 0.45) + (y / size * 0.55)
            c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
            for dx in range(8):
                if x + dx < size:
                    px[x + dx, y] = c
    return grad.filter(ImageFilter.GaussianBlur(size / 90))


def build() -> Image.Image:
    icon = Image.new("RGBA", (D, D), (0, 0, 0, 0))

    # Tile: the app's primary colour, lit from the top-left.
    pad = int(D * 0.055)
    tile_size = D - pad * 2
    radius = int(tile_size * 0.235)
    tile = diagonal_gradient(tile_size, MINT_LIGHT, MINT_DARK)
    tile.putalpha(rounded_mask(tile_size, radius))

    # Drop shadow, offset down-right like every raised surface in the UI.
    shadow = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    shadow.paste((22, 62, 50, 110), (pad, pad + int(D * 0.018)), rounded_mask(tile_size, radius))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(D * 0.022)))
    icon.alpha_composite(tile, (pad, pad))

    # Inner top highlight - the --pop token, so the tile face reads as curved.
    # A smooth alpha ramp, not a shape: a blurred rectangle leaves a visible
    # band where its edge lands.
    gloss = Image.new("RGBA", (D, D), (255, 255, 255, 0))
    ramp = Image.new("L", (1, D))
    for y in range(D):
        t = y / D
        ramp.putpixel((0, y), int(78 * max(0.0, 1 - (t / 0.5)) ** 1.6))
    gloss.putalpha(ramp.resize((D, D)))
    icon.alpha_composite(
        Image.composite(gloss, Image.new("RGBA", (D, D), (0, 0, 0, 0)),
                        _tile_alpha(D, pad, tile_size, radius))
    )

    # Comet ring: same 300deg sweep as .hero__comet, cream on mint.
    ring = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    c = D / 2
    r = D * 0.278
    # Thick enough to survive the 16px downsample, where a thin ring turns to
    # a grey smudge.
    width = int(D * 0.088)
    box = [c - r, c - r, c + r, c + r]
    segments = 120
    sweep = 292.0
    for i in range(segments):
        a1 = -90 + sweep * (i / segments)
        a2 = -90 + sweep * ((i + 1) / segments) + 0.7
        alpha = int(255 * (0.10 + 0.90 * (i / segments) ** 1.35))
        rd.arc(box, start=a1, end=a2, fill=CREAM + (alpha,), width=width)

    # Comet head: a solid cap so the bright end reads at 16px.
    head = math.radians(-90 + sweep)
    hx, hy = c + r * math.cos(head), c + r * math.sin(head)
    rd.ellipse([hx - width / 2, hy - width / 2, hx + width / 2, hy + width / 2],
               fill=(255, 255, 255, 255))

    glow = ring.filter(ImageFilter.GaussianBlur(D * 0.012))
    glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.5)))
    icon.alpha_composite(glow)
    icon.alpha_composite(ring)

    # No centre mark: a dot inside the ring turns the whole thing into an eye.
    return icon.resize((SIZE, SIZE), Image.LANCZOS)


def _tile_alpha(d: int, pad: int, tile_size: int, radius: int) -> Image.Image:
    """Mask limiting the gloss to the tile itself."""
    m = Image.new("L", (d, d), 0)
    m.paste(rounded_mask(tile_size, radius), (pad, pad))
    return m


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = build()

    png = OUT / "icon.png"
    icon.save(png)

    ico = OUT / "icon.ico"
    icon.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    print(f"wrote {png} ({icon.size[0]}x{icon.size[1]})")
    print(f"wrote {ico} (16-256 multi-size)")


if __name__ == "__main__":
    main()
