# Harmonic Beacon Production Deployment

> **This file is public, and it is a decision nobody has made.** The repository
> has been public since 2026-01-23, so everything below is too: the production
> IP, the CI runner's filesystem path, internal port assignments, and the host
> storage layout. None of it is a secret — the git history was scanned and holds
> no credentials — but together they are a tidy reconnaissance page for anyone
> deciding where to point a scanner.
>
> Three options, and the choice is deliberate either way: keep it public and
> accept that (defensible — the information has limited value on its own),
> genericise it so the runbook survives without the specifics, or move `deploy/`
> to a private ops repository. What should not continue is the current state,
> where it is public because nobody chose. Tracked as TECH_AUDIT Appendix A.3.

Docker Compose deployment for Next.js app + go2rtc meditation streaming.

> **Note on go2rtc.** The migration plan retires it: meditation playback already
> runs over plain HTTP with Range requests, and `loadMeditationFromGo2rtc` in the
> client is dead code that nothing calls. Until that removal lands, go2rtc is
> still deployed and this runbook still describes it — but do not build anything
> new against it. See `docs/CLOUD_MIGRATION_PLAN.md` on the `feat/cloud-migration`
> branch, decision D1.

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

Note where migrations run. CI applies them **on the host, before the containers
start** — they are not part of the compose lifecycle, so `docker compose up`
alone will start an app against an un-migrated database. A manual deploy has to
run the migrate step itself; omitting it is the foot-gun this section used to
have.

```bash
# On the deploy host
cd /home/github-runner/actions-runner/_work/harmonic-beacon-webapp/harmonic-beacon-webapp

# 1. Migrations FIRST, against the host Postgres. Not optional.
DATABASE_URL="postgresql://beacon:<password>@localhost:5432/harmonic_beacon?schema=public" \
  npx prisma migrate deploy

# 2. Build and start
docker compose build --no-cache
docker compose up -d

# 3. Verify — /api/health is a real liveness endpoint; / is a DB-backed page and
#    a poor health signal
curl -f http://localhost:3003/api/health
curl -f http://localhost:3003/api/health/ready    # 503 if the DB is unreachable
curl -f http://127.0.0.1:1984/api
```

## Configuration

### Environment Variables

**There is no `.env` file on the server, and creating one is not how this
deploys.** The deploy workflow writes `/etc/sai-harmonic-beacon/production.env`
from GitHub Secrets (`.github/workflows/deploy.yml`), and both compose services
read it via `env_file`. That file survives container restarts and is owned
`root:github-runner` at mode 0640. `.env.example` documents the variable surface
for local development only.

An earlier version of this section told you to create `.env` at the project root
with these values:

```bash
MEDITATIONS_PATH=/mnt/raid1/harmonic-beacon/meditations   # WRONG on both counts
```

Both halves were wrong and following them breaks the deploy silently: the code
reads **`MEDITATIONS_STORAGE_PATH`**, not `MEDITATIONS_PATH`, and production
mounts **`/mnt/n8n-data/harmonic-beacon/meditations`**, not `/mnt/raid1/...`
(`docker-compose.yml:32,37`). The troubleshooting section further down this file
had the correct path all along, which is how the error survived.

The authoritative list of what must be in `production.env` is the "Persist
secrets to env file" step of the deploy workflow. To add a variable: add it to
GitHub Secrets, add it to that heredoc, and add it to `.env.example` with a
comment.

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
