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

## Decision

- Do not close #99 or use this run as GO evidence for #24.
- Keep the 0.1% loss threshold; do not normalize the failure away.
- Repeat the explicit VP8 profile on a separately provisioned generator or
  mona-safe production-like target before classifying server versus generator.
- Run the explicit H264 path as supporting Safari evidence, never as a
  substitute for VP8.
- Physical browser, TURN, mobile routing, six-camera, and listening gates remain
  in #24/#69/#93/#94.
