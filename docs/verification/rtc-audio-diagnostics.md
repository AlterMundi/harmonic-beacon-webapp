# RTC audio diagnostics — evidence protocol

**Issues:** #93, #94, #128
**Scope:** measurement only; no acoustic or media-lifecycle change

This protocol separates browser telemetry from human listening. Automated
evidence can show transport/capture symptoms, but it cannot certify speaker,
Bluetooth, OS routing, intelligibility or perceived continuity on a physical
device.

## Safe artifact

`e2e/helpers/media-probe.ts` collects a sanitized snapshot from every active
`RTCPeerConnection`. The media-continuity journey attaches
`rtc-audio-stats-attendee.json` after the facilitator audio has reached the
attendee.

The artifact may contain only:

- inbound packet count/loss, jitter, level and concealment counters;
- jitter-buffer delay and emitted count, plus their derived mean delay;
- outbound packet/level/energy counters exposed by the browser;
- remote-inbound loss, jitter and RTT;
- selected-pair RTT and available bitrate, without either candidate;
- audio codec MIME type, clock rate and channels;
- whitelisted `getSettings()` capture/receive capabilities: sample rate,
  sample size, channel count, latency and browser DSP booleans.

It deliberately excludes RTC report ids, SSRCs, participant and track
identities, device/group ids, candidate addresses, IPs, ports, signaling URLs,
room names and tokens. A browser test injects sensitive sentinel values into
all of those source fields and fails if any survive serialization.

## Reproduce locally

Use only the synthetic fixture stack documented in
[`e2e/README.md`](../../e2e/README.md). Then run:

```bash
npx playwright test e2e/tests/rtc-audio-stats.spec.ts --project=chromium
npx playwright test e2e/tests/media-continuity.spec.ts \
  --project=chromium \
  --grep='room controls never disconnect'
```

The first command proves the whitelist and failure isolation. The second uses
real local LiveKit transport and writes the sanitized JSON under the
Playwright test result/artifact directory.

## Physical matrix

Record browser/OS/device model and accessory class without participant name,
email, stable device id or raw audio. Use the same reference passage and the
same approximate speaker volume for every row.

| Platform | Mode | Output | Camera | Mic | Beacon | Fore/background | Result | Artifact |
|---|---|---|---|---|---|---|---|---|
| iPhone Safari | listen-only | speaker | off | off | on | foreground | pending | — |
| iPhone Safari | stage | speaker | on | on | on | foreground | pending | — |
| Android Chrome | listen-only | speaker | off | off | on | foreground | pending | — |
| Android Chrome | stage | speaker | on | on | on | foreground | pending | — |
| Desktop Chrome | listen-only | speaker/headphones | off | off | on | foreground | pending | — |
| Desktop Firefox | listen-only | speaker/headphones | off | off | on | foreground | pending | — |

For each available platform, repeat with wired/Bluetooth output, camera
off/on, mic off/on, background/foreground, camera switch and reconnect. Compare
the standard reference player with the WebRTC path at the same system volume.

## Reading the evidence

- Rising `packetsLost`, jitter or concealment points toward network/SFU or
  jitter-buffer behavior; compare deltas over a fixed interval rather than raw
  lifetime totals.
- Clean transport plus poor standard-player parity points toward capture,
  browser/OS routing, playback category or mix/gain—not packet transport.
- A capture setting is an observation, not a request made by Beacon. Browser
  settings may differ by platform and accessory.
- `audioLevel` and energy are implementation-dependent diagnostics, not a
  calibrated loudness measurement.
- Emulation never closes the physical-device rows. Missing stats are recorded
  as unsupported, not converted to zero.

No gain, crossfader, codec, bitrate, sample-rate request, channel request,
buffer, routing or `AudioContext` change may be inferred or shipped from this
artifact alone. Any such proposal requires a minimal audio-touching PR,
before/after listening evidence and Nico's explicit approval.
