# Beacon stream origin

This is a separate, resource-bounded HLS origin for EarlyBirds. It has no
LiveKit, `AudioContext`, event code, encoder, or media transform. The service
only serves an explicitly approved, already-packaged immutable artifact.

## Approval and artifact boundary

1. Record the read-only master checksum with `npm run inventory -- --master
   /path/master.wav --output /safe/inventory.json`.
2. Nico performs the required A/B review outside this service.
3. An approved artifact is packaged externally into a new directory, with
   `artifact.json` and immutable six-second segments. No segment can replace an
   existing segment; a correction receives a new artifact ID.
4. Run `npm run verify-artifact -- --media-root /mounted/artifacts --artifact
   approved-artifact-id` before startup. Startup repeats the checksum check.

There is deliberately no command here to encode, resample, alter gain, or pick
a codec. It cannot make an audio candidate before an external approval exists.

## Artifact metadata

`artifact.json` uses schema version 1. Required fields are `approval.status`
(`APPROVED`), approval timestamp and review record, source master SHA-256, derivative SHA-256,
fixed `timing.epochUtc`, `segmentDurationSeconds: 6`, `segmentCount`, and the
complete `{ file, bytes, sha256 }` segment inventory. The UTC epoch means that
every origin instance computes the same global position and restart never
changes a listener's wall-clock position.

## Authorization contract

The application validates the Listener entitlement, then signs a short-lived
playlist URL using HMAC SHA-256 over:

```text
GET\n/v1/hls/<artifact>/live.m3u8\n<unix-expiry>
```

with `BEACON_STREAM_SIGNING_SECRET`. The service accepts only future expiry
timestamps no more than ten minutes ahead and compares signatures in constant
time. The manifest signs every individual segment URL because native HLS does
not inherit the playlist query string. Signatures, secrets, and complete signed
URLs are never logged.

Chrome/Firefox fetch signed segments through `hls.js`, so the origin returns
CORS headers only for the exact comma-separated origins configured in
`BEACON_STREAM_ALLOWED_ORIGINS`. Use the Listener application origin here, not
the media origin itself; no wildcard is accepted or emitted.

Public listener routes are `/healthz` and authenticated HLS paths. `/readyz`
and `/metrics` listen separately on a private metrics interface; they must not
be reverse-proxied on the listener origin. The origin emits low-cardinality
request/status, p95/p99 duration, served-byte and uptime metrics.

## Verification and operations

```bash
cd services/beacon-stream
npm test
npm run check
npm run canary                 # BEACON_CANARY_MANIFEST_URL is a fresh signed URL
npm run load -- --manifest "$SIGNED_MANIFEST" --clients 50 --rounds 20
docker compose --env-file preview.env up --build
```

The canary verifies HLS syntax and retrieves a non-empty signed segment. It is
intentionally codec-neutral; audio decode verification is a release gate run
only after a reviewed delivery format exists. The load harness fetches manifests
and signed segments without decoding or altering media and reports error rate,
bytes and p95/p99 latency. It is a ramp harness, not proof of a 3,000-listener
production target.

For an incident, `docker compose stop beacon-stream` stops this origin alone;
the event compose project and playlist bot are unrelated.
