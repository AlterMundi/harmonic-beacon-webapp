# EarlyBirds preview operations

This stack is separate from the event compose project. It observes the
EarlyBirds origin through its private metrics listener and exposes Prometheus,
Alertmanager and node-exporter only on host loopback. Access is through a
ZeroTier/admin tunnel; do not add a public nginx location for metrics or admin.

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

Warnings wait five minutes, group by service/alert/environment and repeat every
hour. Critical alerts notify immediately and repeat every 15 minutes. All
receivers set `send_resolved: true`, so recovery messages are mandatory.

| Signal | Warning | Critical | Immediate action |
| --- | --- | --- | --- |
| Origin/canary | manifest age >18s | origin unavailable, decode failed, no completed probe for 90s, age >60s | Check private `/readyz`; stop only the EarlyBird origin if it affects host safety. |
| Origin quality | 5xx ≥0.5%, p95 >1s | 5xx ≥2% | Inspect origin logs without copying signed URLs; verify artifact and source state. |
| Host | CPU >50%, memory >70%, disk <30% | CPU >75%, memory >85%, disk <15% | Prepare/move capacity; never reclaim event volumes during an incident. |
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
