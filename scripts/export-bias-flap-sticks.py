"""Deterministic public-clearing edit for the Bias Flap stick sprites.

The delivered orbs carry the BTS logo mark (contradicting the delivery
brief's "generic star emblem"). This script erases every purple-tinted
pixel inside the orb glass and draws the promised five-point star, then
the results are exported to WebP. Re-run it after any intake refresh so a
re-export can NEVER silently restore the gated mark; the shipped hashes
are pinned in docs/CONTENT_REGISTER.md.

Usage:  python3 scripts/export-bias-flap-sticks.py
Needs:  Pillow; cwebp on PATH; intake/bias-flap/assets/stick_*.png.
Output: public/games/flappy/stick-up.webp, stick-down.webp
"""

import math
import subprocess
from PIL import Image, ImageDraw

ORB_R = 54
STAR_FILL = (168, 148, 222, 255)
STAR_OUTLINE = (128, 108, 182, 255)
PALE = (247, 246, 252)


def star(cx, cy, r1, r2, rot=-math.pi / 2, n=5):
    pts = []
    for i in range(n * 2):
        r = r1 if i % 2 == 0 else r2
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


for name, orb_top, out in [
    ("stick_up", True, "stick-up"),
    ("stick_down", False, "stick-down"),
]:
    img = Image.open(f"intake/bias-flap/assets/{name}.png").convert("RGBA")
    w, h = img.size
    px = img.load()
    ocx, ocy = 70, (70 if orb_top else h - 71)
    for y in range(max(0, ocy - 60), min(h, ocy + 60)):
        for x in range(w):
            if (x - ocx) ** 2 + (y - ocy) ** 2 > ORB_R * ORB_R:
                continue
            r, g, b, a = px[x, y]
            if a > 200 and b - g >= 22 and g > 120:
                px[x, y] = (*PALE, a)
    # Crisp pixel star: half-res polygon, nearest-neighbour upscale.
    small = Image.new("RGBA", (w // 2, h // 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(small)
    d.polygon(star(ocx / 2, ocy / 2, 19, 8.5), fill=STAR_FILL, outline=STAR_OUTLINE)
    img.alpha_composite(small.resize((w, h), Image.NEAREST))
    tmp = f"/tmp/{name}_star.png"
    img.save(tmp)
    subprocess.run(
        ["cwebp", "-q", "90", "-m", "6", "-exact", tmp,
         "-o", f"public/games/flappy/{out}.webp"],
        check=True, capture_output=True,
    )
    print("wrote", out)
