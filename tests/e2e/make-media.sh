#!/usr/bin/env bash
# Regenerate the local HLS fixtures used by the e2e / perf harness.
# Produces a 720p and 1080p VOD HLS ladder with a master playlist, so the
# cheap measurement primitive has a real RESOLUTION= attribute to parse.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/media"

gen_variant() {
  local w=$1 h=$2 bitrate=$3 dir="$OUT/$4"
  mkdir -p "$dir"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=${w}x${h}:rate=25:duration=12" \
    -f lavfi -i "sine=frequency=440:duration=12" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 50 -b:v "$bitrate" \
    -c:a aac -b:a 96k -ac 2 \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type mpegts \
    -hls_segment_filename "$dir/seg_%03d.ts" \
    -master_pl_name "master.m3u8" -var_stream_map "v:0,a:0" \
    "$dir/v%v.m3u8"
  echo "  generated $dir"
}

echo "Generating HLS fixtures in $OUT ..."
rm -rf "$OUT/720p" "$OUT/1080p"
gen_variant 1280 720 1200k 720p
gen_variant 1920 1080 3000k 1080p
echo "Done."
