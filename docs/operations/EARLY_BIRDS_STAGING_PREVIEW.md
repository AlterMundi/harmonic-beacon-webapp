# EarlyBirds isolated staging runtime

## 2026-08-06 staging deployment record

The isolated preview is currently running on `mona`; this is operational
evidence, not authorization to promote it to `main` or production.

- Listener application SHA: `806fe9c6e2ae162c46d841e71813be477c4e58a5`.
- Free authority preview SHA: `83deaaee1ae3c5adce910c80249a0229ab4199e5`,
  including hardened authority `8638d6e`, durable synthetic-Free
  reconciliation and Alembic head `b8c4d1e7f260`.
- Runtime, observability and nginx fixes are on the `early-birds` branch. The
  deployed application health response attests the exact Listener image SHA;
  later documentation-only commits do not require rebuilding that image.
- Both exact hosts have valid Let's Encrypt certificates expiring 2026-11-04
  and emit `X-Harmonic-Beacon-Environment: early-birds-staging`; production
  does not emit that attestation.
- PostgreSQL, migrations, Listener, origin, authority API/worker, Prometheus,
  node-exporter, cAdvisor and the HTTP segment canary are healthy. The
  authority has no published host port and paid checkout returns fail-closed
  `503 paid_checkout_disabled`.
- Canonical Free acceptance passed through identity-only synthetic login,
  signed one-use invitation, private authority redemption, membership
  projection, session cookie and Listener home.
- The current canonical lifecycle smoke also passed same-account idempotent
  replay, cross-account one-use rejection, three-device/oldest-lease eviction,
  durable revocation reconciliation, existing-stream denial and Listener
  redirect. A fresh human invitation and its non-secret UUID sidecar are stored
  root-only at mode `0600`; the previous invitation was revoked before archival.
- Public real-browser layout checks passed in ES and EN at 1440, 1024, 390 and
  320 pixels. The DB-backed authenticated fixture passed the same responsive
  matrix without requesting camera or microphone access.
- A disposable canonical invitation passed real-browser activation and an
  immediate second sign-in of the same account. The second device path signs in
  before attempting sign-up, avoiding Better Auth's intentional account-create
  rate limit. After authority revocation and durable reconciliation, the same
  browser path remained at the redeem boundary and truthfully denied access.
- Rollback stopped only Listener/origin, retained healthy preview PostgreSQL,
  kept `live.harmonicbeacon.com` healthy, and restored staging via the normal
  start/smoke path.
- Alertmanager remains intentionally stopped until root-owned Telegram bot and
  chat-ID files exist. The current origin uses a non-audio synthetic fixture;
  no acoustic choice or real derivative has been made.
- The format-neutral `staging-smoke` load plan was dry-run on the external,
  NTP-synchronized `daimonmatrix` generator with zero network requests. Its
  plan hash is
  `2ed8d7dc1717768fe846a87cdad1a67cf681ce58809e7b4e72106b4f1dcd22c6`;
  executing even that ten-client step still requires a real approved artifact,
  short-lived signed manifest and an explicit monitored run window.
- The `origin-media-3000` profile was also dry-run as four deterministic
  750-client shards split across two NTP-synchronized external generators
  (`legion` and `daimonmatrix`). All four PLANNED artifacts have mode `0600`,
  cover shard indices `0..3`, sum to exactly 3,000 clients, use distinct ordinal
  hashes, share plan hash
  `f7d3254d510530172ed1fcc708fb6f7c70487e5d75f5416da3c9ebb591a28d1e`
  and attest zero network requests. This proves distribution readiness, not
  throughput or customer capacity.

Protected runtime configuration remains under `/etc/harmonic-beacon/`; this
record never includes its values. The supervised human Free invitation is
root-owned and mode `0600` on the host.

This is the non-deploying EB-08 staging lane for exactly:

- `https://earlybirds-staging.harmonicbeacon.com` — Next Listener on host loopback `127.0.0.1:13000`.
- `https://stream.harmonicbeacon.com` — bounded stream origin on host loopback `127.0.0.1:18080`.

It is a separate Compose project named `earlybirds-preview`. It does not join,
replace, stop, or migrate the weekend event stack. PostgreSQL is reachable only
on the internal `preview_db` container network; its named volume is
`earlybirds-preview-postgres`. The Listener alone also joins
`listener_egress`, allowing it to fetch the public HTTPS stream hostname.
Beacon-stream remains on its separate internal observability network.

No deployment, DNS change, certificate request, nginx installation, host
firewall change, OAuth registration, or provider call is performed by these
files or lifecycle scripts.

Free acceptance is the only membership flow in this staging milestone. The
runtime defines no checkout service and supplies no PayPal, Mercado Pago, or
other paid-provider configuration. Paid acceptance remains disabled even when
the public Listener kill switch is opened.

## Prepare synthetic inputs

Copy `ops/early-birds-preview/preview.env.synthetic.example` to a `0600` path
outside Git and set only `BEACON_STREAM_ARTIFACTS_HOST_PATH` to an existing,
generated synthetic fixture directory. No artifact, codec work, approved audio,
drop-in, user export, or event volume belongs in this lane.

The lifecycle guard deliberately requires:

- the preview database user/name and fixed nginx ports;
- exactly the two HTTPS staging origins above;
- visibly `synthetic-` secrets and artifact identity;
- blank Google/Apple client IDs and secrets;
- the synthetic login seam; and
- both public/team-entry kill switches equal to `0` or `1`, with the team form
  allowlisted only for `earlybirds-staging.harmonicbeacon.com`.

It rejects other Harmonic Beacon domains, HTTP stream configuration,
production/provider values, event database identities, real OAuth values, and
non-synthetic secrets. The example starts with `EARLY_BIRDS_ENABLED=0`, so the
Listener serves its truthful unavailable state until an operator deliberately
opens it after the gates pass.

### Optional private authority handoff

The default fixture deliberately points
`EARLY_BIRDS_AUTHORITY_BASE_URL` at `https://authority.example.invalid` and is
not connected to an authority. To exercise Free acceptance with the external
canonical membership authority, its independently owned Compose project must:

1. run in synthetic/staging mode with every paid-provider integration and
   checkout entry disabled;
2. join a dedicated external Docker network named
   `earlybirds_authority_private`, created with Docker `Internal=true`; the
   Uvicorn `api` service/container must be reachable there by its actual private
   name `pmp-myth-api` on port `8765`;
3. accept the matching synthetic bearer/key ID from
   `EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN` and
   `EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID`; and
4. address this Listener as `http://earlybirds-listener:3000` for authenticated
   membership projection pushes.

Then set these values in the protected preview env:

```dotenv
EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK=earlybirds_authority_private
EARLY_BIRDS_AUTHORITY_BASE_URL=http://pmp-myth-api:8765
EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID=synthetic-v1
EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN=synthetic-<matching-43-plus-character-token>
```

The lifecycle helper then adds `authority-network.override.yml`; otherwise it
does not. The helper refuses a network that is absent or not internal. The
override adds only that private external network and exposes no host port. Its
only intended members are `pmp-myth-api` and this `listener`; verify membership
before opening the entry switches. Network creation and authority configuration
stay with that service's operator; these scripts never create or mutate the
external project.

## Validate without starting

From the repository root:

```bash
npm --prefix ops/early-birds-preview run check
npm --prefix ops/early-birds-preview test
npm --prefix ops/early-birds-preview run validate
```

`validate` renders the three-file Compose model and asserts its services,
loopback bindings, network isolation, migration dependency, blank OAuth inputs,
and production-mode HTTPS origin. `validate:build` additionally builds the
Listener, migration, and stream images without starting them.

## Forward-only start and smoke

```bash
scripts/early-birds-preview/start.sh /secure/earlybirds-preview.env
scripts/early-birds-preview/health-smoke.sh /secure/earlybirds-preview.env
```

Startup is fail closed:

1. preview PostgreSQL must become healthy;
2. `npx prisma migrate deploy` must complete successfully over the direct,
   internal PostgreSQL connection; and
3. only then may the Listener start.

The smoke verifies the successful migration container, PostgreSQL readiness,
Listener `/api/health` liveness, Listener `/api/health/ready` database
readiness, stream `/healthz` liveness on loopback, and stream `/readyz` inside
its private container network. It does not claim playback or decoded-audio
acceptance.

To rerun the idempotent forward migration separately:

```bash
scripts/early-birds-preview/rehearse-migration.sh /secure/earlybirds-preview.env
```

There is no down-migration command. Schema repair is an additive forward
migration; route rollback retains the preview data for inspection.

## Nginx and TLS handoff (not executed here)

The two files in `ops/early-birds-preview/nginx/` are standalone vhost
templates. Each names only its exact hostname, includes an ACME webroot path and
the exact future certificate paths, and proxies only its fixed loopback port.
The stream vhost exposes `/healthz` and `/v1/hls/`; container-private `/readyz`
and metrics are not proxied. The Listener vhost exposes only `/early-birds`,
`/api/early-birds/`, Next static assets and health; it blocks `/api/internal/`
and returns 404 for the image's weekend, staff, event and checkout surfaces.

A host operator must review certificate/DNS ownership, provision each named
certificate, install these as new site files, and run `nginx -t` before any
reload. Do not edit, replace, symlink over, or reload the existing live/event
vhost as part of this staging lane.

Keep `EARLY_BIRDS_STREAM_ORIGIN=https://stream.harmonicbeacon.com`. The Listener
runs with `NODE_ENV=production`; its application contract still rejects HTTP
origins. Public HTTPS egress is an explicit staging topology choice, not a
relaxation of production validation.

## Open, stop, and rollback

After migration, both liveness/readiness probes, nginx syntax, TLS, and
synthetic negative-access checks pass, change only:

```dotenv
EARLY_BIRDS_ENABLED=1
EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=1
```

Recreate the Listener through `start.sh`, rerun the smoke, and exercise only
`@e2e.invalid` synthetic identities with the separate test-login bearer.
Provider buttons remain disabled because OAuth credentials are blank.
Return both switches to `0` after the supervised team window.

Normal stop retains all preview data:

```bash
scripts/early-birds-preview/stop.sh /secure/earlybirds-preview.env
```

Incident rollback stops the two public-serving components while retaining
PostgreSQL for diagnosis and a forward fix:

```bash
scripts/early-birds-preview/rollback.sh /secure/earlybirds-preview.env
```

Set `EARLY_BIRDS_ENABLED=0` before the next start. None of these scripts uses
`docker compose down`, deletes a volume, or targets the event/live project.

## Staging release gate

Record config/test/build output, migration status, smoke output, kill-switch
state, rollback/stop/restart evidence, and the reviewed nginx/TLS handoff. Audio
provenance, external decoded-audio canaries, physical device listening,
load/soak, real identity-provider registration, and commerce reconciliation are
separate release prerequisites; this plumbing does not satisfy or simulate
them. Do not promote this runtime to production without the explicit gates in
`docs/plans/EARLY_BIRDS.md`.
