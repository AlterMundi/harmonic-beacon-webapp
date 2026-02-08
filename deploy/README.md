# Harmonic Beacon Production Deployment

Docker Compose deployment for Next.js app + go2rtc meditation streaming on `inference-public`.

## Architecture

```
Client (beacon.altermundi.net)
  ↓ HTTPS
Host Nginx (SSL, reverse proxy)
  ├── / → Next.js (port 3003)
  ├── /api/stream/webrtc → go2rtc (port 1984)
  └── /api/stream/streams → go2rtc (port 1984)

WebRTC ICE traffic: UDP/TCP 8555 (direct to go2rtc container)
```

## Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| `app` | harmonic-beacon | 3003:3000 | Next.js web app |
| `go2rtc` | harmonic-beacon-go2rtc | 127.0.0.1:1984, 8555/tcp+udp | WebRTC streaming |

## Prerequisites

- Docker + Docker Compose v2
- Host nginx with SSL (Certbot) for `beacon.altermundi.net`
- Firewall rules for port 8555 TCP/UDP
- Zitadel OIDC application at `auth.altermundi.net`
- Meditation files uploaded via Provider Studio and approved by admin

## Deployment

Deployment is automated via GitHub Actions (`.github/workflows/deploy.yml`):

1. Push to `release` branch triggers deploy
2. Docker Compose builds both services
3. Prisma migrations run automatically
4. Health checks verify both services are up

### Manual deploy

```bash
# On inference-public
cd /home/github-runner/actions-runner/_work/harmonic-beacon-webapp/harmonic-beacon-webapp

# Build and start
docker compose build --no-cache
docker compose up -d

# Verify
curl -f http://localhost:3003
curl -f http://127.0.0.1:1984/api
```

## Configuration

### Environment Variables

Create `.env` at project root (see `.env.example`):

```bash
AUTH_SECRET=<generated-secret>
AUTH_ZITADEL_ID=<oidc-client-id>
AUTH_ZITADEL_ISSUER=https://auth.altermundi.net
MEDITATIONS_PATH=/mnt/raid1/harmonic-beacon/meditations
PUBLIC_IP=131.72.205.6
```

### Nginx

Copy `deploy/nginx-harmonic-beacon.conf` to `/etc/nginx/sites-enabled/` and reload nginx.

### Firewall

```bash
iptables -A INPUT -p tcp --dport 8555 -j ACCEPT
iptables -A INPUT -p udp --dport 8555 -j ACCEPT
```

## Monitoring

```bash
# Container status
docker compose ps

# Logs
docker compose logs -f app
docker compose logs -f go2rtc

# go2rtc streams
curl http://127.0.0.1:1984/api/streams

# Health checks
curl -f http://localhost:3003
curl -f http://127.0.0.1:1984/api
```

## Troubleshooting

### WebRTC not connecting
- Verify port 8555 TCP/UDP is open in iptables
- Check `PUBLIC_IP` env var matches server's public IP
- Test: `curl http://127.0.0.1:1984/api/streams` to verify streams exist

### Auth redirects failing
- Verify Zitadel OIDC app redirect URI: `https://beacon.altermundi.net/api/auth/callback/zitadel`
- Check `AUTH_SECRET` is set
- Verify `AUTH_TRUST_HOST=true`

### No audio
- Check meditation files exist: `ls /mnt/n8n-data/harmonic-beacon/meditations/`
- Check go2rtc logs: `docker compose logs go2rtc`
- Verify streams are configured: `curl http://127.0.0.1:1984/api/streams`
