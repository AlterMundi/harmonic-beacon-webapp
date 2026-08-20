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
progress (five seconds after a fatal network signal and an actually exhausted
forward buffer) produces one bounded diagnostic and enters automatic recovery.
Recovery retries immediately and then with exponential backoff capped at thirty
seconds; it does not give up while the listener still requests playback.

A fatal hls.js network signal no longer enters that destructive path while the
media clock can advance. The player keeps the exact MediaSource, audio element,
fade, presence and lease, and resets only the loader with `stopLoad()` /
`startLoad()` on the same hls.js instance. It continues from already-buffered
bytes. A successful manifest or fragment load cancels the refill timer. Only
genuine buffer exhaustion, decoder failure or a non-network fatal error reaches
the same-lease rebuild below:

1. marks presence idle;
2. verifies the existing lease and generation;
3. destroys the one stalled hls.js instance;
4. reattaches the verified manifest, even when the URL is unchanged;
5. seeks to the current live position, calls `play()`, then marks presence
   listening again.

Each automatic media `play()` attempt is bounded to eight seconds. A browser
that leaves the promise pending after MediaSource exhaustion therefore cannot
deadlock reconnection; the same-lease backoff loop remains authoritative.

It does not mint a second lease for an active generation, construct a second
audio graph or modify codec, buffer, gain, fades, routing or assets. Stop,
displacement and denied access remain terminal.

## Stability-first delivery policy

Listener is not a low-latency product. The canonical origin retains fifty
six-second entries (approximately five minutes) and a fresh browser starts
approximately thirty entries (three minutes) behind the live edge. hls.js
targets and caps three minutes of forward media. A bounded, memory-only segment
reservoir retains the same newest three-minute window before playback needs it;
this is required because WebKit's MediaSource kept only about 23 seconds in the
real-browser gate even with the 180-second hls.js configuration. Cached
fragments are served back to that exact hls.js instance during an outage, while
the last valid playlist remains available until origin recovery. The reservoir
accepts only HTTPS segment URLs from the manifest's exact origin, omits browser
credentials and referrers, caps retained bytes at 16 MiB, and is destroyed with
the player. Prefetch starts only after the listener asks to play, not merely by
visiting the page. It is never persistent storage and never logs signed URLs.

Native HLS seeks to the same three-minute target rather than sitting directly
on the edge. A full three-minute forward reservoir is about 7.2 MB at 320
kbit/s, but playback does not wait for the whole buffer to fill. The trade is
approximately three minutes of program delay, not three minutes of startup
silence.

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

The browser emits `listener:playback-diagnostic` for reservoir readiness, a
fatal HLS signal, refill recovery and media-clock recovery. The fixed payload
records retained/playable seconds, recovery action, retry count, media state,
range summaries, lease generation/sequence, bounded HLS error enums and
visibility. It never contains account/email, lease ID, IP, cookie/token/header,
user agent, signed URL or output-device fingerprint.

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

For deterministic recovery evidence in staging, acquire a media grant and then
interrupt only the Listener control plane while the independent origin remains
healthy. Manifest and segment requests using the already-issued URL must keep
returning 200 without any Listener/database callback until the exact registered
lease expiry; the next request must return 403. Restore Listener before expiry
for a physical playback drill. The stable URL must survive heartbeat renewal,
with one audible source and one quota presence interval. Do not restart the
origin to simulate a control-plane failure.

This is bounded continuity, not unrestricted media access. Heartbeats renew
once per minute; each successful renewal grants at most three further minutes,
also capped by remaining quota. With the approximately three-minute playback
buffer, a failure immediately after renewal can preserve roughly six minutes
of user-perceived audio. Stop/revoke may likewise take at most the outstanding
grant horizon to drain at origin; quota settlement remains capped by the same
lease expiry.

## Reliability tiers still required

The five-minute origin window protects against ordinary last-mile jitter; it
does not make a single host highly available. Public-release reliability also
requires independently reviewable delivery work:

1. publish the identical encoded timeline from at least two failure domains
   and provide tested client/playlist failover without overlapping audio;
2. run synthetic audio canaries from North America, Europe and Latin America,
   and retain low-cardinality, non-PII browser recovery causes;
3. define and gate on interruption-free session rate, rebuffer ratio, join
   success and recovery time, including multi-hour network and origin-failure
   drills.

Until those tiers exist, do not describe the service as highly available solely
because the origin and local canary are healthy.
