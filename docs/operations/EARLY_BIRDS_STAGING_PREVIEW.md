# EarlyBirds isolated staging runtime

## 2026-08-07 first-listen access and boundary synchronization

The isolated Listener runs application SHA
`dad29d4dc5010603a5bbc7ed309c8f78e7c0f384`, image
`harmonic-beacon/earlybirds-preview-listener:dad29d4` and schema
`20260807100000_early_bird_welcome_access`. Free for All remains OFF for the
coordinated registered-access acceptance.

- A new signed-in account may explicitly start one durable 30-minute first
  listen before selecting its recurring schedule. Registration, page view,
  FFA, Founder membership and schedule selection do not consume it.
- Stream lease and manifest authorization are capped at the exact server-side
  welcome end. A protected synthetic runtime smoke proved unused state,
  activation, exact duration, replay without extension, signed media and
  rejection of a second activation.
- An already-open waiting/player page now revalidates once at the scheduled
  start/end boundary and on resume, without continuous pre-boundary polling.
  Physical timing acceptance remains in #216.
- The passwordless email seam from #221 is present but intentionally hidden.
  Real delivery remains blocked on `SairaAsua/proyecciones-mito#44`; no Gmail
  OAuth material is installed in Listener.
- Local checkpoint passed 1,124 tests with 19 standard skips, ESLint,
  TypeScript, production build, Prisma validation and preview checks. PR #222
  CI passed stream, observability and preview builds. Host/public health,
  PostgreSQL, origin and event-production health are green; Listener has zero
  restarts.
- Rollback restores root-only
  `/etc/harmonic-beacon/earlybirds-preview.env.pre-dad29d4`, selects Listener
  image `55bf282` and retains PostgreSQL, the additive welcome table and all
  approved media.

## 2026-08-07 registered Free and identity hardening

This prior candidate ran application SHA
`575b75aae5609b1813485d955a3e8ea753018084` and schema
`20260807070000_early_bird_free_schedule`. The global Free for All override is
independent from account schedules and membership.

- A registered account may select one recurring two-hour daily window using a
  canonical IANA time zone. The server owns authorization, the rolling
  seven-day change boundary and DST resolution. Stream leases and manifests
  cannot outlive the active window.
- A synthetic identity-only staging pass selected Listen now, rendered the
  active Free home, acquired a lease bounded by the exact window end and
  fetched a valid HLS manifest. Free for All was then restored and anonymous
  playback passed again.
- Google authorization reached the real Google account chooser in Chromium
  with the exact Listener callback, one-time state and PKCE S256. No real
  account was selected. Apple is absent and fails closed until its external
  developer credentials exist.
- Browser auth mutations now require an exact trusted Origin; Apple/provider
  callbacks remain state/cookie and PKCE bound. A synthetic session verified
  logout and confirmed that provider tokens, IP address and user-agent are not
  retained in the Listener tables.
- All 1,087 tests, ESLint, TypeScript, production build, frozen-audio,
  stream-origin, observability and preview checks passed. Public readiness,
  ES/EN drop-ins, FFA lease and decoded canary are green.
- The two builds used only temporary Docker build cache. Pruning only unused
  cache left every image, container, volume and runtime datum intact. Approved
  media remains on `/mnt/beacon-data`; moving containerd itself still requires
  a production maintenance window.
- Rollback restores root-only
  `/etc/harmonic-beacon/earlybirds-preview.env.pre-575b75a`, selects Listener
  image `d7ed952`, and retains PostgreSQL, origin media and the authority.

## 2026-08-07 live-edge transport refinement

The isolated Listener now runs application SHA
`2f057e0a31e384ba4d47cd14652afe1967c830ae` (image
`harmonic-beacon/earlybirds-preview-listener:2f057e0`). Nico explicitly
approved a stability-first Listener buffer after hearing choppiness while
moving the volume control.

- The Beacon is live-edge only: it exposes Stop, never Pause or Seek, and a
  later Listen seeks to the current configured edge.
- Pause and Seek remain available only while a private introduction is active.
- Desktop hls.js targets five six-second segments behind the edge, a 60-second
  forward buffer and a 90-second hard maximum; low-latency mode remains off.
- Volume input updates media elements directly instead of re-rendering the
  Listener constellation for every slider movement.
- A real 390x844 Chromium pass fit the complete active-Beacon UI without
  vertical or horizontal overflow. Five rapid volume changes left playback
  active at the requested volume with 27.8 seconds buffered ahead.
- All 1,049 tests, ESLint, TypeScript, production build, frozen-audio-path,
  stream-origin, observability and staging-preview checks passed.
- Host smoke passed and public health attests the exact SHA. Rollback restores
  root-only `/etc/harmonic-beacon/earlybirds-preview.env.pre-2f057e0` and
  recreates only Listener release `04e578b`; retain PostgreSQL and media.

## 2026-08-07 Listener presentation deployment

The isolated Listener was updated to application SHA
`04e578b5d4abc7b73f3ac782abb4dfc6fc70efa8` (image
`harmonic-beacon/earlybirds-preview-listener:04e578b`). This presentation slice
does not change the stream origin, approved media artifacts, audio constants,
event application or membership authority.

- Local and CI checkpoints passed: 1,047 tests, ESLint, TypeScript, production
  build, frozen-audio-path verification, stream-origin checks, observability
  checks and the isolated preview build validation.
- The forward-only migration exited successfully; PostgreSQL, Listener
  liveness/readiness and stream liveness/readiness passed the host smoke. Public
  `/api/health` attests the exact SHA and schema
  `20260806040000_early_birds_listener`.
- Public ES/EN layout passed at 1440 and 390 pixels. A real authenticated
  Chromium pass at 390 pixels reported zero horizontal overflow and zero
  camera/microphone requests.
- The authenticated transport completed introduction, pause, resume, Skip to
  Beacon, Beacon playback and Stop, ending in the truthful `stopped` state.
- `live.harmonicbeacon.com/api/health` and the unchanged stream origin remained
  healthy after replacement.
- Rollback restores root-only
  `/etc/harmonic-beacon/earlybirds-preview.env.pre-04e578b`, selects release
  `0b186df` and recreates only the preview Listener. Preview PostgreSQL and all
  approved media must be retained.

## 2026-08-06 staging deployment record

The isolated preview is currently running on `mona`; this is operational
evidence, not authorization to promote it to `main` or production.

- Listener application image SHA:
  `60bf1182c6ed0d3b946dde103e2e43bb5feb69f9`. Branch head may be a later
  host-tooling or documentation-only commit; `/api/health` attests the exact
  running application image.
- Free authority preview SHA:
  `21c3637ee0f520ee79d20c247e2914699ed8a73a`, with Alembic head
  `b8c4d1e7f260` and paid checkout still disabled.
- Runtime, observability and nginx fixes are on the `early-birds` branch. The
  deployed application health response attests the exact Listener image SHA;
  later documentation-only commits do not require rebuilding that image.
- Both exact hosts have valid Let's Encrypt certificates expiring 2026-11-04
  and emit `X-Harmonic-Beacon-Environment: early-birds-staging`; production
  does not emit that attestation.
- PostgreSQL, migrations, Listener, origin, authority API/worker, Prometheus,
  Alertmanager, node-exporter, cAdvisor and the decoded HTTP segment canary are
  healthy with zero runtime restarts. The authority has no published host port
  and paid checkout remains fail-closed.
- Health exposes the checked-in Prisma head
  `20260806040000_early_birds_listener` instead of `unknown`; the host smoke
  verifies it without requiring Node on `mona`.
- Private drop-ins now answer `HEAD` from metadata and stream only the requested
  byte range. A real authenticated browser observed an 11,210,434-byte ES file,
  a four-byte `206` response, both media elements paused and no media errors.
- Canonical authority responses that contradict `access_allowed` fail closed.
  Segment grants cannot outlive the manifest/lease horizon. Paid checkout's
  future PENDING-to-ACTIVE path now advances durable revisions 1 to 2 while
  providers remain disabled.
- Legacy invitation bearer queries are immediately moved into a short-lived
  `__Host-`, HttpOnly, Secure, SameSite=Lax cookie and redirected to a clean URL.
  Exact invitation entry locations are excluded from nginx access logs on HTTP
  and HTTPS. A synthetic probe confirmed clean redirect, cookie attributes and
  absence from nginx logs.
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
- The origin now serves approved artifact
  `beacon-luz-20260624-2hs-aac320-v2`, derived without gain processing from
  `luz_de_manana_20260624-155633_2hs.wav`. It is AAC-LC 320 kbps, stereo,
  48 kHz, -14.2 LUFS with decoded peak -0.2 dBFS. The private EN intro is
  `amara-sol-en-r1-approved-aac320-v3.m4a`, re-exported on 2026-08-06 at
  18:16 ART with the approved long Beacon fade-in and derived without gain
  processing. It is -11.3 LUFS with decoded peak -0.5 dBFS. The obsolete -35.6
  LUFS ES derivative is disabled and ES remains truthfully unavailable.
  Event/LiveKit audio is unchanged.
- Rollback snapshots are
  `/etc/harmonic-beacon/earlybirds-preview.env.pre-60bf118` and
  `/etc/harmonic-beacon/earlybirds-preview.env.pre-audio-2hs-v2`,
  `/etc/harmonic-beacon/earlybirds-ops.env.pre-audio-2hs-v2` and
  `/etc/harmonic-beacon/earlybirds-authority-deploy.env.pre-21c3637`; the prior
  Listener and authority images remain installed and preview databases must be
  retained.
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
- The 4,000 expansion and 5,000 critical profiles were subsequently dry-run
  across the same two external generators as six and eight shards. The verified
  plans cover every index, sum to exactly 4,000 and 5,000 clients, use two
  distinct generator fingerprints, preserve mode `0600` and attest zero network
  requests. Their plan hashes are respectively
  `67b68f412789c1ae3ad8e950c49480704d5c06f33b445788272a0a73fb73a3dd`
  and `845206f4b8c1e605953a1efd8066b73b9bba87e2487627f3022bd337ec6d44ec`.
  The exact redacted evidence record is
  `docs/ops/evidence/2026-08-07-listener-4k5k-dryruns.md`. No load was executed;
  measured origin, application and customer capacity remain open.

Protected runtime configuration remains under `/etc/harmonic-beacon/`; this
record never includes its values. The supervised human Free invitation is
root-owned and mode `0600` on the host.

This is the non-deploying EB-08 staging lane for exactly:

- `https://earlybirds-staging.harmonicbeacon.com` — Next Listener on host loopback `127.0.0.1:13000`.
- `https://listen.harmonicbeacon.com` — constrained public edge to the same
  Listener, usable only during an operator-controlled Free for All window.
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
- the reviewed HTTPS Listener and stream origins above;
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

## Nginx and TLS handoff

The three host files in `ops/early-birds-preview/nginx/` are standalone vhost
templates. Each names only its exact hostname, includes an ACME webroot path and
the exact future certificate paths, and proxies only its fixed loopback port.
The stream vhost exposes `/healthz` and `/v1/hls/`; container-private `/readyz`
and metrics are not proxied. The Listener vhost exposes the unified Listener
entry canonically at `/`, plus `/api/early-birds/`, Next static assets and health;
legacy `/early-birds/home` redirects to `/`. It blocks `/api/internal/`
and returns 404 for the image's weekend, staff, event and checkout surfaces.
The `listen.harmonicbeacon.com` vhost is narrower: it exposes only `/`, Next
static assets, health, the dedicated Listener OAuth/session namespace, the
exact ordinary-Free schedule endpoint, stream leases/manifests and configured
drop-ins. Synthetic login, invitation,
membership projection and all other app routes remain unreachable from that
host. The application additionally returns a hidden 404 for Better Auth's
email/password endpoints, so the public namespace offers only configured
Google and Apple social providers.

A host operator must review certificate/DNS ownership, provision each named
certificate, install these as new site files, and run `nginx -t` before any
reload. Do not edit, replace, symlink over, or reload the existing live/event
vhost as part of this staging lane.

Keep `EARLY_BIRDS_STREAM_ORIGIN=https://stream.harmonicbeacon.com`. The Listener
runs with `NODE_ENV=production`; its application contract still rejects HTTP
origins. Public HTTPS egress is an explicit staging topology choice, not a
relaxation of production validation.

## Open, stop, and rollback

The emergency public-entry switch is one reviewed command. Always preview the
exact operation first; dry-run takes the same lock and validates the complete
protected environment but writes no backup, changes no value and invokes no
container or HTTP command:

```bash
sudo scripts/early-birds-preview/disable-public.sh --dry-run \
  /etc/harmonic-beacon/earlybirds-preview.env
sudo scripts/early-birds-preview/disable-public.sh --apply \
  /etc/harmonic-beacon/earlybirds-preview.env
```

Apply requires root and a mode-`0600` environment. It takes an exclusive lock,
refuses duplicate switch assignments, creates a timestamped mode-`0600` backup,
atomically sets `EARLY_BIRDS_ENABLED`, `EARLY_BIRDS_FREE_FOR_ALL` and
`EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED` to `0`, and recreates only Listener.
It then requires liveness, readiness and an anonymous lease denial with HTTP
503. PostgreSQL, origin, LiveKit, playlist-bot and the event project are not
targeted. If recreation or smoke fails after the atomic replacement, the script
keeps the flags disabled and stops only Listener rather than risking an older
enabled process.

The command prints the exact backup path. Keep public entry disabled while the
incident is investigated. To roll back a mistaken operator invocation, under
the same maintenance lock copy that exact backup to a new mode-`0600` candidate
beside the env file, run `require_synthetic_env` against the candidate, replace
the env atomically, recreate only Listener with `--no-deps --no-build`, and run
the full preview health smoke plus the intended access-mode smoke. Never restore
an arbitrary or older backup and never roll back the additive database.

After migration, both liveness/readiness probes, nginx syntax, TLS, and
synthetic negative-access checks pass, change only:

```dotenv
EARLY_BIRDS_ENABLED=1
EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=1
```

Recreate the Listener through `start.sh`, rerun the smoke, and exercise only
`@e2e.invalid` synthetic identities with the separate test-login bearer.
Providers with incomplete credentials are absent from both the public UI and
the Better Auth runtime. A shared
preview runtime may instead use `listen.harmonicbeacon.com` as its canonical
OAuth base URL, keep both Listener hosts in `EARLY_BIRDS_TRUSTED_ORIGINS`, and
configure one or both complete provider credential pairs. Synthetic team entry
remains allowlisted only on the staging hostname.
Return both switches to `0` after the supervised team window.

### Optional email magic-link fallback

The fallback remains absent until the existing PMP mail authority implements
the exact private contract in
`docs/architecture/EARLY_BIRDS_MAGIC_LINK.md`. Do not copy or mount its Gmail
OAuth grant into the Listener. After that adapter is deployed on
`earlybirds_authority_private`, apply the additive
`20260807090000_early_bird_magic_link_throttles` migration and configure all
three values together:

```dotenv
EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL=http://pmp-myth-api:8765/api/internal/v1/listener-magic-links/deliver
EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN=<dedicated-32-plus-character-token>
EARLY_BIRDS_MAGIC_LINK_RATE_SECRET=<independent-32-plus-character-secret>
```

Partial or invalid configuration exposes neither the UI nor the auth endpoint.
Rollback clears all three values and recreates only the isolated Listener.

### Ordinary Free listening windows

When Free for All is off, an authenticated account without a canonical Founder
membership may select one recurring two-hour daily window. The selection is
stored separately from commerce and membership state, is authorized from the
server clock, and may be changed only after a rolling seven-day cooldown. The
client supplies an IANA time zone and local wall-clock start; spring-forward
gaps advance to the first valid local minute and fall-back ambiguity uses the
first occurrence. Selecting “listen now” derives that wall-clock value from the
server instant rather than trusting the browser clock.

The exact public endpoint is `/api/early-birds/free-window`: `GET` returns the
current window state for an authenticated session and `POST` requires an exact
trusted `Origin`, a UUID idempotency key and either `now` or a validated local
start minute. Active leases are capped at the end of the current window and a
schedule change evicts existing leases. The global Free for All switch remains
an independent operator override and never creates or edits this schedule.

With Free for All temporarily disabled, the protected staging host can exercise
the complete registered-Free boundary using only unique `@e2e.invalid`
identities:

```bash
sudo scripts/early-birds-preview/registered-free-smoke.sh \
  /etc/harmonic-beacon/earlybirds-preview.env
```

The smoke keeps the synthetic bearer in a mode-0600 curl config, selects a
future schedule, proves idempotent replay and the seven-day cooldown, selects
Listen now for a second account, verifies the exact two-hour lease cap, opens
three devices, observes oldest-device displacement and fetches a valid signed
manifest. It deliberately does not toggle Free for All itself; the operator
must restore the configured public mode and rerun health after the test.

### Operator-controlled Free for All

`EARLY_BIRDS_FREE_FOR_ALL` is independent from the Listener kill switch. Set it
to exactly `1` and recreate only the Listener to let anonymous visitors use the
Listener and configured drop-ins without creating a membership:

```dotenv
EARLY_BIRDS_ENABLED=1
EARLY_BIRDS_FREE_FOR_ALL=1
BEACON_STREAM_ALLOWED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com,https://listen.harmonicbeacon.com
```

Public leases use one non-PII technical account, keep raw browser device IDs out
of PostgreSQL, and retain the same short-lived signed-origin boundary. This mode
does not create a membership or unlock any event, staff, payment or internal
surface. Set `EARLY_BIRDS_FREE_FOR_ALL=0` and recreate only the Listener to end
the moment; anonymous heartbeat and manifest requests then fail immediately,
while normal signed-in membership access resumes. No schema rollback or data
deletion is required.

Before opening the public hostname, verify its certificate, the exact origin
CORS pair above, `/api/health/ready`, an anonymous lease/manifest/playback, and
that `/api/early-birds/auth/session` is reachable without disclosing a session,
while `/api/early-birds/auth/sign-in/email`, `/api/early-birds/test-login` and
`/api/internal/` all return 404.

Normal stop retains all preview data:

```bash
scripts/early-birds-preview/stop.sh /secure/earlybirds-preview.env
```

Incident rollback stops the two public-serving components while retaining
PostgreSQL for diagnosis and a forward fix:

```bash
scripts/early-birds-preview/rollback.sh /secure/earlybirds-preview.env
```

Set `EARLY_BIRDS_ENABLED=0` and `EARLY_BIRDS_FREE_FOR_ALL=0` before the next
start. None of these scripts uses
`docker compose down`, deletes a volume, or targets the event/live project.

## Staging release gate

Record config/test/build output, migration status, smoke output, kill-switch
state, rollback/stop/restart evidence, and the reviewed nginx/TLS handoff. Audio
provenance, external decoded-audio canaries, physical device listening,
load/soak, real identity-provider registration, and commerce reconciliation are
separate release prerequisites; this plumbing does not satisfy or simulate
them. Do not promote this runtime to production without the explicit gates in
`docs/plans/EARLY_BIRDS.md`.
