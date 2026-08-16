# Approved delivery artifacts

This directory contains metadata only in Git. Media bytes live on the host or
object storage and are mounted read-only at runtime.

An artifact directory is eligible for the origin only when its `artifact.json`
has an explicit, recorded approval and all referenced immutable six-second
segments pass `scripts/verify-artifact.mjs`. The approval must happen after the
audio A/B review; this repository deliberately contains no encoder command,
codec choice, or sample-rate/channel/gain transform.

`artifact.json` must provide:

- an immutable source master SHA-256;
- an approved derivative SHA-256 and audio review record;
- fixed UTC epoch, six-second segment duration and a finite segment count;
- a SHA-256 inventory for every segment under `segments/`.

Segments are never replaced in place. Corrections create a new artifact ID and
a new immutable directory. The running origin receives only the selected
artifact directory as a read-only mount.
