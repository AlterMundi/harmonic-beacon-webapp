#!/bin/bash
# Setup nginx for Harmonic Beacon on inference-public
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
echo "Nginx is configured to proxy beacon.altermundi.net -> localhost:3003"
echo ""
echo "Next steps:"
echo "1. Ensure DNS points beacon.altermundi.net to this server"
echo "2. For HTTPS, run: certbot --nginx -d beacon.altermundi.net"
echo "3. Deploy the app: merge PR to 'release' branch"
