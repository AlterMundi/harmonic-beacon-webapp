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
session. Presets export as versioned JSON.

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
