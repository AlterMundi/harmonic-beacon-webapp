# EarlyBirds staging preview and rollback

This is the EB-08 preview/rehearsal surface for
`earlybirds-staging.harmonicbeacon.com`. It is isolated from the weekend event
stack: project name `earlybirds-preview`, volume `earlybirds-preview-postgres`,
loopback-only ports, an internal preview network, and the separately bounded
`services/beacon-stream` origin. It never runs a production deploy, creates a
real account, calls OAuth, or calls a payment provider.

The URL is a future TLS/DNS boundary. Local validation deliberately uses
`earlybirds-staging.localhost` and `127.0.0.1`; DNS is not required.

## Prepare synthetic inputs

Copy `ops/early-birds-preview/preview.env.synthetic.example` to a root-owned
`0600` path outside Git. Keep `EARLYBIRDS_PREVIEW_ENV=synthetic`. The lifecycle
scripts reject production domains and provider names in this file.

Point `BEACON_STREAM_ARTIFACTS_HOST_PATH` only at a generated synthetic HLS
fixture that satisfies the existing `services/beacon-stream` artifact contract.
Do not mount an approved master, a drop-in, real Listener data, or an event
volume. Audio creation, artifact selection, and listening approval remain
outside EB-08.

## Start and validate

From the repository root, with Docker available:

```bash
npm --prefix ops/early-birds-preview run test
npm --prefix ops/early-birds-preview run validate
scripts/early-birds-preview/start.sh /secure/earlybirds-preview.env
scripts/early-birds-preview/health-smoke.sh /secure/earlybirds-preview.env
```

`start.sh` starts only PostgreSQL and the existing bounded stream origin.
`health-smoke.sh` proves PostgreSQL readiness and the stream `/readyz` endpoint.
It intentionally does not assert playback or decoded audio: that needs an
approved artifact and EB-08 cross-device/audio acceptance.

No Listener service is defined in this slice. When the Listener lane is ready,
add its explicit image, isolated cookie/OAuth config, and health endpoint as a
small overlay; do not infer an app health contract here.

## Migration rehearsal

Run this after additive EarlyBird Prisma migrations land:

```bash
scripts/early-birds-preview/rehearse-migration.sh /secure/earlybirds-preview.env
```

The command runs `prisma migrate deploy` only against the `postgres` service in
this compose project. It is a forward migration rehearsal, not a destructive
down-migration. The rollback strategy is additive data retention plus disabling
the Listener entry and origin; do not delete the preview volume during an
incident unless its exact target has been reviewed.

## Stop and rollback rehearsal

For a normal stop (retains preview data):

```bash
scripts/early-birds-preview/stop.sh /secure/earlybirds-preview.env
```

For an EarlyBird stream incident, stop only that origin:

```bash
scripts/early-birds-preview/rollback.sh /secure/earlybirds-preview.env
```

Then disable the EarlyBird public entry using the Listener lane's feature flag
and serve its truthful unavailable state. This slice cannot and does not stop
the event compose project, LiveKit, playlist-bot, or production database.

## Staging release gate

Before external staging acceptance, record all of the following:

1. Synthetic compose validation, unit contract checks, startup, health smoke,
   stop, origin rollback, restart, and migration rehearsal evidence.
2. The existing stream origin/canary and observability validation in
   `ops/early-birds/runbook/README.md`; use fake alert secrets locally.
3. Listener auth/authorization negative tests, synthetic entitlement checks,
   and separate-cookie verification once its lane is integrated.
4. An approved artifact, external decoded-audio canary, 60-minute physical
   desktop/iOS/Android listening, and isolated load/soak evidence. These are
   release prerequisites, not assertions made by this scaffold.
5. DNS/TLS verification for `earlybirds-staging.harmonicbeacon.com` only after
   the local/ZeroTier path is green. Never use DNS success as a replacement for
   the local health and rollback checks.

Do not promote this staging runtime to production without the explicit
EarlyBirds release, audio, identity, commerce, and rollback gates in
`docs/plans/EARLY_BIRDS.md`.
