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

## Approved staging pair — 2026-08-06

Nico explicitly approved the following exact sources and AAC-LC 320 kbit/s,
48 kHz stereo delivery for EarlyBirds staging. Neither derivative applies gain,
normalization, dynamics or other signal processing.

| Role | Source | Source SHA-256 | Artifact | Artifact SHA-256 | Duration | Decoded level |
|---|---|---|---|---|---:|---|
| Continuous Beacon | `luz_de_manana_20260624-155633_2hs.wav` | `feb0cac547eee8a2012ede32f9358e1cad4b66f6aea3b1b839610e71fad42685` | `beacon-luz-20260624-2hs-aac320-v2` | recorded in its immutable `artifact.json` | 7,200 s | -14.2 LUFS, -0.2 dBFS true peak |
| EN intro | `BeaconDropIn-Amara-sol_r1_session.wav`, mtime `2026-08-06 18:16:41 ART` | `aa519b117f885b5ec457dc1736e18175e6a307d301bd5c295b9c58ee85a01168` | `amara-sol-en-r1-approved-aac320-v3.m4a` | `a67068458f3d72dcd13be1e8dc753d21e238c270195f93e26599aa2910a181db` | 332.939 s | -11.3 LUFS, -0.5 dBFS true peak |
| ES intro | `BeaconDropIn-Amara-sol_ES_r1_session.wav`, mtime `2026-08-07 02:21:48 ART` | `e59443ab765a4eb94c7d2ea96176647c5b0e5d2945966ea3de599270edec656b` | `amara-sol-es-r1-approved-aac320-v1.m4a` | `376b68eb485cb562e1ff2d702a23f05fdb67af76d619d26e839d077edc16a201` | 347.010 s | -11.3 LUFS, -0.4 dBFS true peak |

The EN v3 source supersedes the earlier same-named exports by immutable hash and
adds the approved long Beacon fade-in. Its opening five-second mean level rises
from -17.1 dB through -15.2, -13.4 and -12.5 dB in consecutive windows. The v2
artifact remains available only for rollback. The ES v1 source is Nico's
2026-08-07 approved current-gain Spanish mix. Its derivative likewise changes
only codec/container and keeps the authored 48 kHz stereo signal unchanged.

## Approved and published English intro revision — 2026-08-16

Nico supplied and explicitly approved a newly recorded English session as the
public Listener replacement. The prior EN v3 artifact remains immutable and
available only for rollback.

| Field | Value |
|---|---|
| Source | `/home/nicolas/BeaconDropIn-Amara-sol/export/BeaconDropIn-Amara-sol_EN_r1_session.wav` |
| Source SHA-256 | `f0d885893c529fb903431e9d5d6117ae30f16d02fa6b69b413860a3ebaec2a65` |
| Source format | PCM signed 16-bit, 48,000 Hz, stereo |
| Source bytes / duration | 87,264,044 / 454.500 s |
| Approved artifact | `amara-sol-en-r2-approved-aac320-v1.m4a` |
| Approved artifact SHA-256 | `86ce75249b506277651e632a671787827ddfc394a9777c56d9f3987d4fb7cd59` |
| Approved format | AAC-LC, requested 320 kbit/s, 48,000 Hz, stereo, fast-start M4A |
| Approved bytes / duration | 16,920,010 / 454.500 s |
| Decoded measurement | -13.6 LUFS integrated, 3.1 LU LRA, 0.0 dBFS true peak |

The conversion applies no gain, normalization, limiter, dynamics, resampling or
channel change. It was promoted by changing only the immutable EN artifact path
and recreating the Listener container at application SHA
`1e1e43e7f3f39f95371c535cde8547ce73de467a`. Public health/readiness were green,
the Beacon origin container was not recreated, the ES intro path remained
unchanged and no database migration ran. Rollback restores
`amara-sol-en-r1-approved-aac320-v3.m4a` and recreates only Listener.
