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

Docker Compose deployment for the Next.js app. Meditation audio is served by
the app over plain HTTP with range requests (`src/lib/stream-file.ts`); go2rtc
was removed under migration decision D1 and no streaming sidecar remains.

## Architecture

```
Client (beacon.altermundi.net)
  ↓ HTTPS
Host Nginx (SSL, reverse proxy)
  └── / → Next.js (port 3003)
```

## Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| `app` | harmonic-beacon | 3003:3000 | Next.js web app |

## Prerequisites

- Docker + Docker Compose v2
- Host nginx with SSL (Certbot) for `beacon.altermundi.net`
- Zitadel OIDC application at `auth.altermundi.net`
- Meditation files uploaded via Provider Studio and approved by admin

## Deployment

Deployment is automated via GitHub Actions (`.github/workflows/deploy.yml`):

1. Push to `release` branch triggers deploy
2. Docker Compose builds the services
3. Prisma migrations run automatically
4. Health checks verify the services are up

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

## Monitoring

```bash
# Container status
docker compose ps

# Logs
docker compose logs -f app

# Health checks
curl -f http://localhost:3003
```

## Troubleshooting

### Auth redirects failing
- Verify Zitadel OIDC app redirect URI: `https://beacon.altermundi.net/api/auth/callback/zitadel`
- Check `AUTH_SECRET` is set
- Verify `AUTH_TRUST_HOST=true`

### No audio
- Check meditation files exist: `ls /mnt/n8n-data/harmonic-beacon/meditations/`
- Check app logs: `docker compose logs app`
- Verify the file resolves: `curl -I -H 'Range: bytes=0-1' http://localhost:3003/api/meditations/<id>/audio`
