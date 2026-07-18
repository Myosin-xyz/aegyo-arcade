#!/usr/bin/env python3
"""Export claw_machine_clean.psd -> public/games/claw/*.png + manifest.json.

PSD -> runtime pipeline, stage 1 of 2 (ADR 0003). Needs the pinned deps in
scripts/requirements.txt and the source PSD (large, kept in Myosin shared
storage — see ADR 0003 for custody/checksum). Full reproduction of the
deployed asset set:

  pip install -r scripts/requirements.txt
  PSD_PATH=/path/to/claw_machine_clean.psd python3 scripts/export-claw-layers.py
  python3 scripts/rescale-claw-assets.py --factor 0.70 --quality 74

Stage 1 writes full-res PNGs + manifest; stage 2 rescales to the shipped
WebP set and budget-checks it (non-destructive verification lives in
scripts/check-claw-assets.mjs, run by CI).

Layering is baked into the export so the engine draws flat images, not PSD groups:
  back  = cabinet + back plush rows (behind the claw)
  claw  = open / closed / 7 held variants  (the only tall sprites — cable is baked in)
  trolley = rail head (moves horizontally with the claw)
  front-plush = front rows (occlude the claw as it descends)
  frame = foreground cabinet + controls (transparent center window)
  win-board = CONGRATULATION! overlay
  ctl-*-on = lit button overlays shown on press
"""

import json
import os
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

REPO = Path(__file__).resolve().parent.parent
PSD_PATH = Path(
    os.environ.get("PSD_PATH", str(REPO / "claw_machine_clean.psd"))
)
OUT = REPO / "public" / "games" / "claw"
SCALE = float(os.environ.get("SCALE", "1.0"))

psd = PSDImage.open(str(PSD_PATH))
PW, PH = psd.width, psd.height
OUT.mkdir(parents=True, exist_ok=True)


def top(name: str):
    for ch in psd:
        if ch.name == name:
            return ch
    raise KeyError(f"top-level layer not found: {name!r}")


def find(node, name: str):
    for ch in node:
        if ch.name == name:
            return ch
        if ch.is_group():
            r = find(ch, name)
            if r is not None:
                return r
    return None


def node_image(node):
    """(RGBA image, (left, top)). Groups composite; layers use topil so HIDDEN
    layers (the claw + winner sprites live in hidden groups) still export."""
    img = node.composite() if node.is_group() else node.topil()
    if img is None:
        return None, (0, 0)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    b = node.bbox
    return img, (b[0], b[1])


def safe_composite(canvas: Image.Image, img: Image.Image, x: int, y: int) -> None:
    """alpha_composite that tolerates negative offsets + canvas overflow (the frame
    layer is authored slightly larger than the canvas)."""
    if x < 0:
        img = img.crop((-x, 0, img.width, img.height))
        x = 0
    if y < 0:
        img = img.crop((0, -y, img.width, img.height))
        y = 0
    cw, ch = canvas.size
    if x + img.width > cw:
        img = img.crop((0, 0, cw - x, img.height))
    if y + img.height > ch:
        img = img.crop((0, 0, img.width, ch - y))
    if img.width <= 0 or img.height <= 0:
        return
    canvas.alpha_composite(img, (x, y))


def flatten(nodes) -> Image.Image:
    """Composite nodes onto a full-canvas transparent image (z-order = list order)."""
    canvas = Image.new("RGBA", (PW, PH), (0, 0, 0, 0))
    for n in nodes:
        img, (x, y) = node_image(n)
        if img is not None:
            safe_composite(canvas, img, x, y)
    return canvas


def scaled(img: Image.Image) -> Image.Image:
    if SCALE == 1.0:
        return img
    w = max(1, round(img.width * SCALE))
    h = max(1, round(img.height * SCALE))
    return img.resize((w, h), Image.LANCZOS)


def entry_full(filename: str, img: Image.Image) -> dict:
    """Full-canvas layer, drawn at (0,0)."""
    img = scaled(img)
    img.save(OUT / filename)
    return {"src": filename, "x": 0, "y": 0, "w": img.width, "h": img.height}


def entry_sprite(filename: str, node) -> dict:
    """Tight sprite with its authored offset recorded (scaled)."""
    img, (x, y) = node_image(node)
    assert img is not None, f"empty sprite: {filename}"
    img = scaled(img)
    img.save(OUT / filename)
    return {
        "src": filename,
        "x": round(x * SCALE),
        "y": round(y * SCALE),
        "w": img.width,
        "h": img.height,
    }


def entry_cropped(filename: str, img: Image.Image) -> dict:
    """Crop a full-canvas image to its content bbox; record the offset (for overlays)."""
    bb = img.getbbox() or (0, 0, img.width, img.height)
    crop = scaled(img.crop(bb))
    crop.save(OUT / filename)
    return {
        "src": filename,
        "x": round(bb[0] * SCALE),
        "y": round(bb[1] * SCALE),
        "w": crop.width,
        "h": crop.height,
    }


def remove_vertical_arrows(img: Image.Image) -> None:
    """Paint out the inert UP + DOWN buttons. The cabinet is a flat front view with
    one horizontal rail, so there's no vertical axis — up/down control nothing. The
    unlit D-pad is baked into front_claw_machine, so we flat-fill the gaps where the
    up and down buttons sat with panel colour sampled row-wise (keeps the vertical
    vignette). Runs on the full-res layer BEFORE the export downscale, so coords are
    full-res PSD pixels. (For a pixel-perfect source, delete the buttons in the PSD.)"""
    px = img.load()
    wd, hd = img.size

    def fill(l: int, t: int, r: int, b: int, sx: int, cy_max: int) -> None:
        ssx = max(0, min(wd - 1, sx))
        for y in range(max(0, t), min(hd, b)):
            col = px[ssx, min(y, cy_max)]
            for x in range(max(0, l), min(wd, r)):
                px[x, y] = col

    # up button — inter-button gap + the bit of bottom shadow that dips into the L/R gap
    fill(209, 2384, 385, 2570, 197, 2569)
    fill(228, 2570, 356, 2593, 197, 2569)
    # down button — center gap below L/R, down to the canvas bottom
    fill(219, 2683, 376, 2835, 197, 2833)


man: dict = {
    "scale": SCALE,
    "design": {"w": round(PW * SCALE), "h": round(PH * SCALE)},
}

# --- static, pre-flattened layers (cached offscreen by the engine) ---
man["back"] = entry_full(
    "back.png",
    flatten(
        [
            top("background_claw_machine"),
            top("plush_line_7"),
            top("plush_line_6"),
            top("plush_line_3 copy"),
        ]
    ),
)
man["frontPlush"] = entry_full(
    "front-plush.png",
    flatten([top("plush_line_3"), top("plush_line_2"), top("plush_line_1")]),
)
frame_img = flatten([top("front_claw_machine")])
remove_vertical_arrows(frame_img)  # flat 2D — retire up + down from the D-pad art
man["frame"] = entry_full("frame.png", frame_img)

# --- moving sprites ---
man["trolley"] = entry_sprite("trolley.png", top("claw_top_machine"))
man["clawOpen"] = entry_sprite("claw-open.png", find(psd, "claw_open"))
man["clawClosed"] = entry_sprite("claw-closed.png", find(psd, "claw_closed"))

HELD = {
    "D": "claw_plush_D",
    "A": "claw_plush_A",
    "E": "claw_plush_E",
    "B": "claw_plush_B",
    "A2": "claw_plush_A_2",
    "K": "claw_plush_K",
    "excl": "claw_plush_!",
}
man["clawPlush"] = {
    key: entry_sprite(f"claw-plush-{key}.png", find(psd, layer))
    for key, layer in HELD.items()
}

# --- winner overlay (cropped to content, positioned by offset) ---
cb = top("congratulation_board")
man["winBoard"] = entry_cropped(
    "win-board.png",
    flatten([find(cb, "Layer 2 copy"), find(cb, "CONGRATULATION_BOARD")]),
)

# --- lit control overlays (also define the hit-zones) ---
ctl = top("control_button")
man["controls"] = {
    "drop": entry_sprite("ctl-drop-on.png", find(ctl, "button_on")),
    "forward": entry_sprite("ctl-forward-on.png", find(ctl, "forward")),
    "backward": entry_sprite("ctl-backward-on.png", find(ctl, "backward")),
    "left": entry_sprite("ctl-left-on.png", find(ctl, "left")),
    "right": entry_sprite("ctl-right-on.png", find(ctl, "right")),
}

# Lossy palette compression (256 colors + per-index alpha). Pixel art tolerates
# this extremely well — roughly 85% smaller with no visible loss — which keeps
# WhatsApp / webview loads light. Set QUANTIZE=0 to keep full-color PNGs.
if os.environ.get("QUANTIZE", "1") == "1":
    for p in OUT.glob("*.png"):
        im = Image.open(p).convert("RGBA")
        im.quantize(
            colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
        ).save(p, optimize=True)

# Trailing newline so the output matches Prettier and re-exports don't churn the diff.
(OUT / "manifest.json").write_text(json.dumps(man, indent=2) + "\n")

total = sum(p.stat().st_size for p in OUT.glob("*.png"))
print(f"scale={SCALE}  design={man['design']['w']}x{man['design']['h']}")
print(f"wrote {len(list(OUT.glob('*.png')))} PNGs + manifest.json -> {OUT}")
print(f"total PNG weight: {total / 1024:.0f} KB")
