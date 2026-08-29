# Analytics operations runbook

## Service and ownership

The Live repository owns collector, worker, mart and `/ops/analytics`. Account owns canonical
identity and Listener intervals; Live owns attendance; the commerce Authority owns membership and
payment truth. The worker has one allowlisted read-only role per source. Collector and dashboard
use separate PostgreSQL login roles; only the worker/migrator uses `analytics_owner`.

Health endpoints are `/health`, `/ready` and loopback-only `/metrics` on the collector. Worker,
source and Meta freshness appear in `mart.source_health`. Its `display_state` distinguishes
`disabled`, `unknown`, `stale`, `error`, and `ok`; unresolved source retries are counted in
`open_dead_letters` without storing query text, credentials, or source rows. Browser calls are fail-open and have
three-second or shorter proxy timeouts, so analytics cannot block a product request.

## Data retention and access

The authoritative data-class, purpose, jurisdiction and owner matrix is
[DATA_GOVERNANCE.md](./DATA_GOVERNANCE.md).

- Network digests: 30 days; advertising click IDs: 90 days; raw browser events: 180 days.
- Canonical account, listening, attendance, membership and payment facts: retained while needed
  for operations, financial/legal obligations and longitudinal product analysis.
- Dashboard: Live `ADMIN` or an explicit `AnalyticsRoleGrant`; CSV requires EXPORTER or ADMIN.
- Every view/export appends an opaque actor, role, filters digest and row count to `audit`.
- Passwords, auth tokens, secrets, signed URLs, payment numbers, chat/media content and form values
  are prohibited by the contract and rejected before storage.
- Correction/deletion: resolve the canonical account in Account, identify its HMAC subject in a
  privileged maintenance transaction, export or anonymize the mapped raw/identity rows, retain
  legally required aggregate/financial facts, and append an operator audit record.

## Backup and restore

Analytics PostgreSQL lives at `/mnt/beacon-data/analytics/postgres`. Encrypted custom dumps live at
`/mnt/beacon-data/backups/analytics/postgres`; the service has `RequiresMountsFor`, an explicit
`mountpoint` precheck and a different-device check. Missing mount fails closed instead of writing
to the root disk. Backups run every six hours, retain 14 days, reserve 10 GiB and carry SHA-256
sidecars. One recipient is locally restorable and one is the existing off-host recipient.

Run `restore-verify-analytics.sh <dump.age>` to decrypt into a new temporary database, restore all
schemas, validate the catalog and drop the temporary database. It never overwrites production.
RPO is six hours plus timer jitter; target RTO is two hours. A source loss is recovered by restoring
analytics and replaying the one-day-overlap idempotent backfills. An analytics DB loss does not
affect product availability; rebuild from source plus retained browser backups.

## Incidents and rollback

1. Check `docker inspect` health and `mart.source_health`; never inspect raw payloads in logs.
2. If Meta fails, leave the product and other panels running; rotate only the System User token.
3. If a source fails, keep its last snapshot labeled stale and repair its read-only credential.
4. If collector load is suspect, remove the Nginx `/_a/` route or stop collector. Applications
   remain functional and server emitters fail open.
5. Roll back app images by their preserved digest. Analytics migrations are additive; keep the
   database, then roll the worker/collector image back. Restore only into a new database first.

Never change DNSExit, Meta Pixel, campaigns, payment provider state, product access or canonical
events while responding to an analytics incident.
