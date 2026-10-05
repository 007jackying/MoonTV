#!/usr/bin/env bash
# Regenerate the local HLS fixtures used by the e2e / perf harness.
# Produces a 720p and 1080p VOD HLS ladder with a master playlist, so the
# cheap measurement primitive has a real RESOLUTION= attribute to parse.
#
#   bash tests/e2e/make-media.sh             # H.264 + AAC in MPEG-TS (default)
#   CODEC=vp9 bash tests/e2e/make-media.sh   # VP9 + Opus in fMP4
#
# Use CODEC=vp9 when the test browser cannot decode H.264: open-source Chromium
# builds (including some Playwright/CI images) ship without proprietary codecs,
# so `document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')`
# returns '' and no frame ever renders. Playlists keep the same names
# (master.m3u8 / v0.m3u8), so nothing else in the harness changes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/media"
CODEC="${CODEC:-h264}"

case "$CODEC" in
  h264)
    VIDEO=(-c:v libx264 -preset ultrafast -tune zerolatency)
    AUDIO=(-c:a aac)
    SEGMENTS=(-hls_segment_type mpegts)
    SEG_EXT=ts
    ;;
  vp9)
    VIDEO=(-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1)
    AUDIO=(-c:a libopus)
    SEGMENTS=(-hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4)
    SEG_EXT=m4s
    ;;
  *)
    echo "unknown CODEC=$CODEC (known: h264, vp9)" >&2
    exit 1
    ;;
esac

gen_variant() {
  local w=$1 h=$2 bitrate=$3 dir="$OUT/$4"
  mkdir -p "$dir"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=${w}x${h}:rate=25:duration=12" \
    -f lavfi -i "sine=frequency=440:duration=12" \
    "${VIDEO[@]}" -pix_fmt yuv420p -g 50 -b:v "$bitrate" \
    "${AUDIO[@]}" -b:a 96k -ac 2 \
    -f hls -hls_time 2 -hls_playlist_type vod "${SEGMENTS[@]}" \
    -hls_segment_filename "$dir/seg_%03d.$SEG_EXT" \
    -master_pl_name "master.m3u8" -var_stream_map "v:0,a:0" \
    "$dir/v%v.m3u8"
  echo "  generated $dir"
}

echo "Generating $CODEC HLS fixtures in $OUT ..."
rm -rf "$OUT/720p" "$OUT/1080p"
gen_variant 1280 720 1200k 720p
gen_variant 1920 1080 3000k 1080p
echo "Done."
