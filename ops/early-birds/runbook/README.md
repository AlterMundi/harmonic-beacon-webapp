# Harmonic Beacon operational alerts

This is the shared Harmonic Beacon operational notification transport, owned
through this repository on the `early-birds` lane. Any appointed operator can
maintain it; it does not depend on Hermes or private agent context. The historical
Compose project/path names stay unchanged to preserve persistent state.

The stack is separate from the event compose project. It observes the
EarlyBirds origin through its private metrics listener and exposes Prometheus,
Alertmanager and node-exporter only on host loopback. Access is through a
ZeroTier/admin tunnel; do not add a public nginx location for metrics or admin.

## Shared transport and current coverage

Use the existing Telegram recipient in Mona's root-owned secret files; do not
create a second bot/group when taking over. `[Harmonic Beacon FIRING/RESOLVED]`
is the common envelope. Host capacity is labeled `production`, `host=mona`;
Listener preview and authority metrics retain their own environment labels.

Current Prometheus coverage: host capacity, Listener origin/canary, membership
Authority and consumer-request queue, plus the fixed host observer:

- HTTPS readiness for Live, Account and Listener;
- existing Analytics/PMP monitor outcome and freshness (including Analytics
  container/database/source-quality checks through its existing monitor);
- Analytics/PMP scheduled backup job outcomes;
- nonempty backup artifact freshness for Live, Account, Analytics and PMP;
- published public Live events still SCHEDULED after their start, excluding test
  events, plus independent schedule-probe and observer-freshness alerts.

`platform-observer.py` runs every minute via the versioned systemd service/timer.
It publishes atomic, aggregate-only metrics to the existing node-exporter
textfile directory. It accepts no arguments, secrets or caller-selected targets.
The fixed Live SQL is a read-only transaction with statement/command timeouts;
it checks the database container's Compose identity first. It reports only
counts and a next-event timestamp, never event titles, identities or credentials.
Root is required for the existing Docker socket and private backup metadata;
the script/unit must remain root-owned and not writable by applications.

Install the reviewed script mode 0755 under
`/usr/local/libexec/harmonic-beacon/platform-observer.py`, and the two units from
`ops/early-birds/systemd/` under `/etc/systemd/system/`. Validate with
`systemd-analyze verify`, `daemon-reload`, then enable/start only
`harmonic-beacon-platform-observer.timer` and start its service. Inspect finite
metrics and Prometheus series before enabling rules. Missing/failed checks stay
unhealthy; they must not publish zero overdue events or healthy backups.
Rollback stops/disables that timer, restores the prior rule file and reloads
Prometheus, then removes only this observer's installed files/metrics.

An overdue event does not become healthy by aging out: use authenticated Staff
to open the right event or explicitly cancel/reschedule it after determining
what happened. A historic SCHEDULED row needs disposition, not silent filtering.
The next-event timestamp is zero when no future published public event exists;
that does not disprove an event announced outside the database.

Artifact freshness is not integrity, off-host replication or restore proof.
Live/Account currently have release-time artifacts; this observer does not add a
recurring backup job for them. Home and total-Mona outages still need independent
off-host monitoring. A common receiver does not imply those checks exist.

Transactional email (login links, receipts, customer messages) remains on its
own delivery path: never send those payloads to this operational group.

On Mona, install the reviewed client with mode 0755 at
`/usr/local/libexec/harmonic-beacon/beacon-notify.py`. It needs Python 3 and local
Alertmanager, not a Telegram token, Docker access or sudo at execution time:

```bash
python3 /usr/local/libexec/harmonic-beacon/beacon-notify.py \
  --service live --name LiveEventDoorsClosed --severity critical \
  --summary 'Scheduled public event has started with doors closed'
```

The installed observer supplies the event-schedule monitor; this example shows
how another producer can use the same notification transport.
Use `--dry-run` for validation. Producers refresh ongoing alerts before `--ttl`
(default 900 seconds), and send `--resolve` with the **same service, name,
severity and environment** after verifying recovery. Alert expiry means the
producer lease ended, not proof of service health; persistent monitors also
need an independent freshness alert. Choose TTL longer than the warning delay.
Use stable alert names, bounded operational summaries and repository runbook
paths; no secrets, email addresses, customer/event identifiers or raw errors.
The script always submits to loopback and ignores HTTP proxy variables.

Delivery drill: submit `BeaconTransportCheck` for `service=ops`,
`environment=staging`, `severity=critical`, explicitly described as synthetic;
verify Alertmanager's Telegram success/failure counters, then send the matching
resolved update and verify another successful notification. API acceptance alone
is not delivery proof. Telegram acceptance is not proof a human read the message.
Do not disable a real service to exercise this path.

Alertmanager and Prometheus remain private on Mona. A host/network outage can
prevent them from reporting their own failure; independent off-host monitoring
is still needed for that failure mode. Local host access is the trust boundary:
do not expose the unauthenticated Alertmanager API through public nginx.

## Capacity and safe cleanup

Warning is below 20% for 15 minutes; critical is below 15% for two minutes.
Maintenance targets 35% free space, but never deletes recovery/data to meet it.
If retained data exceeds capacity, expand storage or explicitly review artifacts;
a quieter reminder schedule does not resolve a low-disk condition.

`storage-maintenance.py` is a fixed host policy, not a general-purpose prune
interface. Default invocation is a read-only plan; `--apply` is root-only.
The systemd path unit schedules it on Account/Listener/Live delivery-state
changes, including Account completion receipts. It must not watch directories
containing deployment locks: opening a lock can otherwise start cleanup before
the delivery process acquires it. The timer retries every 15 minutes,
covering failed builds and changes that happened while a delivery lock was held.
No new GitHub jobs, Docker builds, caller-supplied paths or sudo grants are needed.

The policy:

- Retire only exact reclaimable, unshared BuildKit cache IDs older than 72 hours
  (24 hours below 20% free), with a second inventory check. Verify image IDs did
  not change. Never prune volumes, containers, shared cache or unrelated repos.
- Retain all container-bound images, explicit rollback tags, the newest three
  images per service repository, and images younger than three days. Resolve
  rollback images from Account delivery records bound to active images,
  Listener production/staging records, and the fixed Live/media transaction.
  Preserve an entire repository when any active image lacks recovery evidence.
  A running container whose image-store metadata is missing also stays protected;
  it is not a usable recovery image. Analytics/PMP images remain untouched until
  their own delivery records can be bound by a supported adapter.
- Below 35% free, archive at most two eligible historical images per run onto
  `/mnt/beacon-data/archives/runtime-images`. Verify all OCI blob hashes, a
  Docker load roundtrip, zstd integrity and archive checksum; sync the archive,
  manifest and directories before removing exact local image references.
  Acquire existing delivery locks first, including creating missing lock files.
  Busy delivery defers cleanup; no force removal is allowed.
- Keep verified archives for at least seven days after their latest retirement,
  normally 30 days, with a 20 GiB budget and 10 GiB data-disk reserve. Protected
  recovery images do not expire. Count partial archives against the budget and
  preserve them for inspection; a partial candidate does not stop other eligible
  candidates. Existing manual archives and database backups are outside this
  policy and retain their separate recovery/retention contracts.

Install the reviewed script as root:root 0755 at
`/usr/local/libexec/harmonic-beacon/storage-maintenance.py`. Create the archive
and `/var/lib/harmonic-beacon/storage-maintenance` directories root:root 0700;
the data disk must be mounted. Install its `.service`, `.timer` and `.path` from
`systemd/` under `/etc/systemd/system/`, validate with `systemd-analyze verify`,
and run the read-only plan before starting the service. Inspect its private
`last-result.json`, exact before/after container image bindings and public
readiness. Enable the timer/path only after that first successful run. Apply
Prometheus rules after the initial metrics exist. Failure and two-hour staleness
use the same shared alert transport; low disk remains independently monitored.

Rollback disables/stops only the maintenance timer/path, then stops the service
if necessary. It does not restore retired images automatically: verify the
selected `verified.json` checksum, decompress to a private file on the data
mount, `docker image load`, and inspect the exact image ID before any service
rollback. Preserve partial archives when stopping an in-progress run.

Check `df -h / /mnt/beacon-data`, `docker system df`, and the read-only plan when
investigating capacity. Never use `docker system prune`, volume pruning or
blanket image removal.

## Configuration delivery and rollback

No application build or service replacement is needed. Inspect the running
Prometheus/Alertmanager mounts to find the exact deployed files (they may refer
to historical release directories). Preserve root-only copies of their current
configuration and template before applying changes. Render the new Alertmanager
config using the **existing private recipient**, validate with the deployed
`amtool check-config`, and validate rules with deployed `promtool check rules`.
Validate the new template too. Update the mounted file contents (do not rename a
single-file bind mount), then signal only the affected process with SIGHUP.
Read back reload-success metrics, exact configuration/rules and the bounded
Telegram drill. On failure restore those saved bytes and SIGHUP again. Never
print the rendered config: it contains the private recipient. Record source SHA,
file hashes, rollback directory and delivery evidence in the owning issue.

## Bootstrap and secrets

Create the private Telegram group **Harmonic Beacon · Ops**, create a dedicated
bot, add it to the group, and store each value in a separate root-owned `0600`
file outside Git. `TELEGRAM_BOT_TOKEN_FILE`, `TELEGRAM_CHAT_ID_FILE` and
`BEACON_STREAM_SIGNING_SECRET_FILE` point to those files at Compose runtime.
The bot token is consumed by Alertmanager as a Docker secret; the chat ID is
validated as an integer by the short-lived config initializer. No credential,
signed URL, email, account identifier, request path or raw webhook is included
in an alert.

Bring up the bounded preview services only after the stream compose created the
private `earlybirds_stream_observability` network:

```bash
docker compose --project-name earlybirds-observability \
  --env-file /etc/harmonic-beacon/earlybirds-ops.env up -d --build
```

`npm run validate` validates Compose, Prometheus rules/config and Alertmanager
config with generated fake secrets; it never contacts Telegram.

The included canary reads the HMAC secret from its mounted file and mints a
fresh, <=120-second manifest URL for every probe using the same canonical GET
path contract as the origin. It verifies the HLS manifest, fetches a non-empty
signed segment and asks FFmpeg to decode six seconds of the complete fMP4
playlist. Signed URLs and decoder errors are suppressed from logs; the exporter
publishes only success, duration, byte count and manifest age. This proves that
the deployed artifact is continuously decodable, not subjective listening
quality. Move the same bounded canary to an independent VPS before a production
capacity claim so it also exercises an external network path.

## Alert behavior and immediate action

Warnings wait five minutes, group by service/alert/environment/host and repeat every
six hours. Root-disk capacity warnings repeat every twelve hours; a matching
critical disk alert inhibits the warning while critical is active. Critical alerts notify immediately and repeat every 15 minutes. All
receivers set `send_resolved: true`, so recovery messages are mandatory.

| Signal | Warning | Critical | Immediate action |
| --- | --- | --- | --- |
| Origin/canary | manifest age >18s | origin unavailable, decode failed, no completed probe for 90s, age >60s | Check private `/readyz`; stop only the EarlyBird origin if it affects host safety. |
| Origin quality | 5xx ≥0.5%, p95 >1s | 5xx ≥2% | Inspect origin logs without copying signed URLs; verify artifact and source state. |
| Host | CPU >50%, memory >70%, disk <20% | CPU >75%, memory >85%, disk <15% | Prepare/move capacity; never reclaim event volumes during an incident. |
| Network | sustained egress >1.5 Gbit/s, expansion >1.8 Gbit/s for 5m, retransmits ≥1% or interface errors | egress >2.25 Gbit/s for 2m or retransmits ≥3% | Activate the prepared Bunny pull distribution, then verify cache/origin error rates. |

The planning envelope is 450 kbit/s per listener: 3,000 committed (~1.35
Gbit/s), 4,000 expansion (~1.8 Gbit/s), and 5,000 critical (~2.25 Gbit/s).
Measured external soak throughput replaces these thresholds before launch. A
Bunny activation is justified by either the 4,000 expansion threshold, the
critical threshold, persistent 5xx/rebuffer evidence, retransmits ≥1%, or a
healthy origin whose direct egress remains the bottleneck. It is not activated
solely from an advertised NIC speed.

## Paid Listener authority

Prometheus joins the authority's existing private Docker network and scrapes
`pmp-myth-api:8765/metrics`. The authority port remains loopback/private and no
nginx location exposes metrics. Exported payment labels are fixed provider,
environment, operation, outcome, job kind and job status values; no account,
email, provider subscription ID, checkout URL, webhook body or signature is
exported.

Operational signals cover authority reachability, provider readiness while
new sales are enabled, the oldest durable paid job, failed lifecycle/projection
jobs, invalid webhook signatures and checkout provider errors. The request
counters are process-local; `pmp_listener_paid_observer_process_start_time_seconds`
separates restart epochs. Database queue gauges remain durable across API
restarts. Queue age includes only due, immediate jobs; scheduled renewal locks
and checkout-expiry recovery do not page before their `available_at`. Failed-job
alerts use a rolling 15-minute window, so historical pre-release failures stay
auditable without remaining permanently active.

Immediate actions:

- **authority/provider:** turn off new sales in Listener and authority, but
  leave webhooks, reconciliation and existing membership access running;
- **queue/projection:** inspect only aggregate job status first, retry or
  reconcile through the durable authority path, and never infer access from a
  browser redirect;
- **webhook signatures:** verify the exact provider environment and registered
  endpoint before changing a secret; do not log or paste webhook bodies;
- **recovery:** wait for the matching resolved Telegram notification and a
  green authority target before reopening sales.

Fault injection uses a synthetic Alertmanager alert with fixed labels and an
explicit end time, followed by a resolved update. It must never disable the
origin or any event container. A deliberately missed sandbox webhook is
repaired by the provider reconciliation worker, then the canonical Listener
projection is verified before the drill is considered complete.

## Per-container restart/OOM observability blocker

Per-container start, restart and OOM continuity for the isolated Listener and
origin is a hard prerequisite for the Listener external smoke (see
`docs/ops/LISTENER_FIRST_EXTERNAL_HLS_SMOKE.md`). The original cAdvisor-backed
`container_start_time_seconds` and `container_oom_events_total` design remains
unusable on `mona`: Prometheus exposes only the root cgroup and cAdvisor logs
that it cannot find
`/rootfs/var/lib/docker/image/overlayfs/layerdb/mounts/.../mount-id`.

An earlier change blamed missing recursive slave propagation on the cAdvisor
`/:/rootfs` bind and was **reverted as incorrect**: an independent audit showed
the running cAdvisor container already has `/` -> `/rootfs` with
`Propagation=rslave` and still hits the same errors. Docker 29.6.2 on `mona`
uses the containerd image store (`driver-type=io.containerd.snapshotter.v1`,
`Driver=overlayfs`); `/var/lib/docker/image` has no legacy `layerdb` and
`docker inspect .GraphDriver` is null. The real cause is that the current
cAdvisor is incompatible with Docker's containerd image store for these
per-container series.

**Recreating or restarting cAdvisor is not a fix and must never be proposed or
treated as one** — no mount propagation flag changes this.

The reviewed code path is now a root-owned host observer:
`scripts/listener_container_observer.py` and the
`harmonic-beacon-listener-container-observer` systemd timer. It accepts no
caller-controlled target/path, performs only one fixed `docker inspect` for the
isolated Listener and origin, verifies exact Compose labels, stores a durable
root-only epoch/counter state and exports fixed-role metrics through the
existing node-exporter textfile directory. Private networking, AF_UNIX-only and
strict filesystem controls bound the unit; no Docker socket is mounted into an
application container.

This implementation remains **not installed by code merge**. Installation on
`mona` requires a separate operational review because Docker read access is
root-equivalent. It must not restart Docker, cAdvisor, Listener, origin or any
event service. Until the unit is explicitly installed and all observer
health/freshness/epoch/start/restart/OOM queries return exactly one finite
series, the ten-client smoke remains runtime-blocked. Empty, duplicated, stale
or reset series are a hard blocker, never a reason to proceed. Exact install,
verification and revocation commands live in
`docs/ops/LISTENER_FIRST_EXTERNAL_HLS_SMOKE.md`.

The bounded ten-client wrapper also requires its fixed local lock at
`/tmp/harmonic-beacon-listener-smoke-10-network-run.lock`. The path has no CLI
or environment override. A pre-existing lock refuses the run; verify no
wrapper is active before removing a stale one, and never manipulate it during
a run. This serializes one trusted Unix account on one generator only; it does
not enforce a global limit across hosts.

## Stop switch and rollback

To stop only the EarlyBird stream origin:

```bash
ops/early-birds/scripts/stop-stream.sh /etc/harmonic-beacon/earlybirds-stream.env
```

It pins `--project-name earlybirds-preview` and the isolated stream compose
file; it cannot target the event stack. Restore with the same env file and
`up -d beacon-stream` only after the canary and `/readyz` recover. The Listener
entry feature flag is owned by the application lane and must be disabled there
for a truthful public unavailable state; this ops slice never changes event
routes or data.

### Periodic Live and Account backups

`harmonic-beacon-periodic-backups.timer` runs at 00:15, 06:15, 12:15 and
18:15 UTC with up to five minutes of jitter and catch-up after downtime. The
fixed script dumps only production `beacon-postgres` and
`earlybirds-preview-postgres-1` (the shared Account/Listener database), verifies
their Compose identities and coordinates with delivery locks. It does not
migrate, restart or write to either source database.

Encrypted custom dumps and SHA-256 sidecars live under
`/mnt/beacon-data/backups/platform/{live,account}`. Missing separate mount or
less than 10 GiB free fails closed. Each dump is encrypted for the two existing
recovery recipients in `/etc/harmonic-beacon/analytics-backup-recipients.txt`,
decrypted with the existing root-only `analytics-backup-identity.txt`, compared
byte-for-byte by digest, and checked with `pg_restore --list` before publication.
This checks the encrypted archive; it does not claim a full database restore.
Plaintext exists only in a root-private temporary directory on the data disk
and is removed on normal completion or failure. After a host crash, inspect any
`.stage-*` directory before removing it; it is never counted as a valid backup.
No credentials or database stderr are written to the service log.

Retention removes only this script's exact service-prefixed files older than
14 days, always keeps the three newest and requires matching checksum sidecars.
Deployment backups and unrelated archives remain untouched. The platform
observer measures these production artifacts and the oneshot result; failures
and stale backups use the shared Telegram route.

Install the reviewed script as root:root 0755 under
`/usr/local/libexec/harmonic-beacon`, create the backup root as root:root 0700,
and install the service/timer from `ops/early-birds/systemd`. Validate with
`systemd-analyze verify`, execute the service once and verify both encrypted
artifacts before enabling the timer and switching observer paths. Preserve
prior observer bytes for rollback. To recover, verify a selected sidecar,
decrypt with either authorized recovery identity into a private directory and
restore first into an isolated PostgreSQL 16 instance; never overwrite a live
database as a backup test.
