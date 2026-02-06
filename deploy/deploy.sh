#!/bin/bash
# Deployment script for Harmonic Beacon Streaming

set -e

# Configuration
DEPLOY_PATH="/opt/harmonic-beacon-streaming"
STORAGE_PATH="/mnt/raid/storage/harmonic-beacon"
SERVICE_NAME="harmonic-beacon-streaming"

echo "🚀 Deploying Harmonic Beacon Streaming Service"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo ./deploy.sh)"
    exit 1
fi

# Create deployment directory
echo "📁 Creating deployment directory..."
mkdir -p "$DEPLOY_PATH"

# Copy files
echo "📋 Copying deployment files..."
cp -r docker-compose.yml go2rtc nginx "$DEPLOY_PATH/"
cp harmonic-beacon-streaming.service /etc/systemd/system/

# Check for .env file
if [ ! -f "$DEPLOY_PATH/.env" ]; then
    echo "⚠️  No .env file found. Copying example..."
    cp .env.example "$DEPLOY_PATH/.env"
    echo "❗ Please edit $DEPLOY_PATH/.env with your production values"
fi

# Create storage directory structure
echo "📂 Setting up storage directories..."
mkdir -p "$STORAGE_PATH"/{meditations/{providers,metadata,thumbnails},sessions,cache/transcoded}

# Set permissions
echo "🔐 Setting permissions..."
chown -R 1000:1000 "$STORAGE_PATH"
chmod -R 755 "$STORAGE_PATH/meditations"
chmod -R 775 "$STORAGE_PATH/sessions"
chmod -R 775 "$STORAGE_PATH/cache"

# Verify SSL certificates
if [ ! -f "$DEPLOY_PATH/nginx/ssl/fullchain.pem" ]; then
    echo "⚠️  SSL certificates not found in nginx/ssl/"
    echo "   Please copy your SSL certificates:"
    echo "   - fullchain.pem"
    echo "   - privkey.pem"
fi

# Build Docker images
echo "🐳 Building Docker images..."
cd "$DEPLOY_PATH"
docker compose build

# Enable and start service
echo "🔧 Enabling systemd service..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $DEPLOY_PATH/.env with your production values"
echo "  2. Copy SSL certificates to $DEPLOY_PATH/nginx/ssl/"
echo "  3. Update nginx.conf with your domain name"
echo "  4. Update go2rtc.yaml PUBLIC_IP with your server IP"
echo "  5. Configure firewall: sudo ufw allow 80,443,8554/tcp && sudo ufw allow 8554/udp"
echo "  6. Start the service: sudo systemctl start $SERVICE_NAME"
echo "  7. Check status: sudo systemctl status $SERVICE_NAME"
echo ""
