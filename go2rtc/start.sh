#!/bin/bash
# go2rtc startup script

cd "$(dirname "$0")"

echo "Starting go2rtc..."
echo "Web UI: http://localhost:1984"
echo "WebRTC: port 8555"
echo ""

./go2rtc -config go2rtc.yaml
