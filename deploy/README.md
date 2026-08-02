# Harmonic Beacon production deployment

The production-shaped stack is the root `docker-compose.yml`: Next.js,
PostgreSQL, LiveKit, playlist fallback, tapestry and the durable commerce media
reconciler. Host Nginx terminates TLS for `live.harmonicbeacon.com` and proxies
only the public application and LiveKit signaling ports.

## Host prerequisites

- Docker Engine and Compose v2.
- `/etc/harmonic-beacon/production.env`, root-owned mode `0600`, based on
  `deploy/production.env.example`.
- `/etc/harmonic-beacon/commerce.env`, root-owned mode `0600`, based on
  `deploy/commerce.env.example`. Only `beacon-app` loads this file.
- `/etc/harmonic-beacon/livekit.yaml` and `/etc/harmonic-beacon/keys.yaml`.
- Persistent directories below `/mnt/beacon-data` for PostgreSQL, records and
  verified backups.
- The private cross-project network created once with:

  ```bash
  sudo -n docker network create --driver bridge --internal pmp_beacon_internal
  ```

  Its only permitted members are `beacon-app`, `pmp-myth-worker`, and
  `pmp-myth-worker-secondary`.

## Automated release deploy

A push to `release` runs `.github/workflows/deploy.yml` on the managed host. It:

1. runs contract, unit, type and lint gates;
2. verifies both root-owned env files and the private network membership;
3. preserves the currently running app image under an immutable rollback tag;
4. builds a commit-tagged image;
5. applies additive Prisma migrations and verifies migration status;
6. replaces only app and commerce reconciler; and
7. waits for app readiness and reconciler health.

On failure it restores the preserved app image. It never uses `compose down`,
deletes data or pretends that rebuilding the same tag is a rollback.

## Manual deploy on mona

From `/opt/beacon/app`, preserve the untracked production compose override and
use the canonical project name and environment file:

```bash
export BEACON_IMAGE_TAG=<exact-commit-sha>
sudo -n env BEACON_IMAGE_TAG="$BEACON_IMAGE_TAG" docker compose \
  --project-name app --env-file /etc/harmonic-beacon/production.env \
  build app
sudo -n env BEACON_IMAGE_TAG="$BEACON_IMAGE_TAG" docker compose \
  --project-name app --env-file /etc/harmonic-beacon/production.env \
  run --rm --no-deps app npx prisma migrate deploy
sudo -n env BEACON_IMAGE_TAG="$BEACON_IMAGE_TAG" docker compose \
  --project-name app --env-file /etc/harmonic-beacon/production.env \
  up -d --no-deps --force-recreate app commerce-reconciler
```

Wait for both health checks; do not use a fixed sleep as proof:

```bash
sudo -n docker inspect beacon-app --format '{{.State.Health.Status}}'
sudo -n docker inspect beacon-commerce-reconciler --format '{{.State.Health.Status}}'
curl --fail http://127.0.0.1:3000/api/health/ready
curl --fail https://live.harmonicbeacon.com/api/health/ready
```

For commerce rollout, also execute the synthetic ACTIVE/replay/stale/rotation/
revoke fixtures from the PMP worker and prove public GET and PUT under
`/api/internal` both return `404` before enabling real Ticket Tailor events.

## Rollback

Use an image tag/digest captured before deploy. For commerce incidents, first
put PMP in mock mode so no new commands enter. Keep the reconciler running until
pending jobs reach zero and target identities are absent. Restore the previous
app image, then stop the reconciler only if the old image does not contain it.
The additive migration may remain; never drop commerce tables during an
incident because they contain the command ledger and unfinished reconciliation.

## Useful diagnostics

```bash
sudo -n docker compose --project-name app \
  --env-file /etc/harmonic-beacon/production.env ps
sudo -n docker logs --tail 200 beacon-app
sudo -n docker logs --tail 200 beacon-commerce-reconciler
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/health/ready
```

Never print production env files, authorization headers, ticket codes, email
addresses or raw request bodies while troubleshooting.
