# Harmonic Beacon Streaming Deployment

Production deployment for go2rtc meditation streaming service.

## Components

- **go2rtc**: Audio streaming server with WebRTC support
- **Nginx**: Reverse proxy with SSL termination
- **Systemd**: Service management

## Quick Start

### 1. Prerequisites

```bash
# Server requirements
- Docker + Docker Compose v2
- SSL certificates
- Public IP for WebRTC
- Firewall access to ports 80, 443, 8554 (TCP/UDP)
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your values:
# - PUBLIC_IP: Your server's public IP
# - STORAGE_PATH: Meditation files location
# - Zitadel credentials
```

### 3. SSL Certificates

```bash
# Copy your SSL certificates
cp /path/to/fullchain.pem nginx/ssl/
cp /path/to/privkey.pem nginx/ssl/
```

### 4. Update Domains

Edit these files with your domain:
- `nginx/nginx.conf` - Replace `stream.harmonic-beacon.com`
- `go2rtc/go2rtc.yaml` - Update CORS origins

### 5. Deploy

```bash
sudo ./deploy.sh
```

### 6. Start Service

```bash
sudo systemctl start harmonic-beacon-streaming
sudo systemctl status harmonic-beacon-streaming
```

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8554/tcp
sudo ufw allow 8554/udp
```

## File Structure

```
/opt/harmonic-beacon-streaming/     # Deployment files
/mnt/raid/storage/harmonic-beacon/  # Meditation files
  ├── meditations/providers/        # Provider uploads
  ├── sessions/                     # Session recordings
  └── cache/                        # Transcoded cache
```

## Monitoring

```bash
# View logs
sudo journalctl -u harmonic-beacon-streaming -f

# Check containers
docker ps

# Test health
curl https://stream.harmonic-beacon.com/health
```

## Troubleshooting

### WebRTC not connecting
- Verify PUBLIC_IP is set correctly
- Check firewall allows UDP 8554
- Test STUN connectivity

### Stream not playing
- Check go2rtc logs: `docker logs harmonic-beacon-go2rtc`
- Verify file path is accessible
- Ensure FFmpeg is working

### Auth errors
- Verify Zitadel configuration
- Check token expiration
- Review Nginx logs
