# Isolated Live staging

This stack exists to accept Live identity and profile work without sharing a
container, database, network, port, environment file or data directory with
the event service. It is not a smaller production stack.

## Fixed isolation boundary

- Compose project: `hb-live-staging`
- Containers: `hb-live-staging-app`, `hb-live-staging-postgres`
- App upstream: host loopback `127.0.0.1:3200`
- Acceptance vhost: host loopback `127.0.0.1:13200`
- Postgres data: `/mnt/beacon-data/live-staging/postgres`
- Networks: `hb_live_staging_database` (internal) and
  `hb_live_staging_app_egress` (app only)
- Environment: `/etc/harmonic-beacon/live-staging.env`, root-owned mode `0600`
- Image: `harmonic-beacon/live-staging:<exact-commit-sha>`

The stack has no LiveKit, playlist bot, tapestry or commerce worker. The
loopback deployment covers landing and health/readiness smoke only. Account
login, profile/display-name and alias acceptance begins after dedicated DNS,
TLS and Account staging are ready. Room and ticket behavior remain covered by
the repository PostgreSQL + browser E2E suite. `/rtc` returns `503`
intentionally. This boundary avoids borrowing event media credentials or
suggesting that remote room audio was tested when it was not.

Beacon Account is default-off. While it is off, every `/api/account/*` entry
route remains dark. `/test-login` and `/api/test-login` are also denied at the
vhost and disabled in the app environment. Enable Account only after
`account-staging.harmonicbeacon.com`,
the confidential `hb-live-staging` client, its secret and the exact callback +
front-channel logout registrations exist. The three exact Account routes are
rate-limited and excluded from access logs; every `/api/account/*` suffix or
unknown route fails closed at Nginx so OAuth codes, state and sid values cannot
fall through the general request log.

## First deployment

Use a clean checkout of the exact commit. Never run these commands from the
production checkout or with the production compose/environment files.

```bash
export STAGING_SHA=<lowercase-40-character-commit>
export BEACON_IMAGE_TAG="$STAGING_SHA"
export BEACON_GIT_SHA="$STAGING_SHA"
export BEACON_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export BEACON_DATABASE_SCHEMA_VERSION="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"

test "$(git rev-parse HEAD)" = "$STAGING_SHA"
test -z "$(git status --porcelain --untracked-files=no)"
test "$(stat -c '%U:%G %a' /etc/harmonic-beacon/live-staging.env)" = "root:root 600"
grep -Fxq 'BEACON_ACCOUNT_ENABLED=false' /etc/harmonic-beacon/live-staging.env

docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env config --quiet
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env up -d postgres
```

Only on a new, empty staging database, restore the synthetic fixture. The
command first proves there are no application tables; it never drops data.

```bash
test "$(docker exec hb-live-staging-postgres psql -U beacon_staging -d beacon_live_staging -Atqc \
  "select count(*) from pg_catalog.pg_tables where schemaname = 'public'")" = 0
docker exec -i hb-live-staging-postgres psql -v ON_ERROR_STOP=1 \
  -U beacon_staging -d beacon_live_staging < db/test-fixture.sql
```

Create a verified backup before every migration. On the first deployment this
captures the restored synthetic fixture; later it captures the prior staging
schema and data. The backup directory is staging-only and root-readable.

```bash
sudo install -d -o root -g root -m 0700 /mnt/beacon-data/live-staging/backups
export BACKUP_PATH="/mnt/beacon-data/live-staging/backups/pre-${STAGING_SHA}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
sudo docker exec hb-live-staging-postgres pg_dump \
  -U beacon_staging -d beacon_live_staging | gzip -9 | sudo tee "$BACKUP_PATH" >/dev/null
sudo chmod 0600 "$BACKUP_PATH"
sudo gzip -t "$BACKUP_PATH"
```

Build, run the reproducible one-shot migration service and start only the
staging app. Compose refuses to start the app unless `migrate` exits zero:

```bash
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env build app
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env \
  up --abort-on-container-exit --exit-code-from migrate migrate
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env up -d app
```

Install `deploy/nginx-live-staging-loopback.conf` under the new, exact site
name, run `nginx -t`, enable it, then reload. Do not edit an existing vhost.

## Smoke

```bash
curl --fail --header 'Host: live-staging.harmonicbeacon.com' \
  http://127.0.0.1:13200/api/health
curl --fail --header 'Host: live-staging.harmonicbeacon.com' \
  http://127.0.0.1:13200/api/health/ready
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: live-staging.harmonicbeacon.com' \
  http://127.0.0.1:13200/api/account/login)" = 404
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: live-staging.harmonicbeacon.com' \
  http://127.0.0.1:13200/api/test-login)" = 404
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: live-staging.harmonicbeacon.com' \
  http://127.0.0.1:13200/rtc)" = 503
```

Verify that `/api/health` reports the exact `STAGING_SHA`, readiness reports
`database: ok` and `account: disabled`. Synthetic profile/alias acceptance
continues in the local PostgreSQL + browser E2E environment; this vhost must
keep both test-login paths dark before it can ever become public.

## Rollback

Before replacing an existing staging release, record its immutable image ref:

```bash
docker inspect hb-live-staging-app --format '{{.Config.Image}}' \
  > /var/lib/harmonic-beacon/live-staging/previous-image
```

Rollback changes only the staging app image in a temporary Compose override;
the additive database migration and dedicated data directory remain intact.
For the first deployment, rollback is simply disabling the new Nginx site and
stopping `hb-live-staging-app`; keep Postgres for investigation.

```bash
export PREVIOUS_IMAGE="$(cat /var/lib/harmonic-beacon/live-staging/previous-image)"
printf '%s\n' "$PREVIOUS_IMAGE" | grep -Eq '^harmonic-beacon/live-staging:[0-9a-f]{40}$'
export BEACON_IMAGE_TAG="${PREVIOUS_IMAGE##*:}"
docker image inspect "$PREVIOUS_IMAGE" >/dev/null
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env \
  up -d --no-deps --force-recreate app
```

After rollback, repeat the liveness/readiness smoke and confirm `/api/health`
reports the previous SHA.

The pre-migration backup is the recovery boundary for data. Restoring it is a
separate, explicit maintenance operation after stopping only the staging app;
it is never part of automatic image rollback and never targets production.

Never run `compose down -v`, remove the staging data directory, reuse a
production image tag, or point this compose file at a production environment.
