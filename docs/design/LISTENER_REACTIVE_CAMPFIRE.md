# Listener reactive campfire

The Listener staging workbench can opt into a client-side visualization of the
source that is actually audible. Direct playback remains the default and the
experiment is not exposed by `listen.harmonicbeacon.com`.

## Signal contract

- The Beacon fundamental is exactly **40.4 Hz**.
- Harmonic identity is stable through the measurable bank up to 20 kHz or the
  browser Nyquist limit.
- Absolute dB determines visual existence and weight. Deviation from a slow
  baseline determines motion and trail only; it never promotes a quiet upper
  harmonic above a stronger low harmonic.
- Introductions add a broadband envelope so voice and non-harmonic material are
  represented instead of being forced into the Beacon series.
- The analyser reads the declared `-120..0 dB` range. Reduced-motion and
  Save-Data clients reduce both rendering and FFT analysis to 2 fps; the normal
  workbench runs at 30 fps.
- `HarmonicAnalysisFrame` is renderer-neutral. A later server analyzer may emit
  the same schema without changing the Canvas renderer.

## Visual language

The point of view is fixed. Neither stereo balance nor aggregate energy moves
the center or the horizon. Each audible harmonic follows a deterministic,
continuous low-frequency dance whose amplitude is bounded by its measured
absolute energy and softly modulated by its baseline variation. Inactive bands
remain only as a uniform, very faint structural weave; they cannot acquire the
brightness, width emphasis or strong motion of measured energy.

Outer ribbons use a lightweight pinned-cloth model. Their inner edge remains
anchored, a very gentle wave keeps the field alive, and measured harmonic
energy/variation increases the displacement toward the free edge. The waves
are continuous and harmonic-specific, so analysis frames cannot make an end
point jump.

The radial interpretation is a magical underwater kelp viewed from above: a
fixed luminous center below the observer, long leaves carried by a slow current,
and perspective-biased outer tips that broaden and brighten toward the camera.
An activated harmonic increases its leaf's motion and local glow; it never
moves the center or the camera.

The laboratory currently offers three renderers over the same analysis frame:

- **Harmonic radial series** is the default full-bank view. Every selected
  harmonic is a concentric band at a position proportional to its identity in
  the complete measurable series. A convex radial projection keeps the low
  bank compact and progressively increases spacing through the upper bank.
  `Outer spacing growth` exposes that projection as a percentage: 0% is linear,
  while higher values increasingly compact the inner bank and expand outer
  steps without moving the final ring.
  Low, mid and high registers use the low, mid and high palette colors; the
  highest rings reach or cross the short viewport edge. It has no free ribbons
  and its center field is fixed at 100%.

- **Radial ribbons** groups harmonics through a stable center. A true 0–100%
  Center field control divides the complete measurable bank: 0% places every
  harmonic in the outer ribbon field and 100% places every harmonic in the
  center field, with no forced mixture at either extreme.
- **Horizon flow** pours broad harmonic ribbons from fixed positions on a
  horizon. Harmonics below the cut stay closer to the center; upper harmonics
  fan farther outward.

Changing renderer, cut harmonic, width, palette or other visual controls never
rebuilds the audio graph. FFT size and baseline duration remain analysis-session
controls and therefore require Stop before changing them.

## Audio boundary

Visual mode is selected while stopped. Enabling or disabling it remounts fresh
media elements before the next Listen because a `MediaElementAudioSourceNode`
cannot be detached back into native playback.

The visual graph has one unprocessed `source → destination` branch and passive
splitter/analyser branches. There are no gain, filter, compressor or destination
branches in the analysis path. The existing element volume, fades, transport,
HLS buffer and stereo source remain authoritative.

If graph startup fails, the experimental controller is discarded and a fresh
direct player is presented. A Canvas or frame-analysis failure stops rendering
while retaining the direct graph. Background resume is best effort; a failed
context resume also returns to a fresh direct player.

## Staging laboratory

The exact staging host exposes the opt-in control and a collapsible parameter
panel. Visual parameters can change while listening. FFT size and slow-baseline
duration are locked during playback because they require a fresh analysis
session. The FFT selector exposes both 8192 (lighter) and 16384 (more detail).
Presets export as versioned JSON. The current default is the human-selected
full-series Ember preset: sensitivity 3, -120 dB floor, 24 s baseline, 20 ms
attack, 140 ms release, 4 s trails, density 1, upper-detail bias 1, center field
100%, ribbon width 2.25 and FFT 16384.

Apple/native-HLS clients remain direct-mode only. WebKit's analysed native-HLS
path has not yet passed the acoustic, nonzero-signal, fade and handoff gates for
this product. Removing that gate requires a separately controlled laboratory
build or harness and physical-device evidence; there is no public query-string
override.

The retired regional fixture prototype and its environment flags are removed;
this experimental product has no compatibility promise before a public release.

## Acceptance before public exposure

Compare direct and visual modes on Chrome, Firefox and Android, including ES/EN
introduction handoff, Beacon-only, Stop, reconnect, headphones, Bluetooth and a
60-minute listen. Physical iPhone remains a direct-mode regression gate while
Apple is disabled. Before enabling visual mode there, use a controlled lab
harness to demonstrate audible glitch-free playback, nonzero analyser signal,
an inaudible Beacon beneath the intro, correct master/fades and natural handoff.
Record CPU, memory and frame pacing. The public Listener stays unchanged until
Nico accepts both the visual result and the absence of acoustic degradation.
