# EarlyBirds source media provenance

Recorded read-only on 2026-08-06. These checksums identify source masters only.
They do **not** approve a codec, derivative, mix, loudness treatment or public
release. Every delivery artifact remains blocked on Nico's audio/content review.

## Continuous Beacon master

| Field | Value |
|---|---|
| Host path | `/home/nicolas/Music/beacon/luz_de_manana_20260624-155633.wav` |
| SHA-256 | `479b4132fc44766e3e1316fad21681685d4a7cb3d1f81a365ddb72f95e4e6d89` |
| Bytes | `2,628,259,840` |
| Duration | `6,844.426437 s` |
| Encoding | PCM float 32-bit little-endian |
| Rate/channels | 48,000 Hz, stereo |
| Source bitrate | 3,072,000 bit/s |

The inventory was produced incrementally by
`services/beacon-stream/scripts/inventory.mjs`; the machine-local mode-0600
record is outside Git at
`/home/nicolas/.cache/harmonic-beacon/early-birds-master-inventory.json`.

## Selected drop-in voice masters

| Language | Host path | SHA-256 | Bytes | Duration | Source format |
|---|---|---|---:|---:|---|
| ES | `/home/nicolas/Downloads/BeaconEarlyAdopters/Proyeccion_Caldeamiento_Amara_Sol_ES_VOICE.wav` | `b6771528b963980b47dae4512a7b8feb933168837caf03680f737770c1f6f190` | 16,566,798 | 345.140 s | PCM signed 16-bit, 24,000 Hz, mono |
| EN | `/home/nicolas/Downloads/BeaconEarlyAdopters/Proyeccion_Caldeamiento_Amara_Sol_EN_VOICE.wav` | `a32bed738b0090c051622c780c091dc90ba56e21e2c71f9e3d1e76795eeddfa3` | 15,841,038 | 330.020 s | PCM signed 16-bit, 24,000 Hz, mono |

The approved product direction is an offline candidate render with an approved
Beacon excerpt ducked by 9 dB beneath the unchanged voice master. No candidate
has been generated or approved by this inventory step.

## Promotion invariant

An approved artifact gets a new immutable artifact ID and records source hashes,
encoder/tool versions, codec/container, sample rate, channels, loudness/peak
measurements, UTC epoch, segment inventory and a link to the human review. A
correction creates a new artifact; it never overwrites a source or accepted
previous version.
