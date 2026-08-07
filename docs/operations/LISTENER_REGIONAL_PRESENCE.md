# Listener regional presence

Founding Listener exposes a deliberately imprecise public presence signal at
`GET /api/listener/presence`. The response contains fixed macro-regions and one
of five qualitative bands (`none`, `trace`, `cluster`, `field`, `radiant`). It
never contains exact counts, identities, countries, cities, coordinates, IP
addresses, account IDs, or device IDs.

## Runtime configuration

The reviewed data source is DB-IP Country Lite July 2026 in MMDB format,
distributed under CC BY 4.0. Install it with
`scripts/early-birds-preview/install-geoip-country.sh`, keep it on the
secondary data volume, and mount it read-only into the container. The public
response includes the required DB-IP attribution link. Do not commit the
database to Git or download it during a request. A missing, unreadable, or
unmatched database maps the request to `UNKNOWN` and never blocks listening.

The application derives the client address only after the configured trusted
proxy chain. Keep `TRUSTED_PROXY_HOPS` aligned with nginx/the edge topology.
Caller-supplied forwarding prefixes are ignored. Do not expose the app port
directly to the Internet.

## Semantics

- A prepared lease is `IDLE`.
- An audible introduction and the Beacon are both `LISTENING`.
- Pause, Stop, terminal playback failure, logout/page close, and lease
  displacement report `IDLE` immediately on a best-effort basis.
- Ordinary heartbeats reconcile the state every minute; expired or abruptly
  disconnected leases disappear after the existing short lease TTL.
- Two devices belonging to one signed-in account count once.
- Free-for-All devices use their ephemeral HMAC device digest as the private
  grouping key because they intentionally share one technical account.

Only the macro-region and ephemeral playback timestamps are persisted. The
source address is used for the local lookup and discarded.

## Public cache and failure behavior

Successful responses are cacheable for five seconds with a short stale window.
If PostgreSQL briefly fails, the process serves only its last known public
bands. With no last-known snapshot it returns `503` instead of inventing an
empty crowd. Exact counts remain available only to private operational metrics.

## Deploy check

1. Apply the forward-only Prisma migration.
2. Mount the Country MMDB read-only and set `BEACON_LISTENER_GEOIP_DB_PATH`.
3. Start one synthetic listener from two devices and confirm it produces one
   qualitative presence unit.
4. Confirm a Free-for-All synthetic device appears independently.
5. Stop playback and confirm the region returns to its previous band without
   waiting for lease expiry.
6. Send a forged left-most `X-Forwarded-For` entry through nginx and verify it
   cannot select a region.
7. Remove the MMDB mount in staging and verify listening stays healthy while
   presence falls back to `UNKNOWN`.

Rollback is operational: deploy the previous app image. The additive columns,
enums, and index can remain in place safely; do not reverse the migration during
an incident.
