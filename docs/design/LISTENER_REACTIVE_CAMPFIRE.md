# Listener reactive field

Listener renders a visualization of the source that is actually audible.
Playback stays on the browser's native HLS and HTML media path. The accepted
field is enabled on `listen.harmonicbeacon.com`; its technical tuning laboratory
is hidden by default.

## Signal contract

- The Beacon fundamental is exactly **40.4 Hz**.
- Harmonic identity is stable through the measurable bank up to 20 kHz.
- Absolute dB determines visual existence and weight. Deviation from a slow
  baseline determines motion and trail only; it never promotes a quiet upper
  harmonic above a stronger low harmonic.
- `HarmonicAnalysisFrame` is renderer-neutral. Canvas does not know whether a
  frame originated beside a file-backed or future live stream.
- The current server analyzer uses stereo 48 kHz PCM, FFT 16384 and a declared
  `-120..0 dB` range. The ordered remote-frame provider keeps the 24-second slow
  baseline across segment boundaries. Normal cadence is four frames per second;
  Reduced-motion, Save-Data and Minimal pulse request two.

## Server-side analysis boundary

The browser never creates an `AudioContext`, `MediaElementAudioSourceNode` or
second media element for visualization. It never changes `crossOrigin`, volume,
fades, buffer policy, source attachment or routing. Enabling or disabling the
field does not remount the player.

For the current file-backed Beacon, the server decodes the exact AAC/fMP4 HLS
fragment that the origin delivers, computes bounded harmonic frames and caches
them by segment. It does **not** analyze the source WAV ahead of time. The client
sends the `PROGRAM-DATE-TIME` corresponding to its audible HLS position; native
HLS maps that position from its seekable live edge. The response contains only
bounded numeric analysis arrays and no account, cookie, media URL, IP or other
identity data.

The analysis endpoint exists only on the exact staging and canonical Listener
hosts, requires the same active lease authority as the HLS manifest, accepts
only the bounded audible latency window, is independently edge-rate-limited and
returns `no-store`. Decode concurrency is globally bounded and the cache retains
the complete accepted timestamp window. Failure is visual-only:
after four bounded failures the provider hides the field while native playback
continues. Intro playback clears the frame because a synchronized intro analysis
stream is not implemented yet; frames resume at the Beacon handoff.

The same transport boundary can later receive frames produced beside a live
encoder. The renderer and playback controller do not change. Polling is adequate
for this one-user workbench; public scale should replace it with a shared retained
transport such as SSE or WebSocket rather than decoding separately per process.

## Visual language

The point of view is fixed. Neither stereo balance nor aggregate energy moves
the center or camera. Each audible harmonic follows deterministic continuous
motion whose amplitude is bounded by measured energy and softly modulated by its
baseline variation. A band appears only after measured activation, glows in
proportion to activation, and fades over the configured TTL. TTL is visual
memory, not invented signal.

Outer ribbons use a lightweight pinned-cloth model. Their inner edge remains
anchored, a gentle wave keeps the field alive, and measured harmonic activity
increases displacement toward the free edge. The original Radial ribbons mode
can render bounded translucent whole-ribbon history, leaving a ghostly trace of
the movement.

The laboratory offers one low-cost and three full renderers over the same frame:

- **Minimal pulse** draws one fixed measured-level halo at two frames per second.
- **Harmonic radial series** places the complete selected harmonic bank in
  concentric bands; outer-spacing growth expands upper harmonic separation.
- **Radial ribbons** divides the complete bank between center and outer ribbons
  using a true 0–100% Center field control.
- **Horizon flow** pours broad harmonic ribbons from fixed horizon positions.

Changing renderer, cut, zoom, activation TTL, width, palette or other visual
controls never affects playback. FFT size and baseline are fixed server analysis
parameters in this build and remain visibly read-only in the laboratory.

## Staging and acceptance

The field is on by default. The checkbox and parameter panel are off by default
on every host. Operators can restore them only on the exact staging host with
`BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED=1`; the canonical public host never
exposes them. Presets export as versioned JSON. The accepted Radial ribbons Ember
default is: sensitivity 3, -70 dB floor, 24 s baseline, 20 ms attack, 220 ms
release, 4 s whole-ribbon trail, density 1, upper-detail bias 0.7, center field
7%, outer-spacing growth 65%, zoom 165%, activation TTL 30 seconds, ribbon width
2.45 and FFT 16384.

The retired client Web Audio diagnostic mode and the older regional fixture have
no runtime compatibility promise: this is an experimental product before public
release.

Nico accepted the field and confirmed that intro and Beacon audio remained
correct before public deployment. Continue the physical matrix on Chrome,
Firefox, Android and iPhone, including ES/EN introduction handoff, Beacon-only,
Stop, reconnect, headphones, Bluetooth and a 60-minute listen. Record server
decode latency/cache behavior, client network cadence, CPU, memory and frame
pacing.
