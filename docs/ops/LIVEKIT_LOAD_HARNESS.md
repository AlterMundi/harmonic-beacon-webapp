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
Run the full ES and EN profiles twice and attach all four manifests to #24.

## Tooling

Install the official `lk` CLI (the CI workflow pins v2.16.3). LiveKit recommends
running large tests from a well-provisioned host and raising file-descriptor and
network limits; do that on the load-generator host before a 150-person run. See
the official [LiveKit benchmarking guide](https://docs.livekit.io/transport/self-hosting/benchmark)
and [LiveKit CLI repository](https://github.com/livekit/livekit-cli).
