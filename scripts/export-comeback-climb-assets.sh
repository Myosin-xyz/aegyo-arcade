#!/usr/bin/env bash
set -euo pipefail

# Deterministic intake transform for DaiDai's Comeback Climb delivery.
# The raw archive stays gitignored; only optimized runtime assets ship.
SOURCE_DIR="${COMEBACK_CLIMB_SOURCE:-comeback-climb/assets}"
OUTPUT_DIR="public/games/jumper"

if ! command -v cwebp >/dev/null 2>&1; then
  echo "cwebp is required (brew install webp)" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

assets=(
  cd drone heart_bonus heart_small hero micro note_cyan note_gold
  photocard photocard_cracked plat_cyan plat_pink speaker
)

for name in "${assets[@]}"; do
  source_file="$SOURCE_DIR/$name.png"
  if [[ ! -f "$source_file" ]]; then
    echo "missing Comeback Climb asset: $source_file" >&2
    exit 1
  fi
  cwebp -quiet -mt -q 82 -alpha_q 100 -metadata none \
    "$source_file" -o "$OUTPUT_DIR/$name.webp"
done

echo "Exported ${#assets[@]} Comeback Climb assets to $OUTPUT_DIR"
