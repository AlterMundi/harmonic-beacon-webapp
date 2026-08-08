# Listener cosmic campfire prototype

Status: isolated, presentation-only prototype for #212. It is disabled by
default and is not part of the accepted Listener MVP.

## Boundary

- No presence endpoint, network request, location input or account data.
- No Web Audio, media-element, HLS, lease, transport or event-audio integration.
- The canvas is decorative, has no pointer interaction and stays outside the
  accessibility tree.
- `prefers-reduced-motion`, Save-Data and a hidden document produce a static or
  paused scene. Animated rendering is capped at 20 frames per second and device
  pixel ratio is capped at 1.5.
- The only data is one of four deterministic fixtures: `empty`, `near`,
  `middle` or `far`. They represent anonymous distance bands, not real people.

## Explicit preview opt-in

Both values are server-side runtime configuration. Nothing is enabled when
they are absent.

```text
LISTENER_CAMPFIRE_PROTOTYPE=1
LISTENER_CAMPFIRE_FIXTURE=empty|near|middle|far
```

An invalid fixture fails to `empty`; any flag value other than the exact `1`
keeps the established blank MVP. No production or staging configuration in the
repository enables the prototype.

## Review gate

Review all four fixtures at 320, 390, 768, 1024 and 1440 CSS pixels. The
prototype may connect to the future privacy-preserving #211 contract only
after that contract exists and after an explicit product/performance review.
Until then it must not replace `BeaconField` or imply a real crowd.
