# First external Listener HLS smoke

**Status: code-complete but runtime-blocked. This smoke is not ready to
execute.** The fail-closed harness, monitor, canary and policy are complete and
tested, but the restart/OOM preflight blocker below is unresolved on `mona`:
no supported per-container restart/OOM observer exists yet. No monitored smoke
may run until one is implemented and verified (see "Runtime blocker" below).

This is the only approved first network step for Listener capacity evidence. It
drives exactly ten media-plane clients from one external host for a sixty-second
soak. It is media-plane evidence only: it is not end-to-end Listener capacity
evidence, and it proves nothing about 3,000/4,000/5,000-listener capacity and
does not authorize those profiles.

The target is the isolated stream origin on `mona`, which still shares the host
and physical interface with `live.harmonicbeacon.com`. Do not run this while an
event is active. Never run a shard, the canary or the monitor from `mona`.

## Fixed safety boundary

- Wrapper: `tools/early-birds-hls-load/run-staging-smoke.mjs`.
- Policy: `policies/listener-staging-smoke-10.json`.
- Exact origin: `https://stream.harmonicbeacon.com`.
- Profile: ten clients, two starts/second, sixty-second soak, one shard, at
  most 28 request starts/second.
- Conservative media budget: about 4.5 Mbit/s; no capacity claim follows.
- The wrapper refuses a network run without a current signed manifest, a
  decoded external canary and a target monitor. It polls both status files every
  two seconds and, on the first failing or stale check, sends exactly one
  `SIGINT` to the load child, preserving `ABORTED` evidence.

All signed URLs and status files are exactly mode `0600` regular files (never
symlinks), remain outside Git and must never be passed in a command line, issue
or chat. Status files contain only booleans, bounded numeric telemetry, fixed
thresholds, timing and a hashed host fingerprint — never hostnames, URLs,
labels, raw Prometheus/Alertmanager payloads or secrets.

The software never claims `GO`. The wrapper, monitor and canary only report
`PASS`/`FAIL`/`ABORTED` evidence; the named human target observer owns the
`GO`/`NO-GO` decision.

## Roles and terminals

Use two operators, or one operator with three visible terminals:

1. **Target observer:** watches `mona`, Prometheus/Alertmanager, the decoded
   canary and public Listener/live health. This person owns the go/no-go call.
2. **Generator operator:** runs the target monitor, the decoded canary and the
   ten-client wrapper on one NTP-synchronized external host (`daimonmatrix`,
   never `mona`) and can interrupt them immediately.

The monitor, the canary and the wrapper must run co-located on that single
external generator host: the wrapper reads both status files from local disk
and rejects any status whose hashed host fingerprint differs from its own host.
They may not be split across different external hosts.

Open local-only SSH tunnels for both loopback observability services from the
external host:

```bash
ssh -N -L 19090:127.0.0.1:9090 -L 19093:127.0.0.1:9093 mona
```

or as two separate sessions:

```bash
ssh -N -L 19090:127.0.0.1:9090 mona   # Prometheus, loopback on mona
ssh -N -L 19093:127.0.0.1:9093 mona   # Alertmanager, loopback on mona
```

Start the external monitor on the generator host. It checks staging readiness,
stream health and unchanged live readiness, queries Alertmanager directly for
readiness and active non-silenced alerts, queries Prometheus separately for
firing rules, evaluates the immediate stop thresholds from direct instant
queries (host CPU, memory, root disk, egress, TCP retransmits, interface
errors/drops, origin up and the deployed decoded canary) and maintains an
in-process restart/OOM baseline for the exact isolated Listener and origin
containers:

```bash
node tools/early-birds-hls-load/external-target-monitor.mjs \
  --prometheus-url http://127.0.0.1:19090 \
  --alertmanager-url http://127.0.0.1:19093 \
  --status-file /secure/listener-smoke-monitor.json
```

Both URLs must be uncredentialed loopback tunnel origins; anything else is
refused. Every Prometheus scalar query must return exactly one finite result —
a missing, duplicated, ambiguous, `NaN` or `Inf` result fails the probe. A
failing or unreachable Prometheus or Alertmanager fails the probe closed; the
monitor never infers Alertmanager health from Prometheus.

### Restart/OOM preflight blocker

The restart/OOM baseline requires per-container `container_start_time_seconds`
and `container_oom_events_total` series (currently expected from cAdvisor) for
exactly
`earlybirds-preview-listener-1` and `earlybirds-preview-beacon-stream-1`, each
resolving to exactly one finite series. Before scheduling load, run the monitor
with `--once` (it probes twice: baseline plus verification) and confirm a
`PASS` status with `restartBaselineEstablished: true`,
`containerRestartsObserved: 0` and `oomEventsDelta: 0`. If those container
metrics are absent or ambiguous, the monitor keeps reporting `FAIL` — that is
the exact preflight blocker, and it is currently unresolved on `mona` (see
"Runtime blocker" below). The monitor never silently claims zero restarts.
Because the baseline is
in-process, a restarted monitor reports `FAIL` again until it has re-established
and verified a fresh baseline, and the wrapper rejects such a status.

### Runtime blocker: no supported per-container restart/OOM observer

Verified on `mona` (read-only inspection): Prometheus currently exposes **only
the root cgroup** for `container_start_time_seconds` and
`container_oom_events_total`; the exact Listener/origin queries return empty
vectors. cAdvisor logs repeatedly report that it cannot find
`/rootfs/var/lib/docker/image/overlayfs/layerdb/mounts/.../mount-id`.

An earlier diagnosis blamed missing recursive slave propagation on the
cAdvisor `/:/rootfs` bind. An independent audit **disproved** it:

- the running cAdvisor container already has `/` -> `/rootfs` with
  `Propagation=rslave` and still hits the `mount-id` errors;
- Docker 29.6.2 on `mona` uses the containerd image store
  (`driver-type=io.containerd.snapshotter.v1`, `Driver=overlayfs`);
- `/var/lib/docker/image` has no legacy `layerdb`, and
  `docker inspect .GraphDriver` is null.

The actual cause is that the current cAdvisor is incompatible with Docker's
containerd image store for these per-container series. Mount propagation was
never the problem, and the incorrect checked-in rslave change has been
reverted. **Recreating or restarting cAdvisor is not a fix and must never be
treated as one** — with any mount propagation flag it keeps exposing only the
root cgroup for these series.

Therefore the ten-client smoke **cannot start** and stays blocked: the
monitor's exact container queries return empty vectors, every probe reports
`FAIL`, and the wrapper refuses the network run. There is no fallback — no
Docker CLI/API read, no inferred zero, no weakened restart/OOM evidence. No
monitored smoke may run until a supported, read-only per-container
restart/OOM observer is implemented and verified on `mona`. Candidate options
are listed in `ops/early-birds/runbook/README.md` ("Per-container restart/OOM
observability blocker"); none may be implemented, restarted or deployed
without explicit operational approval.

Only after such an observer is deployed and verified, the operator confirms —
through the loopback SSH tunnel — that each of the four exact queries returns
exactly one finite series, not an empty vector:

```bash
for query in \
  'container_start_time_seconds{name="earlybirds-preview-listener-1"}' \
  'container_start_time_seconds{name="earlybirds-preview-beacon-stream-1"}' \
  'container_oom_events_total{name="earlybirds-preview-listener-1"}' \
  'container_oom_events_total{name="earlybirds-preview-beacon-stream-1"}'
do
  curl -fsS 'http://127.0.0.1:19090/api/v1/query' --get --data-urlencode "query=$query"
done
```

Only then run the monitor `--once` preflight above. An empty vector at any
step is a hard blocker: stop and resolve observability first; never treat
missing series as zero restarts or zero OOM events.

## Five-minute baseline

The five-minute baseline is a human/operator requirement observed on the
monitor and dashboards; no software in this slice measures or attests the five
minutes, and a sixty-second result can never demonstrate it. For five
uninterrupted minutes before scheduling load, require:

- the monitor status to remain `PASS` and refresh at least every fifteen
  seconds (which includes: Listener staging readiness, stream health and live
  readiness all passing; the deployed decoded canary at `1`; zero firing
  Prometheus rules; Alertmanager ready with zero active non-silenced alerts;
  no container restart or OOM event);
- CPU below 50%, memory below 70%, root free space above 30%;
- TCP retransmits below 1%, zero interface errors/drops and egress below
  1.5 Gbit/s.

Any failed sample resets the five-minute baseline. Do not continue by treating
a recovered failure as part of the same clean baseline.

## Signed manifest and external decoded canary

After the clean baseline, mint a new origin playlist signature on the staging
control plane using the existing root-only signing secret. Put only the signed
URL in `/secure/listener-smoke-manifest-url` on the external generator, a
regular file at exactly mode `0600` (not a symlink). The URL must be written
less than thirty seconds before the wrapper starts, use the canonical
`/v1/hls/<artifact>/live.m3u8` path and remain valid through the end of the
65-second ramp-plus-soak.

Run the external canary on the same generator host. It fetches the attested
manifest and uses FFmpeg to decode six seconds; it never prints a URL or
decoder error:

```bash
node tools/early-birds-hls-load/external-decoded-canary.mjs \
  --manifest-url-file /secure/listener-smoke-manifest-url \
  --status-file /secure/listener-smoke-canary.json
```

Require a fresh `PASS`, decoded seconds at least six and manifest age at most
eighteen seconds before starting the load. Keep the process running throughout
the load. Stop it after the load completes; the five-minute recovery continues
to use the target monitor and deployed canary.

## Dry-run and sixty-second network run

Choose one run ID and a UTC start far enough ahead to complete the dry-run,
mint/distribute the signed URL and obtain a passing external canary. The network
start must still be within the short signed-URL lifetime.

```bash
node tools/early-birds-hls-load/run-staging-smoke.mjs \
  --run-id listener-smoke-YYYYMMDD-a \
  --start-at YYYY-MM-DDTHH:MM:SS.000Z \
  --evidence /secure/listener-smoke-plan.json \
  --dry-run
```

Copy the exact printed confirmation. Record the numeric UTC offset from
`timedatectl timesync-status`; its absolute value must be at most 100 ms. Use a
new evidence path for the network run:

The network wrapper serializes runs for the same Unix account through the one
non-configurable host path
`/tmp/harmonic-beacon-listener-smoke-10-network-run.lock`. A present lock —
active, stale or ambiguous — refuses the run before preflight or child spawn.
After verifying that no wrapper is running, an operator may remove a stale
lock before the rehearsal; never remove or replace it while a run is active.
This is local coordination, not cross-host attestation: procedure must still
authorize exactly one generator host.

```bash
EARLY_BIRDS_GENERATOR_ROLE=external-load-generator \
node tools/early-birds-hls-load/run-staging-smoke.mjs \
  --run-id listener-smoke-YYYYMMDD-a \
  --start-at YYYY-MM-DDTHH:MM:SS.000Z \
  --evidence /secure/listener-smoke-result.json \
  --manifest-url-file /secure/listener-smoke-manifest-url \
  --canary-status-file /secure/listener-smoke-canary.json \
  --monitor-status-file /secure/listener-smoke-monitor.json \
  --clock-offset-ms MEASURED_OFFSET \
  --confirm 'EXACT DRY-RUN CONFIRMATION'
```

## Immediate abort thresholds

The generator operator sends `SIGINT` immediately when any condition below is
observed. The monitor evaluates the same thresholds on every sample and the
wrapper re-verifies them from the monitor status, so a breached threshold also
aborts the wrapper automatically. Do not wait for an alert's `for` interval:

- staging readiness, stream health, live readiness or either canary fails;
- any Prometheus rule fires, or Alertmanager shows any active non-silenced
  alert or is not ready;
- request errors or rebuffer-equivalent fetch misses exceed 1%;
- manifest p95 exceeds 1 second or segment p95 exceeds 2 seconds;
- any generator scheduling miss, manifest sequence regression, playlist-window
  miss, signed-URL failure or allowlist escape;
- host CPU reaches 50%, memory 70%, root free space falls to 30%;
- egress reaches 1.5 Gbit/s, TCP retransmits reach 1%, or the interface reports
  any error/drop;
- the isolated Listener or origin container restarts or records an OOM event;
- any event/live degradation or doubt about event safety.

The wrapper also aborts automatically, exactly once, when its external canary
or target monitor status becomes failing/stale. Automatic abort does not
replace the target observer.

## Five-minute recovery and decision

The five-minute recovery is likewise a human/operator requirement. After load
exits, stop the external decoded-canary loop and keep the target monitor
running for five minutes. Require all baseline signals to remain clean, the
deployed decoded canary to remain `1`, zero new container restarts or OOM
events and no delayed Telegram alert. Aggregate and review the mode-`0600`
evidence only after that recovery window.

The target observer records `GO` only when the shard evidence is `PASS`, all
ten clients complete, scheduling misses are zero, latency/error/fetch gates
pass, and both the human-observed five-minute baseline and five-minute
recovery were clean. Otherwise record `NO-GO`, retain the redacted evidence,
and do not increase load. A `PASS` from the software alone is never a `GO`.

Before any larger run, add and review intermediate profiles. The required order
starts 10 → 50 → 100 → 250; each step needs its own narrower policy, external
generators with measured ingress capacity, and a separate monitored go/no-go.
