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

## Stability-first delivery policy

Listener is not a low-latency product. The canonical origin retains fifty
six-second entries (approximately five minutes) and a fresh browser starts
approximately twenty entries (two minutes) behind the live edge. hls.js may
hold up to three minutes of forward media; native HLS seeks to the same
two-minute target rather than sitting directly on the edge. This costs about
4.8 MB of initial media at 320 kbit/s and intentionally trades latency for
continuity.

The playlist window and client target are one contract. A client target larger
than the retained playlist is fictional buffering and must not ship. Any future
change must verify both sides, decoded audio, quota accounting and the physical
device matrix.

Native `stalled` and `suspend` events are advisory: browsers may emit them while
they still have healthy buffered media. They do not by themselves show
**Reconnecting** or rebuild the media pipeline. A native media error remains an
immediate recovery signal; otherwise the fifteen-second media-clock watchdog
is the authority.

When the document becomes hidden during playback, Listener explicitly pauses
the introduction and Beacon, reports quota presence idle and releases the
hls.js pipeline. When visible again it verifies the same lease, rejoins at the
configured live position and reports listening only after playback succeeds.
Background time is therefore neither audible nor charged. This is a product
policy, not a browser best-effort optimization.

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
healthy. The same client must reconnect at the configured buffered live
position with one audible source and one quota presence interval. Do not
perform this exercise while an event is active and do not restart the origin
to simulate it.

## Reliability tiers still required

The five-minute origin window protects against ordinary last-mile jitter; it
does not make a single host highly available. Public-release reliability also
requires independently reviewable delivery work:

1. cache immutable media segments at a CDN/edge and keep manifests private and
   short-lived;
2. remove the Listener application/database from the segment hot path after a
   bounded authorization decision, so control-plane latency cannot interrupt
   already-authorized audio;
3. publish the identical encoded timeline from at least two failure domains
   and provide tested client/playlist failover without overlapping audio;
4. run synthetic audio canaries from North America, Europe and Latin America,
   and retain low-cardinality, non-PII browser recovery causes;
5. define and gate on interruption-free session rate, rebuffer ratio, join
   success and recovery time, including multi-hour network and origin-failure
   drills.

Until those tiers exist, do not describe the service as highly available solely
because the origin and local canary are healthy.
