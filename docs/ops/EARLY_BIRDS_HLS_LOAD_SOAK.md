# EarlyBirds external HLS load and soak

## Purpose and boundary

This procedure produces reproducible HTTP capacity evidence for the isolated
EarlyBird origin/CDN media plane. All traffic generators run on independent external hosts;
the event/production VPS `mona` is only observed as a target and must never
generate significant load. The procedure is forbidden against live production.

It does **not** load the application manifest proxy used by a real Listener.
That route authenticates a unique session, reads membership/device-lease state
from PostgreSQL, signs and fetches the origin playlist, then validates/proxies
it. This harness shares one rotating direct media-playlist URL and one generator
HTTP pool, so it cannot establish app, database, lease, TLS/socket-per-browser
or end-to-end Listener capacity. Before setting a customer limit, run a separate
approved staging stage with unique synthetic accounts, sessions, leases and
cookies; it must retain the no-event-capability boundary.

The harness models one media-plane client as deterministic UTC manifest polls followed by
the newly visible media-sequence segment requests. Client activation is derived
from the global client ordinal and shared UTC start. Shard `i` owns global
ordinals `i, i + shardCount, ...`, so a distributed run has the same ramp and
request plan regardless of where its shards execute.

The tool reads only HLS control data: media sequence, `EXTINF`, URI, optional
initialization map/byte range and declared gap. Segment bodies are opaque bytes.
Master playlists, encrypted media and LL-HLS parts fail closed so they cannot be
silently undercounted. There is no codec, bitrate, rate,
channel, gain, decoder or audio-content assumption. The result cannot replace
the decoded canary or physical-device listening gate.

## Prerequisites

1. Use a staging deployment whose exact SHA and non-production status are
   recorded. Configure the attestation response header only on that staging
   vhost; production must never emit the staging value. Do not point a policy
   at the live Listener or a production alias.
2. Provision independent external generator VPSs. On each, verify `hostname`
   is not `mona`/`mona-*`/`mona.*`, confirm chrony/NTP is synchronized, record
   the measured UTC offset in milliseconds, and set:

   ```bash
   export EARLY_BIRDS_GENERATOR_ROLE=external-load-generator
   ```

3. Create `/secure/early-birds-hls-targets.json` from the example. It contains
   no secret, but must list every exact origin that can appear in the media
   playlist (staging origin and staging CDN, if any). Set target limits to the
   specific approved rehearsal, not automatically to global hard limits.
4. Put the current short-lived signed media-playlist URL in a local `0600` file
   on each generator. Never pass it on the command line. An approved lightweight
   control-plane process may replace this file atomically before expiry; the
   harness observes an atomic replacement within one second. The signing key remains on the
   staging control plane. Mona may mint a URL but must not run a load shard.
5. Confirm target monitoring: network egress/retransmits/errors, origin CPU and
   memory, manifest/segment latency and status, and external canary continuity.
   Assign one operator who can stop every generator and one who watches the
   target.

## Safety gates

The implementation refuses a network run unless all of these hold:

- target policy schema is valid, `production` is exactly `false`, and
  environment is `staging` or loopback-only `synthetic`;
- staging origins are exact HTTPS origins with no credentials, path, query,
  fragment or wildcard, and every response carries the exact staging-only
  environment attestation header/value from the policy;
- the manifest and every segment remain inside those origins; redirects are
  not followed;
- profile is below both global hard bounds and the narrower target policy for
  clients, ramp, soak, poll cadence, concurrency, segments/poll, request
  starts/second and response body bytes; a per-shard limiter enforces the RPS
  ceiling during the run;
- whole-run error/miss tolerances are at most 10%, rolling-window thresholds at
  most 20% and circuit-breaker thresholds at most 25%; evidence aggregation
  recomputes these gates from the hashed plan rather than trusting stored
  thresholds;
- large plans meet minimum shard counts and no shard owns more than 1,000
  clients;
- start is explicit UTC, at least ten seconds and at most six hours ahead;
- the operator supplies the exact confirmation printed by dry-run; it ends in
  a `planHash` covering every selected profile field, origin, attestation and
  effective target limit;
- the generator declares the external role, passes `--external-generator` and
  is not named `mona`;
- the manifest URL file is a regular file inaccessible to group/world;
- the measured UTC clock offset is within the policy bound;
- the evidence path does not exist.

## Stepwise execution

Never jump directly to the 3,000/4,000/5,000 planning thresholds. Run the
smallest approved step, evaluate target health, then make a separate go/no-go
decision for the next step. The committed profiles are bounded origin-media definitions,
not authorization to execute them.

1. Choose a unique safe run ID and one UTC start shared by every shard. Allow at
   least 60 seconds to distribute commands for multi-host runs.
2. Run every shard with `--dry-run`. All evidence files must have the same
   `planHash`; shard indices must be exactly `0..shardCount-1`.
3. Compare the printed confirmation phrases. They must be byte-identical.
4. Ensure the signed manifest file is current on every external generator.
5. After explicit go, run one command per shard. Example shard 2 of 4:

   ```bash
   EARLY_BIRDS_GENERATOR_ROLE=external-load-generator \
   node tools/early-birds-hls-load/run.mjs \
     --policy /secure/early-birds-hls-targets.json \
     --target early-birds-staging \
     --profile origin-media-3000 \
     --run-id eb-staging-capacity-001 \
     --start-at 2026-08-07T16:00:00.000Z \
     --shard-index 2 \
     --shard-count 4 \
     --manifest-url-file /secure/early-birds-current-manifest-url \
     --clock-offset-ms 4.2 \
     --confirm 'EXACT PHRASE FROM DRY-RUN' \
     --external-generator \
     --evidence artifacts/early-birds-hls-load/shard-2.json
   ```

6. Stop all shards with `SIGINT` if any stop condition fires. Each running shard
   writes `ABORTED` evidence when it exits normally from that signal.
7. Copy the redacted shard files to one analysis host and aggregate them:

   ```bash
   node tools/early-birds-hls-load/aggregate.mjs \
     --output artifacts/early-birds-hls-load/aggregate.json \
     artifacts/early-birds-hls-load/shard-0.json \
     artifacts/early-birds-hls-load/shard-1.json \
     artifacts/early-birds-hls-load/shard-2.json \
     artifacts/early-birds-hls-load/shard-3.json
   ```

Aggregation refuses missing/duplicate shards, different run IDs/plan/input
hashes, different actual targets/thresholds, invalid measurement arithmetic or
non-external staging evidence. It records SHA-256 for every source evidence file.

## Immediate stop conditions

Stop the run; do not increase capacity when any of these occurs:

- target health/readiness or external decoded canary fails;
- HTTP 5xx/errors or rebuffer-equivalent fetch misses exceed the approved
  profile threshold;
- target CPU, memory, network, retransmit or interface-error alerts fire;
- the generator records scheduling misses (it is no longer producing the
  intended load shape);
- a manifest sequence regresses, the playlist window outruns clients or a URL
  escapes the allowlist;
- signed URL rotation fails;
- weekend event safety is in doubt.

Use the lower measured safe limit. An advertised 1/3 Gbit/s NIC rate is not
capacity evidence, and a healthy origin with saturated direct egress is a CDN
expansion signal rather than permission to continue increasing direct load.

## Evidence semantics

Each mode-`0600` shard manifest records:

- hashes of the complete profile/policy, deterministic global plan and local
  client ordinal set;
- target ID/environment/origin and a hash of the manifest path;
- a hash of the generator hostname, never the hostname itself;
- planned/started/completed clients and generator schedule misses;
- manifest/segment/total request counts, HTTP status, bounded error categories,
  decoded response-body bytes (not packet/wire bytes), queue-inclusive fixed-bucket
  p50/p95/p99 latency estimates and queue-delay histograms;
- manifest samples, sequence regressions and playlist-window misses;
- rebuffer-equivalent fetch opportunities/misses and bounded categories;
- ten-second worst eligible error/miss windows, circuit-breaker termination and
  the measured generator clock offset.

“Rebuffer-equivalent fetch miss” is an HTTP/control-plane proxy, not a browser
rebuffer event. It includes unavailable/unparseable manifests, segment HTTP or
timeout/empty/allowlist failures, segment delivery slower than its own
`EXTINF`, playlist-window loss, sequence regression and deliberate backlog
discard caused by the per-poll safety bound. Final release evidence still needs
the browser player, decoded canary and physical listening.

The harness trips early after a minimum sample count when request errors or
fetch misses exceed conservative circuit thresholds. Final `PASS` also gates
whole-run and worst-window error/miss rates plus manifest/segment p95. External
target alerts remain authoritative stop signals; local circuit breaking does
not replace them.

Evidence never contains raw URLs, query strings, signed material, cookies,
headers, playlist/segment bodies or raw exception messages. Inspect the target
metrics/logs through their own redaction policy; do not paste signed URLs into
issues or chat.
