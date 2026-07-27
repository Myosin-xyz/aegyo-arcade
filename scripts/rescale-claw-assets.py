#!/usr/bin/env python3
"""Uniformly rescale the claw sprite set and convert to WebP.

TECH_SPEC §7.1.4/§7.1.5 + ADR 0002: WebP fixes transfer size; only smaller
DIMENSIONS fix decoded memory. Engine tunables are design-space fractions,
so a uniform rescale of images + manifest keeps everything aligned.

Usage:  python3 scripts/rescale-claw-assets.py [--factor 0.75] [--quality 90]
Requires: Pillow
"""

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image

ASSET_DIR = Path(
    os.environ.get(
        "ASSET_DIR",
        str(Path(__file__).resolve().parent.parent / "public" / "games" / "claw"),
    )
)

# Dense full-bleed cabinet art compresses harder with no visible loss (A/B'd
# at 2x zoom: plush faces, DAEBAK lettering and shelf edges are identical at
# q58 vs q74). Sprites, overlay TEXT (WINNER / TRY AGAIN) and the small
# controls keep the high quality where crispness actually reads.
BACKGROUND_QUALITY = 55
BACKGROUND_SRCS = {
    "back.png",
    "row1.png",
    "row2.png",
    "row3.png",
    "frame.png",
    # The two big BOARDS are dense delivered art like the cabinet — q58
    # A/B'd clean there; the budget needs them out of the sprite class.
    "win-board.png",
    "so-close.png",
}


def scale_rect(rect: dict, f: float, dims: dict) -> None:
    src = rect["src"]
    rect["x"] = round(rect["x"] * f)
    rect["y"] = round(rect["y"] * f)
    # Width/height must equal the resized image dims exactly (no stretch).
    rect["w"], rect["h"] = dims[src]
    rect["src"] = str(Path(src).with_suffix(".webp"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--factor", type=float, default=0.75)
    parser.add_argument("--quality", type=int, default=90)
    args = parser.parse_args()
    f = args.factor

    manifest_path = ASSET_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text())

    # Collect every rect ({src,x,y,w,h}) wherever it appears in the manifest.
    rects: list[dict] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            if "src" in node and all(k in node for k in ("x", "y", "w", "h")):
                rects.append(node)
            else:
                for value in node.values():
                    walk(value)
        elif isinstance(node, list):
            # e.g. manifest.fallFrames — a LIST of rects. Without this the
            # frames silently shipped at full resolution (caught by
            # check-claw-assets.mjs, which measures the directory, not the
            # manifest).
            for value in node:
                walk(value)

    walk(manifest)

    # Resize each unique source image once; record final dims.
    dims: dict[str, tuple[int, int]] = {}
    decoded_bytes = 0
    transfer_bytes = 0
    for src in sorted({r["src"] for r in rects}):
        png_path = ASSET_DIR / src
        img = Image.open(png_path).convert("RGBA")
        new_size = (max(1, round(img.width * f)), max(1, round(img.height * f)))
        resized = img.resize(new_size, Image.LANCZOS)
        webp_path = png_path.with_suffix(".webp")
        quality = (
            BACKGROUND_QUALITY if src in BACKGROUND_SRCS else args.quality
        )
        resized.save(webp_path, "WEBP", quality=quality, method=6)
        dims[src] = new_size
        decoded_bytes += new_size[0] * new_size[1] * 4
        transfer_bytes += webp_path.stat().st_size
        png_path.unlink()
        print(
            f"{src:>24} {img.width}x{img.height} -> {new_size[0]}x{new_size[1]}"
            f"  ({webp_path.stat().st_size / 1024:.0f} KB webp)"
        )

    for rect in rects:
        scale_rect(rect, f, dims)

    manifest["scale"] = manifest.get("scale", 1) * f
    manifest["design"]["w"] = round(manifest["design"]["w"] * f)
    manifest["design"]["h"] = round(manifest["design"]["h"] * f)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"\ndesign: {manifest['design']['w']}x{manifest['design']['h']}")
    print(f"decoded RGBA total: {decoded_bytes / 1048576:.1f} MiB")
    print(f"transfer total (webp): {transfer_bytes / 1024:.0f} KB")
    budget_ok = decoded_bytes <= 32 * 1048576 and transfer_bytes <= 350 * 1024
    print(f"budgets (<=32 MiB decoded, <=350 KB transfer): {'PASS' if budget_ok else 'FAIL'}")
    return 0 if budget_ok else 1


if __name__ == "__main__":
    sys.exit(main())
