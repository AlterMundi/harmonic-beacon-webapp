# Tapestry service

Bounded in-memory composite of attendee camera snapshots ("the tapestry").
The Next.js app POSTs one small JPEG per participant through an
entitlement-gated proxy; this process keeps only the latest 100 px tile per
opaque identity, expires frames after 10 seconds, caps a session at 150
identities, and renders one grid JPEG per seeded session at most once per
second using `sharp`. All bytes live in memory — nothing is written to disk,
and a process restart yields an empty tapestry.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/tapestry/sessions/:sessionId/participants/:participantId/frame` | secret | Ingest one JPEG frame (max 20 KB) |
| `GET` | `/tapestry/sessions/:sessionId/composite.jpg` | secret | Current composite grid JPEG |
| `GET` | `/health` | none | Service state and counts (never identifiers) |

Authenticated endpoints require the `x-tapestry-internal-secret` header to
match `TAPESTRY_INTERNAL_SECRET` (constant-time comparison). The service
binds to an internal port and is never directly internet-exposed.

The composite is a fixed 15×10 grid (1500×1000 px) of 100 px tiles in
deterministic first-seen order, JPEG output, rebuilt at most once per second
per session and only when the frame set changed.

## Configuration

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `TAPESTRY_INTERNAL_SECRET` | yes | — | Shared secret with the app (≥16 chars) |
| `TAPESTRY_SESSION_IDS` | yes | — | Comma-separated seeded session IDs; ingest for any other session is rejected |
| `TAPESTRY_PORT` | no | `3100` | Listen port |
| `TAPESTRY_HOST` | no | `127.0.0.1` (`0.0.0.0` in the Dockerfile) | Bind address |

## Run locally

```sh
npm ci
npm run build
TAPESTRY_INTERNAL_SECRET=dev-secret-at-least-16-chars \
TAPESTRY_SESSION_IDS=dev-session \
npm start
```

Ingest a frame and fetch the composite:

```sh
curl -X POST http://127.0.0.1:3100/tapestry/sessions/dev-session/participants/p1/frame \
  -H 'x-tapestry-internal-secret: dev-secret-at-least-16-chars' \
  -H 'content-type: image/jpeg' --data-binary @frame.jpg

curl http://127.0.0.1:3100/tapestry/sessions/dev-session/composite.jpg \
  -H 'x-tapestry-internal-secret: dev-secret-at-least-16-chars' -o tapestry.jpg
```

## Run in Docker

```sh
docker build -t harmonic-beacon-tapestry:local .
docker run --rm -p 127.0.0.1:3100:3100 \
  -e TAPESTRY_INTERNAL_SECRET=dev-secret-at-least-16-chars \
  -e TAPESTRY_SESSION_IDS=dev-session \
  --memory=256m --cpus=0.5 \
  harmonic-beacon-tapestry:local
```

or `TAPESTRY_INTERNAL_SECRET=... docker compose up --build` from this
directory (standalone dev Compose with the same limits; the production
Compose is owned by WS5).

## Tests

```sh
npm test
```

Covers every automatable acceptance criterion: rejection paths (content
type, oversize, unknown session, bad secret, 151st identity) with no byte
retention, frame replacement, 10-second expiry, composite rate limiting and
grid layout, health redaction, and a 30-second soak at 60 ingests/second
across 150 participants (a shortened stand-in for the 10-minute container
soak — see the comment in `test/soak.test.ts`).
