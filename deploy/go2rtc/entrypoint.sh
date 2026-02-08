#!/bin/sh
set -e

# Verify FFmpeg is available
if ! command -v ffmpeg > /dev/null 2>&1; then
    echo "ERROR: FFmpeg not found"
    exit 1
fi

echo "FFmpeg version: $(ffmpeg -version | head -n1)"
echo "go2rtc version: $(go2rtc --version 2>&1 || echo 'unknown')"

# Substitute environment variables in config so PatchConfig can parse it
CONFIG="/etc/go2rtc/go2rtc.yaml"
if [ -f "$CONFIG" ] && command -v envsubst > /dev/null 2>&1; then
    envsubst < "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "Resolved env vars in $CONFIG"
fi

echo "Starting go2rtc..."
exec "$@"
