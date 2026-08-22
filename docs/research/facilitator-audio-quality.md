# Facilitator audio quality contract

Issue: [#459](https://github.com/AlterMundi/harmonic-beacon-webapp/issues/459)  
Milestone: Encuentro — sábado 29 de agosto de 2026

## Product contract

- The assigned facilitator uses a deliberate high-fidelity voice profile when opening the microphone.
- Every Staff role sees current measurements and a prominent warning when the observed path leaves reasonable operating ranges.
- A warning is informational. It must never mute, unpublish, disconnect, reload, change a mixer, or stop a room.
- Uplink and downlink are shown separately. The facilitator browser measures capture/uplink; every other Staff browser measures its own reception of that facilitator.
- Telemetry contains no names, emails, participant identities, device IDs, IP addresses, tokens, or persistent history.

## Selected profile

| Setting | Value | Reason |
| --- | --- | --- |
| Codec | Opus | WebRTC interoperable full-band codec |
| Maximum bitrate | 96 kbps | LiveKit high-quality mono preset; a ceiling, not a guaranteed minimum |
| Network priority | high | Protect audio before ordinary video traffic |
| Capture | 48 kHz, mono preferred | Full-band voice without paying stereo cost |
| RED | on | Redundant Opus payload can recover isolated packet loss |
| DTX | off | Avoid discontinuous voice gating |
| AGC / echo cancellation / noise suppression / voice isolation | requested off | Preserve the good external microphone signal; actual browser settings are reported |

The profile applies only to the event's assigned facilitator. Applying the same no-AEC profile to arbitrary attendees using open speakers would create an avoidable feedback risk.

## What the browser can and cannot promise

`RTCRtpEncodingParameters.maxBitrate` is a maximum. Congestion control is still allowed to transmit below it; there is no interoperable WebRTC minimum-bitrate control. Opus is also allowed to vary its instantaneous rate, so the system must measure the effective stream rather than claim literal CBR. Browser media constraints express the requested capture, and `MediaStreamTrack.getSettings()` is the evidence of what the browser actually delivered.

The monitor therefore reads cumulative `RTCStatsReport` counters and computes deltas over two-second windows:

- outbound/inbound audio bitrate;
- remote packet loss;
- jitter and round-trip time;
- receiver concealed-sample percentage;
- available candidate-pair bandwidth when implemented;
- actual codec and sanitized capture settings;
- LiveKit connection-quality state.

Low bitrate is warned only while WebRTC reports active audio. Opus legitimately reduces its rate during silence even with DTX disabled.

## Initial operating ranges

These values are operational warnings, not media controls. They must be tuned with recorded rehearsal evidence.

| Measurement | Warning | Critical |
| --- | ---: | ---: |
| Packet loss | ≥ 2% | ≥ 5% |
| Jitter | ≥ 25 ms | ≥ 50 ms |
| RTT | ≥ 200 ms | ≥ 400 ms |
| Concealed samples | ≥ 1% | ≥ 5% |
| Active-speech bitrate | < 48 kbps | < 32 kbps |
| Telemetry age | — | > 7 s |

An enabled browser voice processor or an actual sample rate below 44.1 kHz produces a warning. Unsupported metrics render as unavailable, never as zero.

## Primary references

- [LiveKit high-quality audio](https://docs.livekit.io/transport/media/advanced/)
- [LiveKit connection quality](https://docs.livekit.io/home/client/events/#connection-quality)
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [W3C MediaStreamTrack content hints](https://www.w3.org/TR/mst-content-hint/)
- [W3C WebRTC `maxBitrate`](https://www.w3.org/TR/webrtc/#dom-rtcrtpencodingparameters-maxbitrate)
- [W3C WebRTC Statistics](https://www.w3.org/TR/webrtc-stats/)
- [RFC 6716 — Opus](https://www.rfc-editor.org/rfc/rfc6716)
- [RFC 7587 — RTP payload format for Opus](https://www.rfc-editor.org/rfc/rfc7587)
- [RFC 8854 — RTP payload format for RED](https://www.rfc-editor.org/rfc/rfc8854)

## Acceptance evidence

Automated gates cover profile scoping, counter-delta math, bounded telemetry, warnings, and the invariant that degraded metrics do not touch media controls. The real-LiveKit browser continuity suite additionally requires the facilitator monitor to leave its waiting state after microphone publication while preserving the existing no-disconnect/no-remount/no-duplicate-media contract.

A physical rehearsal with Julián's production microphone remains required to choose microphone gain and validate perceived quality. That rehearsal tunes thresholds; it does not replace or weaken the automated transport evidence.
