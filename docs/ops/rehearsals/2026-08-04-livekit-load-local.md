# Local dual-LiveKit capacity rehearsal — 2026-08-04

Status: **FAIL — VP8 Stage loss exceeds the acceptance threshold**

This is production-like local evidence for #99 and #24. It is not production,
does not contain attendee data, and does not certify external network paths,
TURN, physical browsers, perceived audio, or mona capacity.

## Environment

- Beacon Git SHA: `0c1f496023603de9ddb7457c135d372faac7ad12`
- Dirty worktree: false
- LiveKit server: `1.13.4`
- LiveKit CLI: `2.16.3`
- Generator: 12 logical CPUs, 62 GiB RAM, file descriptor limit 524288
- Rooms: synthetic `hb-load-*` Stage and Beacon rooms only
- Manifest: mode 0600, SHA-256
  `8cf91b3660117d69db96f2409fc733dba6d6f8a5afe361ae65ed672d181ec058`

The raw manifest remains a local redacted artifact. It contains no tokens,
identities, email, audio, video, or participant content.

## Full ES result

This run used the legacy implicit mixed-codec profile. The focused controls
below isolate the failed loss to the six-publisher VP8 case; the follow-up
profile change makes that conservative VP8 choice explicit.

| Phase | Stage tracks | Stage loss | Beacon tracks | Beacon loss | Connections | Publishers | Cleanup |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ramp | 900/900 | 5.735% | 150/150 | 0% | 156 + 151 | 6 + 1 | 0 in 2 ms |
| Soak 20 min | 900/900 | 11.057% | 150/150 | 0% | 156 + 151 | 6 + 1 | 0 in 3 ms |
| Reconnect 1 | 900/900 | 8.618% | 150/150 | 0% | 156 + 151 | 6 + 1 | 0 in 2 ms |
| Reconnect 2 | 900/900 | 8.182% | 150/150 | 0% | 156 + 151 | 6 + 1 | 0 in 2 ms |

All phases observed the exact requested connections and publishers, all CLI
processes exited zero, all expected tracks arrived, the room API had zero
errors, and every phase cleaned up completely. The sole failed invariant was
Stage packet loss above `maxDroppedPercent=0.1`.

LiveKit used about 2.17 GiB and 2.5 CPU during the soak. Whole-host busy CPU was
about 52%. Memory did not grow continuously. Server logs contained no warning
or error for the run. Kernel UDP buffer-error counters did not increase during
the focused follow-up, so the loss cannot be attributed to a demonstrated host
socket-buffer overflow.

## Codec controls

Focused 60-second tests used the same LiveKit server and synthetic rooms:

| Stage topology | Codec | Result |
|---|---|---:|
| 6 publishers × 150 subscribers | implicit mixed VP8/H264 | 2.842% loss |
| 6 publishers × 150 subscribers | VP8 | 9.438% loss |
| 6 publishers × 150 subscribers | H264 | 0.085% loss — under threshold |
| 1 publisher × 150 subscribers | VP8 | 0% loss |
| 1 publisher × 1 subscriber | VP8 | 0% loss |

The failure therefore emerges in the six-publisher VP8 topology. A passing
H264 result must not mask it because Chrome/Firefox-class participants can use
VP8. The original profile was ambiguous because omitting `--video-codec` made
the official CLI mix codecs. Profiles now declare codec and layout explicitly.

## Explicit VP8 full-profile reproductions

### English profile

After PR #143, the complete `rehearsal-en` profile ran from clean harness SHA
`4de2d5da2da34c81af536a8e2b035b6464e34baf` with `vp8` and `speaker`
present in every recorded Stage command. The local manifest is mode 0600 with
SHA-256 `6c54b064dd528cdd65d9a5fd738dad8feac2beddd2d233aa59713d33b3c9b12f`.

| Phase | Stage tracks | Stage loss | Stage join p95 | Beacon tracks | Beacon loss | Beacon join p95 | Cleanup |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ramp | 900/900 | 10.387% | 14.875 s | 150/150 | 0% | 14.333 s | 0 in 2 ms |
| Soak 20 min | 900/900 | 11.366% | 14.790 s | 150/150 | 0% | 14.529 s | 0 in 1 ms |
| Reconnect 1 | 900/900 | 12.132% | 15.023 s | 150/150 | 0% | 14.489 s | 0 in 2 ms |
| Reconnect 2 | 900/900 | 12.341% | 14.771 s | 150/150 | 0% | 14.506 s | 0 in 5 ms |

Every phase again reached exactly 156 Stage and 151 Beacon connections, with
six and one publishers respectively. All CLI processes exited zero, all
expected tracks arrived, the room API recorded no error, and cleanup converged
to zero. The harness correctly returned `FAIL` solely because Stage exceeded
the 0.1% loss threshold; Beacon remained lossless in all four phases.

### Spanish profile

The complete `rehearsal-es` profile then ran sequentially from the same clean
harness SHA and generator host. Its mode-0600 local manifest has SHA-256
`914275a3d8b099612b82a0d80039891d7185105543ba1bea778fb37b0cb77498`.

| Phase | Stage tracks | Stage loss | Stage join p95 | Beacon tracks | Beacon loss | Beacon join p95 | Cleanup |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ramp | 900/900 | 11.758% | 14.980 s | 150/150 | 0% | 14.443 s | 0 in 2 ms |
| Soak 20 min | 900/900 | 14.928% | 14.798 s | 150/150 | 0% | 14.536 s | 0 in 2 ms |
| Reconnect 1 | 900/900 | 11.994% | 15.009 s | 150/150 | 0% | 14.474 s | 0 in 2 ms |
| Reconnect 2 | 900/900 | 15.249% | 15.012 s | 150/150 | 0% | 14.469 s | 0 in 3 ms |

The second run also reached every requested connection, publisher and track,
with zero API or CLI errors and complete room cleanup. The join percentiles in
both tables are observations from phase start and include the configured
10-clients-per-second ramp; they are not application login or media-latency
measurements.

These two manifests are directly comparable: same harness SHA, generator-host
hash, LiveKit server/CLI, topology, codec, layout, durations and threshold; the
only profile difference is the synthetic event language and room name. Stage
loss reproduced in all eight phases (10.387–15.249%), while Beacon audio was 0%
in all eight. This establishes repeatability on the local same-host topology,
but does not distinguish SFU capacity from generator contention or certify
mona/external network capacity.

## Decision

- Do not close #99 or use this run as GO evidence for #24.
- Keep the 0.1% loss threshold; do not normalize the failure away.
- Repeat the explicit VP8 profile on a separately provisioned generator or
  mona-safe production-like target before classifying server versus generator.
- Run the explicit H264 path as supporting Safari evidence, never as a
  substitute for VP8.
- Physical browser, TURN, mobile routing, six-camera, and listening gates remain
  in #24/#69/#93/#94.
