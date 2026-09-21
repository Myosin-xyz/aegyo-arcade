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

# The 2026-09-21 delivery is full 3-4 minute songs, which would cost about
# 2.5 MB per game against a 300 KB art budget. Each is cut to a bar-aligned
# loop the length of the 30-second originals. START and DURATION come from a
# similarity search: what follows the end has to match what follows the start,
# so the restart continues the phrase. The gain is one constant value, not
# dynamic loudnorm, so the level is identical on both sides of the seam.
encode_loop() {
  local source_name="$1"
  local output_name="$2"
  local start="$3"
  local duration="$4"
  local trim="atrim=start=${start}:duration=${duration},asetpts=N/SR/TB"
  local stats input_i input_tp gain fade_out
  stats="$(ffmpeg -nostdin -hide_banner -i "$source_dir/$source_name" \
    -af "${trim},loudnorm=I=-20:TP=-2:LRA=7:print_format=json" \
    -f null - 2>&1)"
  input_i="$(sed -n 's/.*"input_i" : "\(.*\)".*/\1/p' <<<"$stats")"
  input_tp="$(sed -n 's/.*"input_tp" : "\(.*\)".*/\1/p' <<<"$stats")"
  if [[ -z "$input_i" || -z "$input_tp" ]]; then
    echo "could not measure loudness for $source_name" >&2
    return 1
  fi
  # Reach -20 LUFS unless that would push the true peak above -2 dBTP.
  gain="$(awk -v i="$input_i" -v tp="$input_tp" \
    'BEGIN { g = -20 - i; cap = -2 - tp; if (cap < g) g = cap; printf "%.2f", g }')"
  fade_out="$(awk -v d="$duration" 'BEGIN { printf "%.4f", d - 0.008 }')"
  ffmpeg -nostdin -v error -y \
    -i "$source_dir/$source_name" \
    -map_metadata -1 \
    -af "${trim},volume=${gain}dB,afade=t=in:d=0.008,afade=t=out:st=${fade_out}:d=0.008" \
    -ar 44100 -ac 2 -c:a libmp3lame -b:a 112k \
    "$output_dir/$output_name"
}

# Eight lazy catalog tracks from the 2026-08-01 delivery. Hangman, Freebie and
# the rest keep theirs; the ninth handoff file remains an archived alternate.
encode "Arcade_Heartbeat_2026-08-01T212624 (1).mp3" "claw.mp3"
encode "Arcade_Heartbeat_2026-08-01T212624.mp3" "snake.mp3"
encode "Arcade_Heartbeat_2026-08-01T212740.mp3" "jumper.mp3"
encode "K-Pop_Pixel_Party_2026-08-01T212741.mp3" "flappy.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212412.mp3" "hangman.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212624.mp3" "freebie.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212625.mp3" "frogger.mp3"
encode "Pixel_Pop_Paradise_2026-08-01T212740.mp3" "this-or-that.mp3"

# Four loops from Dai Dai's 2026-09-21 delivery, one style per game. These
# games had no track of their own: Perfect Toss was silent and the other three
# borrowed freebie.mp3 or hangman.mp3. Starlight Pixels, Pixel Burglar and Lofi
# Pixel Rest are same-prompt variants kept as archived alternates.
#           source                                     output                 start    duration
encode_loop "Pixel_Hearts_2026-09-21T163226.mp3"        "perfect-toss.mp3"     92.357   28.805 # 12 bars @ 100 BPM
encode_loop "Pixel_Heist_2026-09-21T163307.mp3"         "aegyo-pop.mp3"        40.739   29.999 # 16 bars @ 128 BPM
encode_loop "Pixel_Quest_Horizon_2026-09-21T163345.mp3" "photocard-stack.mp3"  46.567   29.538 # 16 bars @ 130 BPM
encode_loop "Pixel_Puzzle_Peace_2026-09-21T163425.mp3"  "bias-match.mp3"       56.436   33.883 # 12 bars @ 85 BPM

echo "Exported normalized game music to $output_dir"
