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
- Account secret: `/etc/harmonic-beacon/live-staging-secrets/account.env`,
  root-owned mode `0600` inside a root-owned mode-`0700` directory; optional
  while the feature is off and mounted only into the app
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

The authority-side source for the staging client secret is the root-owned
`BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING` entry in
`/etc/harmonic-beacon/account.staging.env`. Never copy it through a terminal,
chat, command argument or shell trace. The reviewed sync command reads that
exact file and writes only the RP-specific secret bundle without printing its
value. PostgreSQL, migrations and production never receive that bundle.

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

Build and start only the staging app. Compose runs the reproducible one-shot
`migrate` service first and refuses to start the app unless it exits zero:

```bash
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env build app
docker compose --file deploy/live-staging.compose.yml \
  --env-file /etc/harmonic-beacon/live-staging.env up -d app
test "$(docker inspect hb-live-staging-migrate-1 --format '{{.State.ExitCode}}')" = 0
```

Install `deploy/nginx-live-staging-loopback.conf` under the new, exact site
name, run `nginx -t`, enable it, then reload. Do not edit an existing vhost.

## Prepare the Account RP while it remains dark

The Account authority must first answer exact discovery and readiness. Record
its exact SHA; do not infer readiness from the login page:

```bash
curl --fail --silent https://account-staging.harmonicbeacon.com/api/account/health/ready \
  | jq -e '.status == "ok" and .checks.database == "ok" and
           .checks.issuer == "ok" and .checks.jwks == "ok" and
           .checks.clients == "ok" and .checks.providers == "ok"'
```

Build the reviewed Live staging image first. Then synchronize the confidential
`hb-live-staging` value with a one-shot, networkless container. This mount set
exposes only the two reviewed source files and the dedicated target directory,
not the rest of `/etc/harmonic-beacon`:

```bash
sudo install -d -o root -g root -m 0700 \
  /etc/harmonic-beacon/live-staging-secrets
sudo docker run --rm --network none --read-only --user 0:0 \
  --mount type=bind,src=/etc/harmonic-beacon/account.staging.env,dst=/etc/harmonic-beacon/account.staging.env,readonly \
  --mount type=bind,src=/etc/harmonic-beacon/live-staging.env,dst=/etc/harmonic-beacon/live-staging.env,readonly \
  --mount type=bind,src=/etc/harmonic-beacon/live-staging-secrets,dst=/etc/harmonic-beacon/live-staging-secrets \
  "harmonic-beacon/live-staging:$STAGING_SHA" \
  node /app/scripts/live-staging/account-secret-sync.mjs
test "$(sudo stat -c '%U:%G %a' /etc/harmonic-beacon/live-staging-secrets)" = \
  'root:root 700'
test "$(sudo stat -c '%U:%G %a' /etc/harmonic-beacon/live-staging-secrets/account.env)" = \
  'root:root 600'
grep -Fxq 'BEACON_ACCOUNT_ENABLED=false' /etc/harmonic-beacon/live-staging.env
```

Run the authenticated backchannel preflight. The network-enabled candidate
receives only its dedicated app secret bundle; it never sees the Account
authority environment, database credentials, ticket pepper, mail/social
secrets or the general Live environment. Exact issuer/client configuration is
compiled into the reviewed script. The `/api/account/session-status` request
with an unknown synthetic SID/subject proves that the mounted value is the
registered confidential RP secret. Success must be `{active:false}` plus
`no-store`; the command never emits the secret.

```bash
sudo docker run --rm --read-only --user 0:0 \
  --mount type=bind,src=/etc/harmonic-beacon/live-staging-secrets/account.env,dst=/etc/harmonic-beacon/live-staging-secrets/account.env,readonly \
  "harmonic-beacon/live-staging:$STAGING_SHA" \
  node /app/scripts/live-staging/account-preflight.mjs prepared
```

Recreate only `hb-live-staging-app` with the feature still off, then repeat the
ordinary smoke. The expected readiness remains `account: disabled` and all
three Account RP routes remain `404`. This is the safe rollback checkpoint.

## Public edge and Account activation

Do not execute this section until the prepared checkpoint above is green.
There is deliberately no DNS or certificate automation in the application
container.

1. Create an `A`/`AAAA` record for the exact
   `live-staging.harmonicbeacon.com` staging host.
2. Install `deploy/nginx-live-staging-acme-bootstrap.conf`, run `nginx -t`,
   reload, obtain the dedicated certificate, then replace the bootstrap with
   `deploy/nginx-live-staging-public.conf`. Never reuse the production Live
   certificate or vhost.
3. Verify HTTPS returns
   `X-Harmonic-Beacon-Environment: live-staging`, `/rtc` is `503`, both
   test-login paths and `/api/internal/*` are `404`, and Account callback/state
   sentinels never enter the access log.
4. Back up `/etc/harmonic-beacon/live-staging.env`, atomically change only
   `BEACON_ACCOUNT_ENABLED=false` to `true`, recreate only
   `hb-live-staging-app`, and retain the prior immutable app image.
5. Run the same preflight with `public`. It additionally requires public Live
   readiness `{database:ok,account:ok}` from the exact TLS origin:

```bash
sudo docker run --rm --read-only --user 0:0 \
  --mount type=bind,src=/etc/harmonic-beacon/live-staging-secrets/account.env,dst=/etc/harmonic-beacon/live-staging-secrets/account.env,readonly \
  "harmonic-beacon/live-staging:$STAGING_SHA" \
  node /app/scripts/live-staging/account-preflight.mjs public
```

6. Complete a synthetic Account login, profile/display-name update, event alias
   edit, current-device logout and front-channel logout. Room/media remains
   explicitly out of scope because this staging stack has no LiveKit.

If any activation check fails, atomically restore the backed-up environment,
recreate only `hb-live-staging-app`, confirm `account: disabled`, and keep the
public vhost available only for diagnosis or return it to the ACME bootstrap.
Never change the Account client secret as an RP rollback mechanism.

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

Before public promotion, require that every staging secret ever printed to a
terminal, CI log, chat or agent transcript has been rotated. The rotation needs
a root-only environment backup, a verified staging database dump, atomic env
replacement, coordinated PostgreSQL role update, an app-only recreate, and a
log scan proving neither the old nor new value appears in outputs. Production
and all event container IDs, images and restart counts must be fingerprinted
before and after and remain unchanged.

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
