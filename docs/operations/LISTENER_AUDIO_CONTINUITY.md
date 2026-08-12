# Listener audio continuity

This runbook covers the Listener-only 24/7 Beacon stream. It does not apply to
event playback, LiveKit, playlist-bot or `live.harmonicbeacon.com`.

## 2026-08-09 incident

The reported silence began during a preview deployment. Host evidence shows
that manifest, heartbeat and access-state calls returned 502 for roughly 21
seconds while the Listener was recreated; the same operation also recreated
the isolated stream origin. The affected hls.js media clock then stopped
advancing without delivering a fatal/stalled event. Server-side visualization
polling continued with that frozen program time until the analysis endpoint
correctly rejected it as stale.

Analysis-frame traffic is not proof of audible playback. The decisive signal
is advancement of the active `HTMLMediaElement.currentTime` together with its
ready/network state and HLS lifecycle.

## Runtime recovery

While Beacon playback is requested, visible and not inside an introduction,
the client samples the media clock every five seconds. Fifteen seconds without
progress produces one bounded diagnostic and enters the existing three-attempt
recovery path. Recovery:

1. marks presence idle;
2. verifies the existing lease and generation;
3. destroys the one stalled hls.js instance;
4. reattaches the verified manifest, even when the URL is unchanged;
5. seeks to the current live position, calls `play()`, then marks presence
   listening again.

It does not mint a second lease for an active generation, construct a second
audio graph or modify codec, buffer, gain, fades, routing or assets. Stop,
displacement and denied access remain terminal.

The browser emits `listener:playback-diagnostic` and a matching console warning
only when recovery begins. The payload is fixed and contains transport/action,
media state, range counts/endpoints, lease generation/sequence, bounded HLS
error enums and visibility. It never contains account/email, lease ID, IP,
cookie/token/header, user agent, signed URL or output-device fingerprint.

## Deployment invariant

`scripts/early-birds-preview/start.sh` migrates/recreates only Listener.
`rollback.sh` stops only Listener. Neither ordinary command may target the
long-lived origin. Origin maintenance uses the explicit `start-origin.sh` or
`ops/early-birds/scripts/stop-stream.sh` lane, with an announced window and a
decoded-audio canary. None of these commands targets the event project.

## Acceptance

For a release candidate, verify Beacon-only and intro handoff on Chrome,
Firefox, Android Chrome and iPhone Safari. Include foreground, one
background/foreground cycle and speakers/headphones when available. Perform a
60-minute physical listen on at least one representative mobile device.

For deterministic recovery evidence in staging, interrupt only the Listener
control plane for less than 30 seconds while the independent origin remains
healthy. The same client must reconnect at the live position with one audible
source and one quota presence interval. Do not perform this exercise while an
event is active and do not restart the origin to simulate it.
