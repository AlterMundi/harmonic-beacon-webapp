# Deterministic HLS delivery with an explicit audio guardrail

*Accepted 2026-08-06 for the EarlyBirds milestone.*

## Decision

The 24/7 Listener source is delivered as deterministic HTTP HLS: an approved,
immutable artifact has a fixed UTC epoch and immutable six-second segments; a
small origin derives the current media sequence from wall-clock time. Restarting
the origin does not restart or duplicate the Beacon timeline.

Safari uses native HLS and other supported browsers use `hls.js`. Membership
authorizes an opaque, three-minute media grant registered on the origin over a
private network. The browser receives one stable direct-origin URL; heartbeats
extend the same grant without replacing `audio.src`. Manifest and segment
fetches therefore do not depend on the Listener process, auth service or
database. The origin stores only a token hash and expiry, compares credentials
in constant time and fails closed at the lease horizon. Bearer query strings
are never logged. Public health is minimal; metrics bind privately.

The current immutable loop is a temporary source adapter for development. The
delivery and grant boundary is source-agnostic: a future continuously played
Beacon is packaged into the same advancing HLS timeline without changing
browser authorization or the audio controls.

## Audio boundary

The source master is
`/home/nicolas/Music/beacon/luz_de_manana_20260624-155633.wav`. This decision does
not select a codec, bitrate, sample rate, channel layout, loudness treatment or
delivery artifact. Those choices require reproducible provenance, the complete
file-to-player test ladder and Nico's explicit listening approval.

Drop-ins use the exact Amara Sol ES/EN voice masters and an offline candidate
render with a chosen Beacon excerpt ducked by 9 dB. They retain private standard
playback controls and never join the shared Beacon timeline. Their content and
audio artifacts also require Nico's approval.

## Event boundary and rollback

The milestone does not edit event `AudioContext`, LiveKit, playlist-bot or
crossfader paths. Stop the independent origin and disable EarlyBird routes to
roll back. Reusing this stream in events is a separate post-milestone decision.
