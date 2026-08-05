# Dual-LiveKit load harness

This is the reproducible protocol-load layer for #99 and the capacity input
to #24. It launches the official LiveKit CLI load tester against two synthetic
rooms: one stage room and one Beacon room. Every declared attendee therefore
has a simulated subscriber connection to each room; stage and Beacon publishers
are additional conservative load.

It does **not** certify perceived audio, browser DOM/media lifecycle, physical
mobile routing, Bluetooth, TURN, or the operator journey. Those remain browser
and human gates in #24.

## Safety model

- Room names are generated as `hb-load-<run>-<language>-stage|beacon`.
- Real event room names are rejected.
- `localhost`, `127.0.0.1`, and `::1` are allowed by default.
- Every remote target requires both `--allow-remote` and an exact confirmation
  containing both generated room names.
- Credentials are read only from `LIVEKIT_API_KEY` and
  `LIVEKIT_API_SECRET`. They are never arguments or manifest fields.
- Manifests are mode `0600` and contain no identities, tokens, audio, video,
  email, or raw CLI output.
- `SIGINT` and `SIGTERM` stop both room generators cooperatively, run the same
  bounded cleanup check, write an `ABORTED` manifest, and exit non-zero. An
  interrupted run is evidence of an attempted run, never a PASS.

Preview a run without credentials or LiveKit:

```bash
npm run load:livekit -- --profile rehearsal-es --run-id rehearsal-20260803 --dry-run
```

Run the small local profile:

```bash
LIVEKIT_URL=ws://localhost:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=secret \
npm run load:livekit -- --profile ci --run-id local-ci
```

For a remote production-like LiveKit node, first dry-run and copy the exact
confirmation printed in the refusal message:

```bash
npm run load:livekit -- \
  --profile rehearsal-es \
  --run-id mona-rehearsal-20260803 \
  --url wss://test-live.example.invalid \
  --allow-remote \
  --confirm-test-rooms 'LOADTEST:hb-load-mona-rehearsal-20260803-es-stage:hb-load-mona-rehearsal-20260803-es-beacon'
```

Never point this command at an active event. The remote rooms must be synthetic
and the operator must monitor LiveKit, CPU, memory, and network on the target.

## Distributed generators

A single generator receiving six simulcast publishers can saturate its own
network path before the SFU reaches capacity. Split a rehearsal across two or
more **distinct generator hosts** with the same committed harness, LiveKit CLI,
profile, run ID, confirmation and UTC start. Choose a start at least 30 seconds
in the future; two minutes gives operators time to launch every shard. Verify
NTP/chrony on every generator first and keep reported clock offset below one
second; synchronized manifest timestamps cannot correct a drifting host clock.

Example for two hosts (run shard 0 on the first and shard 1 on the second):

```bash
npm run load:livekit -- \
  --profile rehearsal-en \
  --run-id rehearsal-en-20260805-a \
  --shard-count 2 \
  --shard-index 0 \
  --start-at 2026-08-05T18:00:00Z \
  --url wss://test-live.example.invalid \
  --allow-remote \
  --confirm-test-rooms 'LOADTEST:hb-load-rehearsal-en-20260805-a-en-stage:hb-load-rehearsal-en-20260805-a-en-beacon'
```

Sharding partitions attendees, publishers and the declared global ramp rate
without rounding anything away. Every identity prefix includes its shard, all
shards join the same two synthetic rooms, and every shard independently observes
the exact **global** participant/publisher counts. Synchronized phases use a
minimum 15-second gap so cleanup can converge before the next absolute start.
The schedule includes the CLI connection ramp because LiveKit starts its
`--duration` timer only after those connections finish.
Missing coordinates, duplicate identities, a late phase, API sampling errors,
extra/missing joins or incomplete cleanup fail closed.

LiveKit CLI reports its track denominator from publishers created by that one
process, so that denominator is incomplete in a shared room. The harness keeps
the raw parsed value for diagnosis but gates each shard against the independently
calculated `local subscribers × global publishers` count. A shard with zero
local Beacon publishers must still receive the one global Beacon track.

Copy the redacted manifests to one trusted operator machine and aggregate them:

```bash
node scripts/livekit-load-aggregate.mjs \
  --output artifacts/load-test/rehearsal-en-20260805-a-aggregate.json \
  artifacts/load-test/rehearsal-en-20260805-a-rehearsal-en-shard-0-of-2.json \
  artifacts/load-test/rehearsal-en-20260805-a-rehearsal-en-shard-1-of-2.json
```

The aggregator writes mode `0600` and refuses overwrite. It emits PASS only
when every index is present, the partitions sum to the profile exactly, every
phase proves the global counts and clean teardown, the harness/CLI/run contract
is byte-equivalent, worktrees are clean and generator host hashes are distinct.
The opaque host hash includes the kernel boot ID: processes on the same running
host remain identical, while separately booted hosted-runner VMs remain
distinct even when their image clones hostname and machine ID.
Keep every source manifest and its aggregate; the aggregate does not replace
target-local telemetry or physical browser evidence.

### GitHub-hosted generators

`.github/workflows/livekit-capacity.yml` is a manual-only two-generator
orchestrator for the case where no two trusted standalone hosts are available.
It runs each shard on a different ephemeral GitHub-hosted runner, pins and
verifies `lk` v2.16.3, schedules both against the same future UTC boundary, and
uploads the redacted source manifests before aggregating them fail-closed.

The workflow uses the `capacity-rehearsal` environment. Restrict that
environment to the `main` branch and provision these environment secrets only
for the lifetime of one isolated target:

- `LOAD_TEST_URL`: credential-free `ws://` or `wss://` URL of the disposable
  LiveKit node. Paths, query strings, fragments, localhost and embedded
  credentials are rejected.
- `LOAD_TEST_API_KEY` and `LOAD_TEST_API_SECRET`: credentials generated only
  for that disposable node. Never copy production LiveKit credentials.

Start the target-local monitor first, then dispatch with a unique synthetic run
ID and at least a 15-minute setup delay:

```bash
gh workflow run livekit-capacity.yml --ref main \
  -f profile=rehearsal-en \
  -f run_id=capacity-en-20260805-a \
  -f start_delay_seconds=1200
```

The target must stay isolated from event rooms and the production LiveKit
process. After downloading and hashing the aggregate plus target telemetry,
remove the disposable container, its exact firewall rules/config files, and
all three environment secrets. Confirm production readiness and restart/OOM
counters after cleanup. A GitHub PASS still does not close #24: physical
browsers, mobile routing, TURN, acoustic quality and the human rehearsal remain
separate gates.

## Profiles and evidence

- `ci`: four attendees, two stage publishers, one Beacon publisher, short
  ramp/soak/reconnect.
- `rehearsal-es` and `rehearsal-en`: 150 dual-room attendees, six simulcast
  stage publishers, one Beacon audio publisher, 20-minute soak, and two
  staggered reconnect waves.
- Every profile declares the Stage codec and layout explicitly. The production
  rehearsal profiles use VP8 with the speaker layout: one 720p spotlight and
  five 180p auxiliary layers per subscriber. This matches the most demanding
  web Stage path without silently mixing VP8 and H264 inside one result.
- H264 remains a separate diagnostic and physical Safari gate. A passing H264
  probe never overrides a failing VP8 rehearsal manifest.

Reconnect waves deliberately reuse the same synthetic identity prefixes after
the previous wave has converged to zero. This measures disconnect/rejoin churn;
it is not an in-place ICE-resume measurement. Browser E2E and the physical
rehearsal cover the SDK resume path.

The JSON manifest binds parameters to the Beacon Git SHA, dirty-worktree bit,
and LiveKit CLI version. It records exact/peak participants and publishers,
poll-observed join p50/p95/p99, cleanup convergence, packet loss, generator
CPU/memory/network deltas, and event-loop delay. Each phase fails unless both
CLI processes exit zero, report every expected track, reach exact room counts,
clean up to zero, and remain below the configured dropped-packet threshold.
If an operator or external watchdog aborts a phase, the manifest records only
the signal and timestamp plus the partial redacted phase metrics. It never
promotes partial results to FAIL/PASS or continues into another phase.
Run the full ES and EN profiles twice and attach all four manifests to #24.

## Target-local telemetry

The generator's own network path is not a reliable control plane under a large
subscriber test. Start `scripts/livekit-target-monitor.py` **on the isolated SFU
host** before traffic. It uses only Python's standard library plus the host's
Docker CLI, reads no environment credential, probes only a loopback health URL,
and writes JSONL evidence mode `0600`.

Use a unique synthetic run ID and output path. The monitor refuses to overwrite
evidence, refuses remote or credential-bearing health URLs, and records no
response body, Docker ID, environment, command output, token, room identity,
audio, or video. A typical isolated mona rehearsal monitors both the temporary
target and the production containers so shared-host impact is visible:

```bash
python3 scripts/livekit-target-monitor.py \
  --run-id rehearsal-en-20260805-a \
  --duration-seconds 1500 \
  --interval-seconds 1 \
  --output /tmp/rehearsal-en-20260805-a-target.jsonl \
  --health-url http://127.0.0.1:3000/api/health/ready \
  --container hb-load-livekit-isolated \
  --container beacon-app \
  --container beacon-livekit
```

For a remote generator, launch the monitor under a target-local supervisor or
`nohup` so losing SSH does not lose samples. Send `SIGINT` or `SIGTERM` for a
cooperative stop; the process writes a final summary and exits non-zero. A
usable artifact must end with `recordType=summary`. The summary includes health
failures/latency, peak host and container CPU, minimum available memory,
physical-interface byte deltas, restart deltas, OOM observation and whether an
operator interrupted it. Each sample also records its collection duration so a
slow Docker daemon is visible instead of being mistaken for a one-second cadence.
Hash the file before copying it to the rehearsal
record; never weaken a failed load manifest because target telemetry looks
healthy.

## Tooling

Install the official `lk` CLI (the CI workflow pins v2.16.3). LiveKit recommends
running large tests from a well-provisioned host and raising file-descriptor and
network limits; do that on the load-generator host before a 150-person run. See
the official [LiveKit benchmarking guide](https://docs.livekit.io/transport/self-hosting/benchmark)
and [LiveKit CLI repository](https://github.com/livekit/livekit-cli).
