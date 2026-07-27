#!/usr/bin/env python3
"""Export the claw machine PSD (V3) -> public/games/claw/*.png + manifest.json.

PSD -> runtime pipeline, stage 1 of 2 (ADR 0003). Needs the pinned deps in
scripts/requirements.txt and the source art, which is gitignored under
`intake/` (never public/ — a 38 MB PSD must not ship as a static asset):

  intake/claw_machine_clean_V3.psd
  intake/WINNER.png        (finished win board, delivered by Daidai)
  intake/TRY AGAIN.png     (transparent pixel text, delivered by Daidai)

Full reproduction of the deployed asset set:

  pip install -r scripts/requirements.txt
  python3 scripts/export-claw-layers.py
  python3 scripts/rescale-claw-assets.py --factor 0.525 --quality 74

Stage 1 writes full-res PNGs + manifest; stage 2 rescales to the shipped
WebP set and budget-checks it (non-destructive verification lives in
scripts/check-claw-assets.mjs, run by CI).

V3 layer map (2026-07-25 delivery). Layering is baked into the export so the
engine draws flat images, not PSD groups:
  back        = cabinet + WALL plush rows 4/5/6 (scenery, never occluders)
  row1/2/3    = plush_line_1..3, the PLAYABLE station rows (each exported
                separately; all draw BEHIND the claw assembly)
  frame       = foreground cabinet + 4-direction control panel (transparent window)
  trolley     = rail head (moves horizontally with the claw)
  claw        = open / closed / very-open(win release) / 7 held variants
  fall-N      = 6 authored frames of the prize dropping into the chute
  win-board   = WINNER! overlay (delivered PNG)
  try-again   = TRY AGAIN! overlay (delivered PNG, tight-cropped here)
  ctl-*-on    = lit button overlays shown on press (also define hit zones)

NOTE psd_tools group .composite() pulls in skimage, which breaks under
NumPy 2.x in this environment — every export below uses layer .topil(),
compositing with Pillow ourselves.
"""

import json
import os
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

REPO = Path(__file__).resolve().parent.parent
INTAKE = REPO / "intake"
PSD_PATH = Path(
    os.environ.get("PSD_PATH", str(INTAKE / "claw_machine_clean_V3.psd"))
)
WINNER_PATH = Path(os.environ.get("WINNER_PATH", str(INTAKE / "WINNER.png")))
TRY_AGAIN_PATH = Path(
    os.environ.get("TRY_AGAIN_PATH", str(INTAKE / "TRY AGAIN.png"))
)
SO_CLOSE_PATH = Path(
    os.environ.get("SO_CLOSE_PATH", str(INTAKE / "so_close.png"))
)
OUT = Path(os.environ.get("OUT", str(REPO / "public" / "games" / "claw")))
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


def layer_image(node):
    """(RGBA image, (left, top)) via topil so HIDDEN layers still export.
    Groups are walked leaf-first and composited with Pillow (psd_tools'
    group composite needs skimage, which NumPy 2.x breaks here)."""
    if node.is_group():
        canvas = Image.new("RGBA", (PW, PH), (0, 0, 0, 0))
        # PSD children iterate top-of-stack first; composite bottom-up.
        for child in reversed(list(node)):
            img, (x, y) = layer_image(child)
            if img is not None:
                safe_composite(canvas, img, x, y)
        bb = canvas.getbbox()
        if bb is None:
            return None, (0, 0)
        return canvas.crop(bb), (bb[0], bb[1])
    img = node.topil()
    if img is None:
        return None, (0, 0)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    b = node.bbox
    return img, (b[0], b[1])


def safe_composite(canvas: Image.Image, img: Image.Image, x: int, y: int) -> None:
    """alpha_composite tolerating negative offsets + canvas overflow (the
    frame layer is authored larger than the canvas)."""
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
        img, (x, y) = layer_image(n)
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
    img, (x, y) = layer_image(node)
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
    """Crop a full-canvas composite to its content bbox and record the
    offset. The plush-row overlays are narrow bands on a 1792x2835 canvas —
    shipping them full-canvas wasted ~55 KB of transfer and ~8 MiB of
    decoded memory against a tight budget (ADR 0002)."""
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


def entry_image(filename: str, img: Image.Image, x: int, y: int) -> dict:
    """A prepared image placed at an explicit authored offset."""
    img = scaled(img)
    img.save(OUT / filename)
    return {
        "src": filename,
        "x": round(x * SCALE),
        "y": round(y * SCALE),
        "w": img.width,
        "h": img.height,
    }


man: dict = {
    "scale": SCALE,
    "design": {"w": round(PW * SCALE), "h": round(PH * SCALE)},
}

# --- static, pre-flattened layers (cached offscreen by the engine) ---
# Depth occlusion (Daidai): a descending claw must disappear BEHIND the
# plush rows in front of its aimed depth. Back row hides behind mid+front,
# front row only behind the front rows.
# DEPTH STATIONS (Daidai 2026-07-27): rows 1/2/3 are the PLAYABLE rows —
# the claw assembly steps between them, and each exports SEPARATELY so
# the renderer can align the claw with its station's row. Rows 4/5 are
# "on the wall" per Daidai (useless as gameplay rows) and fold into the
# back scenery with row 6. Z-order rule stands: rows stay BEHIND the claw.
man["back"] = entry_full(
    "back.png",
    flatten([
        top("background_claw_machine"),
        top("plush_line_6"),
        top("plush_line_5"),
        top("plush_line_4"),
    ]),
)
man["row3"] = entry_cropped("row3.png", flatten([top("plush_line_3")]))
man["row2"] = entry_cropped("row2.png", flatten([top("plush_line_2")]))
man["row1"] = entry_cropped("row1.png", flatten([top("plush_line_1")]))
# V3 ships the 4-direction panel (LEFT/RIGHT/FORWARD/BACK + DROP) — Simon's
# depth request, confirmed by Daidai 2026-07-25. No arrow removal needed.
man["frame"] = entry_full(
    "frame.png", flatten([top("front_claw_machine_4_buttons")])
)

# --- moving sprites ---
man["trolley"] = entry_sprite("trolley.png", top("claw_top_machine"))
man["clawOpen"] = entry_sprite("claw-open.png", find(psd, "claw_open"))
man["clawClosed"] = entry_sprite("claw-closed.png", find(psd, "claw_closed"))
# Authored wide-open claw for the win release (prize falls straight down).
man["clawRelease"] = entry_sprite(
    "claw-release.png", find(psd, "very_open_claw_winning")
)

# Exactly the keys the engine can aim at (ROW_KEYS_BY_STATION, validated by
# assets.ts REQUIRED_PLUSH). The PSD also carries `claw_plush_!`, which no aim
# row can select — shipping it cost ~17 KB of a tight budget for a sprite the
# player could never see.
HELD = {
    "D": "claw_plush_D",
    "A": "claw_plush_A",
    "E": "claw_plush_E",
    "B": "claw_plush_B",
    "A2": "claw_plush_A_2",
    "K": "claw_plush_K",
}
man["clawPlush"] = {
    key: entry_sprite(f"claw-plush-{key}.png", find(psd, layer))
    for key, layer in HELD.items()
}

# --- authored prize-fall frames (top of the chute -> in the box) ---
FALL_LAYERS = [
    "Layer 15 copy",
    "Layer 10",
    "Layer 12 copy",
    "Layer 11 copy",
    "Layer 14 copy",
    "hf_20260615_171108_4ac60bc0-8d0e-472b-8484-268059ef9028 copy",
]
fall_group = top("plush_fall_winning")
man["fallFrames"] = [
    entry_sprite(f"fall-{i}.png", find(fall_group, name))
    for i, name in enumerate(FALL_LAYERS)
]

# --- delivered overlays (Daidai PNGs, not PSD layers) ---
def load_cropped(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    bb = img.getbbox()
    return img.crop(bb) if bb else img


# WINNER: finished board, centered over the cabinet window. Downscaled hard
# — it is delivered at 4280px wide against a 1792px canvas.
win = load_cropped(WINNER_PATH)
win_w = round(PW * 0.86)
win = win.resize((win_w, round(win.height * win_w / win.width)), Image.LANCZOS)
man["winBoard"] = entry_image(
    "win-board.png", win, (PW - win.width) // 2, round(PH * 0.30)
)

# TRY AGAIN: transparent pixel text (the "black canvas" was Slack rendering
# transparency). Tight-cropped here so the sprite carries no dead margin.
try_again = load_cropped(TRY_AGAIN_PATH)
ta_w = round(PW * 0.62)
try_again = try_again.resize(
    (ta_w, round(try_again.height * ta_w / try_again.width)), Image.LANCZOS
)
man["tryAgain"] = entry_image(
    "try-again.png", try_again, (PW - try_again.width) // 2, round(PH * 0.36)
)

# SO CLOSE: delivered board (2026-07-27). Its transparency carries speckle
# NOISE, so a plain getbbox() grabs the whole frame — crop by DENSITY
# (rows/cols with a real run of solid pixels), then hard-threshold alpha.
def load_density_cropped(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size
    cols = [0] * w
    rows = [0] * h
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 200:
                cols[x] += 1
                rows[y] += 1
    xs = [x for x in range(w) if cols[x] > 12]
    ys = [y for y in range(h) if rows[y] > 12]
    out = Image.new("RGBA", (max(xs) - min(xs) + 1, max(ys) - min(ys) + 1))
    for y in range(min(ys), max(ys) + 1):
        for x in range(min(xs), max(xs) + 1):
            r, g, b, a = px[x, y]
            if a > 140:
                out.putpixel((x - min(xs), y - min(ys)), (r, g, b, 255))
    return out


so_close = load_density_cropped(SO_CLOSE_PATH)
sc_w = round(PW * 0.62)
so_close = so_close.resize(
    (sc_w, round(so_close.height * sc_w / so_close.width)), Image.LANCZOS
)
man["soClose"] = entry_image(
    "so-close.png", so_close, (PW - so_close.width) // 2, round(PH * 0.41)
)

# --- lit control overlays (also define the hit-zones) ---
ctl = top("control_button")
arrows = find(ctl, "direction_arrows_on")
man["controls"] = {
    "drop": entry_sprite("ctl-drop-on.png", find(ctl, "button_on")),
    "forward": entry_sprite("ctl-forward-on.png", find(psd, "forward")),
    "backward": entry_sprite("ctl-backward-on.png", find(psd, "backward")),
    "left": entry_sprite("ctl-left-on.png", find(arrows, "left")),
    "right": entry_sprite("ctl-right-on.png", find(arrows, "right")),
}

# Lossy palette compression (256 colors + per-index alpha). Pixel art tolerates
# this extremely well — roughly 85% smaller with no visible loss.
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
