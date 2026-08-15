# External EarlyBird HLS load harness

This dependency-free Node 22 tool models the origin/CDN media-plane HTTP work
of deterministic HLS clients from one or more **external** load generators. It reads a media
playlist on a shared UTC schedule, follows newly visible segment sequences and
records request latency, status/errors, transferred bytes and
rebuffer-equivalent fetch misses.

It deliberately does not exercise the Listener application manifest proxy,
Better Auth, PostgreSQL membership/lease checks, per-device cookies or one
connection pool per real browser. Therefore its 3,000/4,000/5,000 profiles are
media-plane evidence only, never end-to-end Listener capacity. A separate
synthetic-session/lease/browser stage is required before setting a customer
limit.

It does not decode media or inspect codec, bitrate, sample rate,
channel count, loudness or gain. It cannot provide audio acceptance evidence.
It also does not use application sessions, event auth, LiveKit or production
runtime code.

## Safety contract

- Dry-run is the default rehearsal path and performs zero HTTP requests.
- A network run requires a target from an explicit JSON allowlist with
  `production: false`, target-specific client/ramp/soak/shard limits, an exact
  generated confirmation phrase and a shared UTC start.
- Staging origins must be HTTPS and every response must carry the exact
  `X-Harmonic-Beacon-Environment: early-birds-staging[-suffix]` attestation
  configured in the target policy. Redirects and every manifest/segment URL whose
  exact origin is not allowlisted are refused.
- `harmonicbeacon.com`, `www.harmonicbeacon.com`,
  `live.harmonicbeacon.com`, `app.harmonicbeacon.com` and live/prod-like host
  labels are blocked.
  A policy cannot declare a `production` or `live` environment.
- Staging network runs require
  `EARLY_BIRDS_GENERATOR_ROLE=external-load-generator` and
  `--external-generator`. Hostnames `mona`, `mona-*` and `mona.*` are refused. Never
  execute a staging network run from the event/production VPS.
- Global hard bounds are 5,000 clients, 200 client starts/second, 60 minutes,
  64 shards and 1,000 clients per shard. Each target policy can only lower
  these bounds and must also cap manifest cadence, request starts/second,
  per-shard concurrency, segments/poll and manifest/segment body bytes. An
  enforced per-shard rate limiter prevents phase bunching from exceeding the
  target RPS budget. More than 250 clients requires at least two shards; more
  than 1,000 requires at least four.
- Whole-run request-error and fetch-miss tolerances cannot exceed 10%; derived
  rolling-window gates are capped at 20% and in-run circuit breakers at 25%,
  regardless of a custom profile.
- The signed manifest URL lives only in a regular file at exactly mode `0600`
  (never a symlink or device), bounded in size. That
  file is refreshed from disk at least once per second so a separate approved control
  plane can rotate short-lived URLs without giving the harness a signing key.
- Every staging shard records an externally measured UTC clock offset within
  the target-policy bound. Obtain it from a trusted NTP/chrony source immediately
  before the run.
- Evidence is created mode `0600` with no overwrite. It stores only origins,
  path/input/host hashes and aggregate measurements—never a query string,
  signed URL, authorization value, cookie, response body or raw error.

## Files

- `profiles.json`: reproducible bounded profiles. Only `tiny-synthetic` is
  exercised by automated tests.
- `target-policy.example.json`: non-runnable placeholder. Copy it outside Git,
  replace the `.invalid` origins with exact approved staging origins and set
  limits no larger than the reviewed run.
- `run.mjs`: one dry-run or network shard.
- `aggregate.mjs`: verifies and combines one evidence file from every shard.
- `verify-planned.mjs`: verifies a complete multi-generator dry-run set, including
  shared plan hash, complete shard indices, exact client sum, distinct generator
  fingerprints, redaction, zero network requests and mode `0600` sources.

## Tiny dry-run

```bash
node tools/early-birds-hls-load/run.mjs \
  --policy /secure/early-birds-hls-targets.json \
  --target early-birds-staging \
  --profile staging-smoke \
  --run-id eb-staging-smoke-001 \
  --start-at 2026-08-07T15:00:00.000Z \
  --shard-index 0 \
  --shard-count 1 \
  --evidence artifacts/early-birds-hls-load/smoke-plan.json \
  --dry-run
```

Dry-run validates the complete plan, writes `PLANNED` evidence and prints the
exact confirmation required by a network run. It does not read a signed URL or
contact the target.

Validate a complete distributed plan before requesting a network run:

```bash
node tools/early-birds-hls-load/verify-planned.mjs \
  --min-generators 2 \
  /secure/load-plan/shard-*.json
```

The verifier emits a redacted JSON summary. It refuses partial/duplicate shard
sets, a mismatched plan or input hash, non-`0600` sources and any evidence that
contains runtime measurements or claims a network request.

See [`docs/ops/EARLY_BIRDS_HLS_LOAD_SOAK.md`](../../docs/ops/EARLY_BIRDS_HLS_LOAD_SOAK.md)
for the distributed procedure, stop conditions and evidence interpretation.

The first real request is deliberately narrower than the general harness. Use
`run-staging-smoke.mjs` and the checked-in `listener-staging-smoke-10` policy;
that wrapper fixes the exact origin, ten clients, one shard and sixty-second
soak. A staging network invocation also requires a fresh private signed
manifest file plus continuously refreshed external decoded-canary and target
monitor status files, all exactly mode `0600` regular files produced on the
same external host as the wrapper. The target monitor queries Alertmanager
(`--alertmanager-url`, default `http://127.0.0.1:19093`) and Prometheus
(`--prometheus-url`, default `http://127.0.0.1:19090`) through separate
uncredentialed loopback SSH tunnels, evaluates the immediate host thresholds
directly and maintains an in-process restart/OOM baseline for the isolated
Listener and origin roles. A passing sample additionally requires the private
fixed-target observer to be up, fresh, in the same durable epoch and to expose
exactly one finite start/restart/OOM series per role. The wrapper polls both status files every two
seconds and aborts the load child exactly once on the first failing or stale
check. See
[`LISTENER_FIRST_EXTERNAL_HLS_SMOKE.md`](../../docs/ops/LISTENER_FIRST_EXTERNAL_HLS_SMOKE.md).

## Development verification

```bash
npm --prefix tools/early-birds-hls-load run check
npm --prefix tools/early-birds-hls-load test
```

The parser follows ordinary media playlists, opaque initialization maps, byte
ranges and declared gaps. It rejects master playlists, encrypted media and
LL-HLS parts instead of silently undercounting them; this says nothing about the
opaque media encoding.

The test suite uses only a tiny loopback synthetic origin plus in-process fake
HTTP responders for the Prometheus/Alertmanager monitor probes. It never
contacts staging, production, DNS or external media.
