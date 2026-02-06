#!/bin/sh
set -e

# Verify FFmpeg is available
if ! command -v ffmpeg > /dev/null 2>&1; then
    echo "ERROR: FFmpeg not found"
    exit 1
fi

echo "FFmpeg version: $(ffmpeg -version | head -n1)"
echo "go2rtc version: $(go2rtc --version 2>&1 || echo 'unknown')"
echo "Starting go2rtc..."

exec "$@"
