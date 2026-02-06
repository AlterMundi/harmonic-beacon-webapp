#!/bin/bash
# Pre-transcode meditation files from m4a to Opus .ogg
# Run at deploy time before starting go2rtc
#
# Usage: ./transcode-meditations.sh [meditations_directory]
#
# Converts .m4a files to .ogg (Opus, 64kbps, 20ms page duration)
# go2rtc can then serve these with #audio=copy (no runtime transcoding)

set -e

MEDITATIONS_DIR="${1:-/mnt/raid1/harmonic-beacon/meditations}"

if [ ! -d "$MEDITATIONS_DIR" ]; then
    echo "Meditations directory not found: $MEDITATIONS_DIR"
    echo "Creating it..."
    mkdir -p "$MEDITATIONS_DIR"
fi

if ! command -v ffmpeg > /dev/null 2>&1; then
    echo "ERROR: ffmpeg not found. Install with: apt install ffmpeg"
    exit 1
fi

TRANSCODED=0
SKIPPED=0

for m4a in "$MEDITATIONS_DIR"/*.m4a; do
    [ -f "$m4a" ] || continue
    ogg="${m4a%.m4a}.ogg"

    if [ ! -f "$ogg" ] || [ "$m4a" -nt "$ogg" ]; then
        echo "Transcoding: $(basename "$m4a") -> $(basename "$ogg")"
        ffmpeg -y -i "$m4a" -c:a libopus -b:a 64k -vn -page_duration 20000 "$ogg" 2>/dev/null
        TRANSCODED=$((TRANSCODED + 1))
    else
        echo "Already transcoded: $(basename "$ogg")"
        SKIPPED=$((SKIPPED + 1))
    fi
done

echo ""
echo "Done: $TRANSCODED transcoded, $SKIPPED already up-to-date"
