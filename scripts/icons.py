"""Render all of Vibe Clip's icons from the SVGs in crates/app/assets.

Needs resvg (`cargo install resvg`) and Pillow (`pip install pillow`).

From the drawings:
- glyph.svg: the glyph alone, white on transparent.
- glyph-keyline.svg: the glyph with a dark outline, for the tray (16-64 px).
- icon-tile.svg: the glyph on a violet-to-pink tile filling the icon (Windows).
- icon-mac.svg: the same tile with macOS's margins (macOS, and big copies).

It makes:
- icon.ico: the .exe's icon, from icon-tile.svg at each size Windows uses.
- icon-tile-256.png: the window's icon while running (the taskbar's).
- tray/glyph-N.png: the tray, glyph-keyline.svg drawn at each size trays use.
- glyph-icon/N.png: Linux's icon theme (keyline up to 32 px, a shadowed glyph above).
- tray-mac.png: macOS's menu bar (the glyph, a template image).
- glyph.png: the empty library page (the glyph in white, tinted at runtime).
- icon-1024.png and vibe-clip.icns: macOS's icon; discord-logo.png: Discord's art.
"""

import io
import os
import subprocess
import tempfile

from PIL import Image, ImageFilter

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "crates", "app", "assets")


def render(svg: str, size: int) -> Image.Image:
    """Draw an SVG at size x size with resvg."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.png")
        subprocess.run(["resvg", "-w", str(size), "-h", str(size), os.path.join(ASSETS, svg), out], check=True)
        with open(out, "rb") as f:
            return Image.open(io.BytesIO(f.read())).convert("RGBA")


def shadowed_glyph(size: int) -> Image.Image:
    """The white glyph a little smaller than the icon, with a soft shadow under it."""
    g = size * 560 // 604
    glyph = render("glyph.svg", g)
    canvas = Image.new("RGBA", (size, size))
    canvas.alpha_composite(glyph, ((size - g) // 2, (size - g) // 2))
    alpha = canvas.getchannel("A")
    out = Image.new("RGBA", (size, size))
    for blur, drop, strength in ((size * 0.025, max(1, round(size * 0.016)), 0.55), (max(0.7, size * 0.011), 0, 0.95)):
        a = alpha.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * strength))
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shadow.putalpha(a)
        out.alpha_composite(shadow, (0, drop))
    out.alpha_composite(canvas)
    return out


def main() -> None:
    os.makedirs(os.path.join(ASSETS, "tray"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "glyph-icon"), exist_ok=True)

    # Windows: the .exe's icon, and the running window's.
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    big = render("icon-tile.svg", 256)
    tiles = [render("icon-tile.svg", s) for s in sizes]
    big.save(os.path.join(ASSETS, "icon.ico"), sizes=[(s, s) for s in sizes], append_images=tiles[:-1])
    big.save(os.path.join(ASSETS, "icon-tile-256.png"))

    # The tray, at each size it's shown (so Windows never scales it).
    for s in (16, 20, 24, 28, 32, 40, 48, 64):
        render("glyph-keyline.svg", s).save(os.path.join(ASSETS, "tray", f"glyph-{s}.png"))

    # Linux's icon theme.
    for s in (16, 22, 24, 32):
        render("glyph-keyline.svg", s).save(os.path.join(ASSETS, "glyph-icon", f"{s}.png"))
    for s in (48, 64, 96, 128, 192, 256):
        shadowed_glyph(s).save(os.path.join(ASSETS, "glyph-icon", f"{s}.png"))

    # macOS's menu bar: 32 px with 2 px clear round it, as a template (grey + alpha).
    mac = Image.new("RGBA", (36, 36))
    mac.alpha_composite(render("glyph.svg", 32), (2, 2))
    mac.convert("LA").save(os.path.join(ASSETS, "tray-mac.png"))

    # The empty library page: 512 px in the middle of 768, white (tinted at runtime).
    page = Image.new("RGBA", (768, 768))
    page.alpha_composite(render("glyph.svg", 512), (128, 128))
    page.convert("LA").save(os.path.join(ASSETS, "glyph.png"))

    # macOS's icon, and big copies of it.
    icon = render("icon-mac.svg", 1024)
    icon.save(os.path.join(ASSETS, "icon-1024.png"))
    icon.save(os.path.join(ASSETS, "vibe-clip.icns"))

    # Discord's art asset: the tile, square and opaque (Discord rounds it itself).
    tile = render("icon-tile.svg", 1024).crop((24, 24, 1000, 1000)).resize((1024, 1024), Image.LANCZOS)
    flat = Image.new("RGB", (1024, 1024), (139, 92, 246))
    flat.paste(tile, (0, 0), tile)
    flat.save(os.path.join(ASSETS, "discord-logo.png"))
    print("icons written to", os.path.normpath(ASSETS))


if __name__ == "__main__":
    main()
