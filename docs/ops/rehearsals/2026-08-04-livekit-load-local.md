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

## Six-generator production-like diagnostic

Run `capacity-en-20260805d` completed all four phases against an isolated
LiveKit `v1.13.4` target on mona from six distinct GitHub-hosted generators and
exact `main@505cc9506bd734d89914635d71c028b6009bbb37`. Actions run:
`31032518240`.

Every phase reached the exact global topology: 156 Stage connections with six
publishers and 151 Beacon connections with one publisher. Each shard received
150 Stage subscriber tracks and 25 Beacon subscriber tracks, every API poll
succeeded, phase synchronization was 0--1 ms, and all containers remained at
restart delta zero with no OOM. The source manifest hashes are:

- shard 0: `ed535bec5a1d416f8e17a4da46d12a1c033a5a9b6dd01ec51193fa8f62a72994`;
- shard 1: `de4c737dba64c10743456d2e73b49b0e9d4a41a5a8b3c7cc3923006350d7deb4`;
- shard 2: `8084edd4532d61319af4e28c79015bd2d2a1c115c47601bf423ba5478a084d99`;
- shard 3: `93f8c283b95220012a97832fcc5fc2593e217473b69ec82dd9ddf50fb199ffb9`;
- shard 4: `3fe8f31e54e87ec00ab77d12af49ada8cfffc0532cc05f39de3ebe7d13b68af2`;
- shard 5: `2ba8d47e62a193dc1cfe952cb3cae7224cdb6f408f0a73991d1b874ba1cbfeb3`.

The result remained a real packet-loss failure:

| Shard | Stage ramp | Stage soak | Stage reconnect 1 | Stage reconnect 2 | Beacon max |
|---:|---:|---:|---:|---:|---:|
| 0 | 15.841% | 34.396% | 26.931% | 16.921% | 6.435% |
| 1 | 16.542% | 34.837% | 27.900% | 19.221% | 6.294% |
| 2 | 15.724% | 33.840% | 29.198% | 18.310% | 6.333% |
| 3 | 15.735% | 33.832% | 26.903% | 16.997% | 6.257% |
| 4 | 8.742% | 21.370% | 15.757% | 8.523% | 4.006% |
| 5 | 8.706% | 22.138% | 15.213% | 8.850% | 4.003% |

Splitting subscriber fan-in over six machines did not remove the failure, so
the earlier two-host result must not be classified as generator contention
alone. Target telemetry also rules out simple host or NIC saturation: 1,936
samples completed normally, public readiness failures were zero, host CPU
peaked at 60.67%, available memory stayed above 15,340,625,920 bytes, and soak
traffic averaged 310.19 Mbps outbound with a 355.72 Mbps maximum interval. The
telemetry SHA-256 is
`311e9c73cfdce640ac35fd34f0c4fc3b24b282226bfdd2ffba25cb31c482465f`.

The run also exposed a harness defect independent of packet loss. Shards 0--3
had a faster local ramp and disconnected before shards 4--5; their ten-second
cleanup polls therefore ended with 52 Stage and 50 Beacon participants still
present. The two slowest shards subsequently observed exact zero. The harness
now pads each local command to one shared completion barrier and validates that
contract before aggregation.

The pinned CLI `v2.16.3` computes `Pkt. Loss` from the Pion sample builder's
dropped-packet callback with a 100-packet late window. It is a receiver-visible
RTP sequence-gap metric, not an acoustic or browser decode test, and it cannot
by itself distinguish network loss from an SFU forwarding defect. During the
failure, LiveKit `v1.13.4` logged packet-bucket overflow/eviction warnings. The
subsequent upstream `v1.13.5` release includes a
[forwarded-padding fix](https://github.com/livekit/livekit/commit/366cadcd96b8b09c7212e27693a25f3a88e6c8be)
that its maintainer explicitly describes as affecting special clients and
bandwidth estimation.

### Isolated `v1.13.4` versus `v1.13.5` control

Three non-debug 60-second controls then used the same mona host, pinned CLI
`v2.16.3`, six VP8 simulcast publishers, 150 subscribers, speaker layout,
synthetic rooms and loopback-only ports. All three received 900/900 tracks with
zero CLI errors:

| Server | Run | Loss | Packet-bucket lookup warnings | Extended-packet overflow warnings |
|---|---|---:|---:|---:|
| `v1.13.4` | control | 5.051% | 429 | 88 |
| `v1.13.5` | control A | 0.274% | 24 | 6 |
| `v1.13.5` | control B | 11.261% | 767 | 154 |

The first `v1.13.5` run improved sharply but remained above the 0.1% gate; the
immediate identical repetition regressed beyond `v1.13.4`. The padding fix is
therefore relevant but not sufficient or deterministic evidence for a server
upgrade. Loss continues to correlate with the SFU packet-bucket warnings.
Production must not be upgraded on this result, and the threshold remains
unchanged. The next comparison must keep target and generators on separate
hosts, capture target resource/packet telemetry, and repeat `v1.13.5` before a
release decision.

Artifact SHA-256:

- `v1.13.4` CLI: `97b090b50afcdc473890a93e0ce2d031c96dc929ae7c70ed46f7824f5371167f`;
- `v1.13.4` server: `230bbc940781f79dd539893dcde796369292322580688fa82077e5551a2555e2`;
- `v1.13.5` control A CLI: `a427685500fbb8e2ab403dfc43cc1005464e847c2a9e8e6a4458a645a835f49a`;
- `v1.13.5` control A server: `75d9e3fef0fcd80b7e55957e9f36d0323ecf055b990135e2e614dc9c7f172b99`;
- `v1.13.5` control B CLI: `52ac72bd4ad2b64f6c51f05d84d36b18110f796120f01e6c93cedaad0c33c047`;
- `v1.13.5` control B server: `dd0d733f06dff685c5b96de371f0ab4dc309a0458ee0dd2b137fe493634e5b46`.

## Decision

- Do not close #99 or use this run as GO evidence for #24.
- Keep the 0.1% loss threshold; do not normalize the failure away.
- Repeat the explicit VP8 topology from separate generators against isolated
  LiveKit `v1.13.5`; neither local result authorizes a production upgrade.
- Run the explicit H264 path as supporting Safari evidence, never as a
  substitute for VP8.
- Physical browser, TURN, mobile routing, six-camera, and listening gates remain
  in #24/#69/#93/#94.
