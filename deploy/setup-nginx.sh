#!/bin/bash
# Setup nginx for Harmonic Beacon on mona
# Run as root: sudo ./setup-nginx.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF="$SCRIPT_DIR/nginx-harmonic-beacon.conf"
SITES_AVAILABLE="/etc/nginx/sites-available/harmonic-beacon"
SITES_ENABLED="/etc/nginx/sites-enabled/harmonic-beacon"

echo "=== Harmonic Beacon Nginx Setup ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo ./setup-nginx.sh)"
    exit 1
fi

# Check if nginx is installed
if ! command -v nginx &> /dev/null; then
    echo "Error: nginx is not installed"
    exit 1
fi

# Copy config
echo "Installing nginx config..."
cp "$NGINX_CONF" "$SITES_AVAILABLE"

# Enable site
echo "Enabling site..."
ln -sf "$SITES_AVAILABLE" "$SITES_ENABLED"

# Test config
echo "Testing nginx config..."
nginx -t

# Reload nginx
echo "Reloading nginx..."
systemctl reload nginx

echo ""
echo "=== Setup Complete ==="
echo "Nginx is configured to proxy live.harmonicbeacon.com -> localhost:3000; LiveKit signaling -> localhost:7880"
echo ""
echo "Validate the existing HTTPS certificate and exact public health/readiness endpoints."
echo "This script does not provision DNS, certificates, application images, or delivery authority."
