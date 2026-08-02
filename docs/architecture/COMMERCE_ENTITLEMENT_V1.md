# Private commerce entitlement v1

Beacon owns the applied access state. PMP Myth Bot owns Ticket Tailor truth and
expresses desired state through one private, versioned resource:

```text
PUT/GET http://beacon-app:3000/api/internal/v1/commerce-entitlements/
        ticket-tailor/{external_ticket_id}
```

The canonical contract files are under `contracts/commerce-entitlement/v1/`.
`npm run contract:commerce:verify` independently checks the command projection,
canonical UTF-8 bytes and SHA-256 in Python; Vitest checks the same fixture in
TypeScript. Both repositories must ship byte-identical files and record their
hashes before connecting real provider data.

## Network and authentication

Pre-create the shared network once on mona:

```bash
sudo -n docker network create --driver bridge --internal pmp_beacon_internal
```

Only `beacon-app`, `pmp-myth-worker`, and `pmp-myth-worker-secondary` join it.
PostgreSQL, LiveKit, playlist bot and tapestry remain off this network. No host port is published. Public
Nginx returns 404 for `/api/internal` and descendants; bearer authentication is
still mandatory on the private bridge.

Configure current key ID/token on both peers. Beacon stores its copy only in
`/etc/harmonic-beacon/commerce.env`, loaded exclusively by `beacon-app`; the
shared stack environment must not contain it. During rotation, add the previous
pair, move the worker to current, prove PUT and GET, then remove previous. Do not
log authorization, bodies, emails or codes.

## Durable application and revocation

Beacon serializes a resource and its scheduled session, validates capacity and
immutables, then changes the TicketEntitlement, command ledger, request receipt,
WebSessions and media outbox in one serializable PostgreSQL transaction.
LiveKit is deliberately outside that transaction.

`beacon-commerce-reconciler` owns post-commit Stage and Beacon removal. Jobs are
identity-scoped, survive process restart, preserve other events and the shared
Beacon publisher, and remain active until the last ticket token horizon passes.
Ticket-backed Stage and Beacon tokens have a maximum TTL of 300 seconds. Staff
tokens retain their separate operational policy.

Every restoration or credential rotation increments a persisted LiveKit
identity version. Jobs continue targeting the old version while fresh tokens
use the new one, so an old-token cleanup cannot eject newly authorized media.
`LIVEKIT_IDENTITY_SECRET` is separate from the API credential: initialize it to
the current API secret during rollout to preserve existing identities, then keep
it stable during routine API-key rotation.

Operator `Revoke` becomes an administrative suspension for commerce-managed
access, so a later provider ACTIVE update cannot undo a safety decision.
`Resume access` clears only that hold; it never changes provider truth.

## Deployment gate

1. Verify contract copies and SHA-256 in both repositories.
2. Back up Beacon PostgreSQL and verify the dump.
3. Create and inspect `pmp_beacon_internal`; prove no database joins it.
4. Deploy the additive migration.
5. Configure the app-only commerce service keys and stable identity key without
   printing them; inspect container environments to prove unrelated services do
   not receive the commerce bearer.
6. Build/recreate `app` and `commerce-reconciler`; keep other services running.
7. From the PMP worker, execute synthetic ACTIVE, replay, stale, rotation and
   revoke fixtures. From the Internet, prove GET and PUT both return 404.
8. Prove a revoked browser loses Stage and Beacon, an old token cannot reconnect
   after five minutes, and another event plus `playlist-bot` remain connected.

Do not connect real Ticket Tailor data until every gate passes.

## Rollback

First return PMP to mock mode so no new commands can enter. Keep
`commerce-reconciler` running until pending jobs reach zero and target identities
are absent, then restore the previous immutable app image. Stop the worker only
after the queue drains. If the worker itself caused the incident, perform the
same identity-scoped LiveKit removals manually before stopping it. The migration
is additive and can remain while the old app runs. Do not drop the commerce
tables during an incident; they are the durable evidence and reconciliation
state needed to understand what was applied.
