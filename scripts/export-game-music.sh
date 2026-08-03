#!/usr/bin/env bash
set -euo pipefail

source_dir="${MUSIC_SOURCE_DIR:-music_aegyo_game}"
output_dir="public/games/music"
mkdir -p "$output_dir"

encode() {
  local source_name="$1"
  local output_name="$2"
  ffmpeg -nostdin -v error -y \
    -i "$source_dir/$source_name" \
    -map_metadata -1 \
    -af "loudnorm=I=-20:TP=-2:LRA=7" \
    -ar 44100 -ac 2 -c:a libmp3lame -b:a 112k \
    "$output_dir/$output_name"
}

# One lazy track per game. The ninth handoff file remains an archived
# alternate rather than shipping an unreferenced asset.
encode "Arcade_Heartbeat_2026-08-01T212624 (1).mp3" "claw.mp3"
encode "Arcade_Heartbeat_2026-08-01T212624.mp3" "snake.mp3"
encode "Arcade_Heartbeat_2026-08-01T212740.mp3" "jumper.mp3"
encode "K-Pop_Pixel_Party_2026-08-01T212741.mp3" "flappy.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212412.mp3" "hangman.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212624.mp3" "freebie.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212625.mp3" "frogger.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212740.mp3" "this-or-that.mp3"

echo "Exported normalized game music to $output_dir"
