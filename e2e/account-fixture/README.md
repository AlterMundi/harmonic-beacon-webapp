# Isolated navigation Account gate — external identity simulation

This is **test-only simulation of the external identity provider**, not an implementation,
mock, or acceptance certification of Beacon Account. Live runs its **unchanged production
RP and authorization**. Nothing here belongs in production deployment/configuration.
The existing main/legacy Playwright stack keeps Account disabled and dashboard login.
The two Account sign-out cases explicitly skip there; they are mandatory (no skip) in
this separate configuration. A presentation flag alone cannot qualify sign-out.

## Why this fixture is different

- Browser follows `/api/account/login` → loopback HTTPS issuer → real callback. The RP
  creates its own one-use state/PKCE/nonce attempt, validates a fresh signed ID token
  against actual JWKS, issuer/audience/time/nonce, introspection and UserInfo, then
  creates its own WebSession. No synthesized session cookies, future `validatedAt`,
  mocked `prisma`/RP/app authorization, or cached-identity bypass.
- Only fixture staff bindings are seeded, against the existing fixture operator,
  **assigned facilitator**, and admin. Account names/emails do not grant roles.
  The synthetic audio publisher uses this same Account flow on the isolated stack,
  then the existing reconciled grant/token/publication activation path.
- The isolated Spanish test event is public. The real entry API creates/attaches the
  Account-owned public entitlement and confirms the alias through its real PATCH
  endpoint. No ticket/session binding is injected by a login helper.
- Logout first invokes the real same-origin `/api/auth/logout` after room confirmation.
  The test verifies its signed issuer URL and reads back the revoked RP row. The
  simulated issuer verifies HMAC/client/issuer/SID/expiry/return/state, presents an
  explicitly simulated central confirmation, revokes on POST, and returns to Live.
  The test then reads central session-status back as inactive. This is **not** a
  claim that the simulator's form is the real Account UI or frontchannel integration.
- Fresh/stale identities use ordinary RP behavior. `rp.spec.ts` deliberately makes
  the real validation timestamp **older**, then proves the real authenticated
  backchannel refreshes it. Unknown/disabled staff binding and mismatched attendee
  ownership must fail closed. The unbound subject authenticates externally but
  cannot become staff.

## Applicable browser and media contract

The Account selection has **70 applicable cases**, not 72 executed successes:
18 Chromium + 18 Firefox + 17 Android Chrome + 17 iPhone WebKit. Only the
`@desktop-native-staff` open-drawer native-reload test is structurally excluded
from the mobile projects. Mobile same-document Back/cancel, locale/capture, real
Account sign-out Stay/Escape and RP tests remain mandatory; emulation is not
physical-device native-unload acceptance.

Continuity starts exactly one Account-authorized stage publisher and the reused
#495 Beacon-only synthetic publisher (`beacon01`). The stage still uses facilitator
login, the real stage token and real publication activation. Test-only publisher
contexts trust the fixture TLS certificate. Each receiver must have exactly two
native RTC audio sources, matched to the publishers' participant/publication SIDs,
distinct tracks and independently advancing clocks. Only LiveKit's identified
`livekit-dummy-audio-el` is excluded. Retained transitions preserve document,
elements, streams and tracks with no extra capture/reconnect; intentional mute or
zero gain is not called blocked playback. No new receiver WebAudio graph is used.
This is software playback evidence, not physical audibility or speaker routing.

The Staff drawer's real top-level Hands pointer gesture supplies sticky activation;
scheduled `location.reload()` requests the native prompt (automation reload bypasses
Firefox's guard). Exactly one dismissal must retain the drawer/document/both media.

## Parent setup: no existing/shared stack is used or mutated

Run from the **assembled integration worktree**, after the non-overlapping product
fixer has finished. Common requirements: Linux; OpenSSL; pinned project dependencies
and generated Prisma client; installed Playwright Chromium, Firefox and WebKit plus
OS dependencies. Chromium-only executable overrides do not apply to Firefox/WebKit.
Do not install or upgrade dependencies in a concurrently edited worktree.

Select exactly one backend with `E2E_ACCOUNT_BACKEND=docker|native` (default Docker):

- **Docker / CI:** real Docker daemon, `postgres:16-alpine` and
  `livekit/livekit-server:v1.13.4` (never `latest`). Image IDs/repository digests are
  recorded. No Docker shim, native fallback or shared server attachment.
- **Native / parent Incus job:** run the **whole runner as an existing unprivileged
  test user**; root is rejected before any resource is started. The runner creates a
  random 0700 job directory and exclusive `pgdata`, generates a random SCRAM password,
  runs `initdb`, and starts its own foreground `postgres` process group. It verifies
  authenticated `data_directory` ownership before `CREATE DATABASE beacon_test`.
  Native `psql -X -v ON_ERROR_STOP=1` restores the committed COPY/meta-command dump,
  then refreshes only the historical test entitlement expiry, just like the Docker
  loader. Existing URL checks and read-only preflight instance guard remain intact.
  Native restore is single-use; no existing DB/app or PG data directory is adopted.
  It starts a separately ported foreground LiveKit process group, not a service.
- Native defaults: `E2E_ACCOUNT_PG_BIN=/usr/lib/postgresql/16/bin` and
  `E2E_ACCOUNT_LIVEKIT_BIN=/usr/local/bin/livekit-server`. Absolute resolved paths,
  `initdb/postgres/pg_ctl/psql` **16.15** and LiveKit **1.13.4** versions are checked;
  native executable SHA-256s are retained. A mismatched install is a hard failure,
  not an automatic download or version substitution. PG16.15 supports the pinned
  dump's `\restrict` meta-command.

Free ports required: TCP 3410–3413 (TLS Live/issuer/LiveKit and private Next),
35432 (private Postgres), 34880–34881 (private LiveKit), UDP 34900–34920 (private RTC).
They are checked before setup; bind conflicts fail, never reuse another server.
App/PG/signalling bind loopback. Native RTC discovers the actual container NIC:
**no native `rtc.node_ip: 127.0.0.1`**, which breaks Firefox ICE. RTC ports are
job-owned but reachable on that interface; use an isolated test container/network.
Only Docker retains its loopback mapped-RTC configuration.

```sh
# Isolated adapters, filesystem/process/socket regression tests; no real stack.
node --import tsx --test e2e/account-fixture/runtime-backend.test.ts
node --import tsx --test e2e/account-fixture/protocol.test.ts

# Docker CI (default): real RP first, then complete four-project matrix.
node --import tsx e2e/account-fixture/run.ts --grep 'Account RP'
node --import tsx e2e/account-fixture/run.ts

# Native, INSIDE the parent's test container as an unprivileged test user.
# Requires that same user's job-private Pulse setup below for Firefox audio.
E2E_ACCOUNT_BACKEND=native node --import tsx e2e/account-fixture/run.ts --grep 'Account RP'
E2E_ACCOUNT_BACKEND=native node --import tsx e2e/account-fixture/run.ts
```

### Clean runtime environment and private Pulse

The runner propagates only PATH/HOME, normalized CI, validated installed
`PLAYWRIGHT_CHROME_EXECUTABLE` / `PLAYWRIGHT_BROWSERS_PATH` absolute paths, and an
optional validated Pulse Unix socket. It **sets**, never blindly inherits,
`NODE_OPTIONS=--max-old-space-size=2048`; arbitrary `--require`/loader/heap options
are dropped. TMPDIR and all app/DB/Account/LiveKit credentials are job-generated or
explicitly test-only; dotenv, production DB URLs, cookies/tokens and cloud secrets
are not copied or passed to children. Next must match the pinned source version;
its actual `build --help` must advertise `--webpack` before retaining the flag.
The future canonical reconciliation is Next 16.3.4; the runner checks the actual
assembled source pin and installed version, never substitutes a version or uses npx auto-install.

Firefox's native audio backend needs the parent's Pulse setup. If `PULSE_SERVER`
is present, it must be exactly `unix:/absolute/job-private-dir/socket` with
`E2E_ACCOUNT_PULSE_DIR=/absolute/job-private-dir`: directory mode 0700, directory
and socket owned by the runner UID, a real Unix socket, no symlink or TCP fallback.
**Do not reuse the root-owned `/work/evidence/ci-audio.sock` when switching user,
set anonymous authentication, or weaken its cookie permissions.** Start a new
foreground same-user instance with normal cookie authentication, for example:

```sh
# Parent-owned setup, NOT something this worker runs in the shared container.
# Run under the unprivileged test user's HOME with installed pulseaudio/pactl.
test "$(id -u)" != 0 || exit 1
umask 077
audio=$(mktemp -d /tmp/navigation-account-audio-XXXXXX)
pulseaudio --daemonize=no --use-pid-file=no --exit-idle-time=-1 \
  --log-target="file:$audio/pulse.log" -n \
  --load="module-native-protocol-unix socket=$audio/native auth-anonymous=0" \
  --load="module-null-sink sink_name=account_ci" &
pulse_pid=$!
# Wait for the socket and verify same-user cookie authentication (bounded).
for i in $(seq 1 100); do test -S "$audio/native" && break; sleep 0.05; done
PULSE_SERVER="unix:$audio/native" pactl info
export PULSE_SERVER="unix:$audio/native" E2E_ACCOUNT_PULSE_DIR="$audio"
E2E_ACCOUNT_BACKEND=native CI=1 NODE_OPTIONS=--max-old-space-size=2048 \
  node --import tsx e2e/account-fixture/run.ts --grep 'Account RP'
# Then repeat without --grep for all four projects. Stop only your own Pulse PID.
kill -TERM "$pulse_pid"
```

The handoff evidence directory includes `run-parent-native.sh`, an executable
bounded wrapper with a trap for that same-user Pulse process and both run phases.
It does not create users, enter Incus, install binaries, mutate a shared DB, or
start/stop system services; the parent chooses the assembled checkout and user.

The runner loads the historical test fixture **then applies current Prisma
migrations**, and seeds only its private bindings/public test event. An instance
marker is verified read-only by `preflight.ts` before browser tests mutate state.
It recursively copies allowlisted source/build inputs into a new temporary checkout,
excluding dotenv, symlinks, Git/index, outputs and dependencies; it links the already
installed dependency tree. The allowlist includes the root `playwright.config.ts`
because build-time contract tests import its exported project definition. It
builds/starts that copy, not this worktree's `.next`.

HTTPS is required for real `__Host-` state and Secure session cookies. The runner
creates an ephemeral loopback certificate, passes it via `NODE_EXTRA_CA_CERTS` to
Node children (TLS verification remains enabled), and enables Playwright's test-only
`ignoreHTTPSErrors` for that certificate. No weakening of production cookie/auth rules.
The issuer has a process-local signing key, correct fixed **test-only** client Basic
credentials, test-user password, one-use PKCE codes, active-SID backchannel and signed
logout verification. Discovery endpoints never leave loopback. Browser contexts do
not mirror/downgrade Secure cookies.

Normal completion/failure and SIGINT/SIGTERM stop only the runner's spawned Linux
process groups (TERM, then bounded KILL for stubborn descendants), owned Docker CID
files, and isolated servers. Both sides of upgraded WebSockets are explicitly
closed. App/native LiveKit readiness requires their own listening socket in `/proc`,
not an arbitrary HTTP 200; inaccessible `/proc` fails closed. Cleanup errors are
recorded and fail the run, not silently reported as success. SIGKILL/host loss cannot
run traps: the parent must inspect the printed private directory and owned resources.

Retained evidence is deliberately distinct:

- `runtime.json`: backend, exact native versions/binary hashes or Docker image IDs,
  Next/Playwright versions, source checkout, selection arguments, stage and cleanup.
- `source-sha256.json`: exact copied build/test inputs (including uncommitted source).
- `logs/`: numbered command/server stdout+stderr, including CLI checks, build and
  engine-labelled Playwright output; output is logged here rather than discarded.
- `results/report.json`: all four project/engine results including explicit skips;
  `results/artifacts/`: available failure traces/screenshots, not promised on success.
- Copied checkout/build and test-only certificates/secrets. Native stopped PG files
  are retained, **not a portable DB snapshot**. Docker tmpfs DB is discarded; no DB
  snapshot is claimed. Keep this sensitive test evidence private and expire it.

When the browser command fails, public CI emits one
`ACCOUNT_PLAYWRIGHT_FAILURE_SUMMARY` JSON object containing only allowlisted
project name, repository-relative spec path, terminal line/column when Playwright
binds it to that same allowlisted spec (otherwise the declaration location), result class,
and aggregate counts. The allowlists are closed to the four configured Account
projects and two configured Account specs; every other identifier becomes
`<redacted>`. The summary omits test titles, raw errors, stdout/stderr,
attachments, URLs, credentials, absolute paths, and private report contents;
those remain in the retained private evidence. Separately, the launcher's
existing lifecycle output identifies the ephemeral retained directory and the
failing command's logfile path so the runner owner can inspect or clean it; it
does not print that logfile's contents. Only tests whose reporter-level outcome is
`unexpected` are included, and their class comes from the terminal retry rather
than an earlier failed attempt; an explicit aggregate zero remains zero. If the
report cannot be parsed, has an invalid required structure, or is internally
inconsistent, the public summary is exactly `unavailable` rather than the parse
or validation error.

Never point the standalone config at a shared database or export Account variables
into the main stack; use the runner. Missing fixture opt-in/config/instance marker
is a hard gate failure, not a degraded-stack pass. A selected `--grep`, `--project`
or `--list` command does **not** qualify omitted cases or the full browser matrix.
The projects are `chromium-account`, `android-chrome-account`, `firefox-account`,
`iphone-webkit-account`; there are no new project-level skips. CI sets `forbidOnly`.

## Locale/capture and drawer acceptance

`ThumbnailSender` remains default-on for initial **VIDEO-only** capture with
`audio:false`. The probe now counts every capture attempt before resolving/rejecting.
An opt-in device-denial simulation on the full real app expects **one initial video
attempt and zero audio attempts**, then no extra attempts across EN/ES/EN. It does not
replace authorization, LiveKit, playback or room code. The ordinary successful-camera
locale cases remain. Unit tests also cover denial pending across locale, current error
copy, explicit retry, acquired-camera preservation and opt-out.

Staff outer navigation is clicked only **after** the real drawer return control closes
the backdrop. A separate desktop test opens Hands and cancels the browser's reachable
Reload action, verifying the same drawer/document/media survive. No force click,
programmatic link dispatch or CSS-free component substitute. Mobile native-unload
exclusion is explicit and is not a pass.

## Evidence boundaries / fix cycle 1

Locally executed: protocol HTTP/JWKS/credential/PKCE/introspection/session-status/logout
checks; focused Thumbnail unit tests; TypeScript and scoped lint. Causal Thumbnail RED
counts the extra denied request, not an import error. Browser tests above are provided
for the parent to execute on its assembled stack. This host has no Docker executable;
therefore **real RP + DB browser execution, drawer CSS/native behavior, combined RTP,
audible output and hardware acceptance remain unqualified here**. Unit/protocol tests,
component previews and Playwright listing do not count as those gates.

Runtime finalization adds isolated command-adapter/native ownership tests, real
local process-group/socket cleanup regressions, safe Pulse-env checks and the
four-project config. Those gates pass locally; **neither actual Docker nor native
PG/LiveKit/browser stack qualification was run by this runtime worker**. The shared
`hb-live-batch-test` container/DB was not touched. Parent execution as an unprivileged
user with its own same-user Pulse instance is still required; successful collection
is not media, native-unload, audible-output or real Account certification.
