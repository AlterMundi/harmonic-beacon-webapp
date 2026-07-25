# Cloud-Native Migration Plan (Option B)

Migrating Harmonic Beacon from its current **single-host Docker Compose** deployment to
a **cloud-native** architecture: stateless app containers, managed database, object
storage, and a real-time media plane isolated to the only place it can live.

> **Scope note.** Option A (lift & shift to one VM) is a valid and much cheaper path.
> This document plans Option B, which is only worth its cost if the goal is horizontal
> scalability of the web tier, provider portability, and removing the single host as a
> single point of failure. Read §9 before committing.

---

## 1. Where we are

```
                        inference-public (single host)
  ┌──────────────────────────────────────────────────────────────────┐
  │  nginx :443  (certbot TLS, rate limit, /api/stream/ ACL)         │
  │      ├── / ──────────────► app          :3003 (Next.js)          │
  │      └── /api/stream/* ──► go2rtc  127.0.0.1:1984                │
  │                                                                   │
  │  PostgreSQL :5432 (on the host, not containerized)                │
  │                                                                   │
  │  /mnt/n8n-data/harmonic-beacon/                                   │
  │      ├── meditations/    ← app reads, go2rtc reads (ro)          │
  │      ├── uploads/        ← app writes                             │
  │      ├── recordings/     ← LiveKit egress writes                  │
  │      └── beacon-records/ ← playlist-bot reads (ro)               │
  │                                                                   │
  │  playlist-bot ──► LiveKit @ host.docker.internal:7880             │
  └──────────────────────────────────────────────────────────────────┘
                    go2rtc WebRTC: UDP+TCP 8555, ICE = ${PUBLIC_IP}
```

Every one of the four directories is shared by **at least two processes**, and one of
them (`recordings/`) is written by a service that isn't even in this repo. That shared
filesystem is what pins the whole system to one machine.

## 2. Target

```
   Cloudflare / LB ── TLS, WAF, cache
        │
        ├──► app (N replicas, stateless)  ──► managed PostgreSQL
        │         │                        └─► object storage (S3 API)
        │         │                              ▲   ▲   ▲
        │         └─ presigned PUT/GET ──────────┘   │   │
        │                                            │   │
        ├──► playlist-bot (exactly 1 replica) ───────┘   │
        │         └──► LiveKit                           │
        └──► media VM (public IP, UDP)                   │
                  └── LiveKit SFU + Egress ──────────────┘
                  └── go2rtc  ← candidate for deletion, see D1

   ffmpeg mixdown ──► job queue ──► worker (not in the request path)
```

**The invariant:** no application process ever depends on a file being present on its
own local disk. Everything durable lives in Postgres or object storage.

---

## 3. Phase 0 — Decouple in place (no infra change yet)

These are correct regardless of provider, and every later phase depends on them. Do
them first, on the current host, where they are cheap to verify.

| # | Task | Files | Tier |
|---|------|-------|------|
| 0.1 | ✅ **Done — landed on `main`** (`38023db`). `GET /api/health` (liveness, no DB) and `GET /api/health/ready` (readiness, 503 when unreachable). nginx had been proxying `/api/health` to a route that did not exist. Shipped with `src/lib/redact.ts`, because the readiness handler's error log carried the DB password — a pattern found at 15 other call sites, so pre-existing rather than new. | `src/app/api/health/*`, `src/lib/redact.ts` | R2 |
| 0.2 | Move `NEXT_PUBLIC_LIVEKIT_URL` / `NEXT_PUBLIC_GO2RTC_URL` out of Docker **build args**. Today the image is welded to one environment (`Dockerfile:15-20`), so a staging image can never be promoted to prod. Serve them from a server component or a `/api/config` endpoint. | `Dockerfile`, `next.config.ts`, client consumers | R1→R2 |
| 0.3 | Split migrations out of the deploy job. `deploy.yml` runs `prisma migrate deploy` against `localhost:5432` **on the runner** — that assumption dies the moment Postgres is managed. | `.github/workflows/deploy.yml` | R2 |
| 0.4 | Delete every `process.cwd()` storage fallback (`join(process.cwd(), 'uploads')` and friends, in 5 route files). A silent fallback to container-local disk is the worst possible failure mode here: it *works*, then the file vanishes on redeploy. Fail loudly on missing config instead. | the 5 routes in §4.2 | R2 |
| 0.5 | Structured JSON logging to stdout with a request id. Container platforms give you nothing else. | `src/lib/` | R2 |

**Exit criterion:** the app still runs on the current host, but a fresh container with
an empty disk and correct env vars behaves identically to the existing one.

---

## 4. Phase 1 — Storage abstraction (the critical path)

This is the largest piece of work and everything else queues behind it.

### 4.1 The design

A driver interface, two implementations (`LocalFsDriver` for dev and the current host,
`S3Driver` for cloud), selected by env. No route imports `fs` directly afterwards.

```
src/lib/storage/
  index.ts        # getStorage() — driver selection by STORAGE_DRIVER env
  types.ts        # StorageDriver interface
  local-fs.ts     # current behaviour, for dev
  s3.ts           # S3-compatible
  keys.ts         # key derivation — single source of truth for layout
```

```ts
interface StorageDriver {
  put(key: string, body: Buffer | ReadableStream, contentType: string): Promise<void>
  getStream(key: string, range?: { start: number; end?: number }): Promise<StorageObject | null>
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>
  signedPutUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>
  copy(from: string, to: string): Promise<void>   // S3 has no rename
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

**Key layout.** Today the *location* of a file is implied by the meditation's `status`:
`filePath` holds a bare filename (`"amor.ogg"`) and the directory is chosen by the
reader. That implicit coupling must become explicit:

```
uploads/{meditationId}/{filename}       # PENDING / REJECTED
meditations/{meditationId}/{filename}   # APPROVED
recordings/{sessionId}/{trackId}.ogg    # LiveKit egress
beacon-records/{yyyy-mm-dd}/{file}.ogg  # playlist source
```

### 4.2 Call sites to migrate

| Call site | Current behaviour | Becomes |
|-----------|-------------------|---------|
| `api/meditations/upload/route.ts:76-81` | `mkdir` + `writeFile` of a 100MB `arrayBuffer()` in the request | **Presigned PUT** — client uploads straight to the bucket; route only issues the URL and creates the DB row (`status: PENDING`, `uploadState: AWAITING`) |
| `api/admin/meditations/[id]/route.ts:59-75` | `rename`, falling back to `copyFile`+`unlink` | `copy()` + `delete()` — object stores have no atomic rename. Order matters: copy, verify, update DB, *then* delete |
| `api/meditations/[id]/audio/route.ts` | `streamFile()` from local path | **302 to a short-TTL presigned GET.** Do not proxy audio bytes through the app — it burns egress twice and pins a connection per listener |
| `api/admin/meditations/[id]/audio/route.ts:34` | ditto, path chosen by status | ditto, key chosen by status |
| `api/provider/sessions/[id]/cuts/route.ts:97-100` | ffmpeg writes to `UPLOADS_PATH` | worker pulls inputs, writes output, uploads (see Phase 5) |
| `src/lib/stream-file.ts` | `createReadStream` + Range handling | retained **only** for `LocalFsDriver`; the S3 path delegates Range to the bucket |
| `recording/start/route.ts:177` | `DirectFileOutput({ filepath })` | `EncodedFileOutput` + `S3Upload` — LiveKit egress writes to the bucket itself, severing its filesystem coupling to the app |
| `services/playlist-bot/src/index.ts` | reads `/data/beacon-records` | lists + streams from the bucket |

### 4.3 Schema and data migration

- Add `storageKey String?` to `Meditation`; backfill from `filePath` + `status`; keep
  `filePath` until the cutover completes, then drop it in a later migration.
- Add an upload-state field so a presigned upload that the client abandons is
  distinguishable from one that succeeded. Today a DB row is only created *after* a
  successful write; with presigned uploads that ordering inverts, and orphan rows
  become possible. Plan the reaper.
- One-time sync of `/mnt/n8n-data/harmonic-beacon/**` into the bucket (`rclone` or
  `aws s3 sync`), then verify counts and checksums before flipping the driver.

### 4.4 Risks

- **Range requests must survive.** The player seeks; presigned GETs must support
  `Range`. Verify on the chosen provider before committing (open question for research).
- **CORS on the bucket** is required for browser-direct upload *and* for direct audio
  playback. Get this wrong and the failure is a silent opaque error in the console.
- **Presigned URL TTL vs. audio length.** A URL that expires mid-playback breaks
  seeking. Use a TTL comfortably longer than the longest meditation.
- **Signed URLs leak.** They are bearer tokens in a query string, visible in browser
  history and referrer headers. Short TTL, and never log them.

---

## 5. Phase 2 — Managed database

| # | Task | Tier |
|---|------|------|
| 2.1 | Provision managed Postgres 15+ with TLS. Prisma 7 already uses `@prisma/adapter-pg`, so the driver side is done. | R0 |
| 2.2 | **Connection pooling.** N stateless replicas × Prisma's pool will exhaust a small managed instance's connection limit fast. Use the provider's pooler, and cap `connection_limit` in the URL. | R1 |
| 2.3 | Migrations as a dedicated release step with network access to the DB — a CI job or an init container, gated so two replicas never migrate concurrently. Note: some serverless PG poolers do **not** support the advisory locks Prisma migrations use; migrations may need the direct (non-pooled) URL while the app uses the pooled one. | R0 |
| 2.4 | Automated backups + a **restore rehearsal**. A backup you have never restored is a hypothesis. | R0 |

---

## 6. Phase 3 — The real-time media plane

This is the part that does **not** move to a PaaS, and pretending otherwise is the most
likely way this migration fails.

### D1 — Does go2rtc survive? *(decision required)*

go2rtc exists to serve meditation audio over WebRTC. But meditations are **pre-recorded
files**. For pre-recorded playback, WebRTC buys sub-second latency that nobody needs,
while costing: a pinned public IP, open UDP/8555, an ICE configuration that breaks
behind NAT, zero CDN cacheability, and a whole container to operate.

Plain HTTP with Range requests — which the app *already implements* in
`src/lib/stream-file.ts` — gives seeking, CDN caching, and works everywhere.

**Strong prior: delete go2rtc.** Serve meditations as presigned GETs from the bucket,
optionally behind a CDN. That removes an entire block from the architecture, deletes
the `/api/stream/*` nginx ACL surface, makes `Meditation.streamName` vestigial, and
eliminates the public-IP requirement for this component entirely. Confirm against the
research findings before executing, and check whether any product requirement (live
mixing? synchronised group listening?) actually depends on WebRTC here.

### D2 — LiveKit: Cloud or self-hosted? *(decision required)*

The live beacon genuinely needs an SFU — that is not removable. Options:

- **LiveKit Cloud.** Removes the UDP/public-IP problem completely. Must verify that
  **Egress (track recording) is available on the tier being considered** — the app
  depends on it (`recording/start/route.ts`), and egress is commonly a paid feature.
- **Self-hosted on a VM** with a static public IP, a UDP port range, and TCP fallback
  for restrictive networks. Cheaper, but this VM becomes the new single point of
  failure and someone has to operate it.

If self-hosted survives, that VM is the *only* machine in the architecture needing a
public IP and inbound UDP — a much smaller and better-understood blast radius than
today.

---

## 7. Phase 4 — Compute

| # | Task | Notes | Tier |
|---|------|-------|------|
| 4.1 | App on a container platform, ≥2 replicas | Only legal once Phase 1 completes. **Prove it**: run 2 replicas locally and confirm no request depends on local disk | R0 |
| 4.2 | `playlist-bot` as a single-replica always-on service | Not serverless — it holds a persistent LiveKit connection and has a heartbeat-file health check. Two replicas would double-publish audio; enforce max=1 | R0 |
| 4.3 | Replace `host.docker.internal:7880` with a real service address | `docker-compose.yml:playlist-bot` assumes LiveKit is on the same machine | R2 |
| 4.4 | ffmpeg out of the request path | `src/lib/ffmpeg-mix.ts:61` runs `execFile` with a 120s timeout **inside** an HTTP request. Move to a queue + worker; the route enqueues and returns a job id | R1→R2 |

---

## 8. Phases 5–7 — Edge, delivery, operations

### Phase 5 — Edge & security

The nginx config is not just a proxy; it carries **security logic that will be silently
lost** if replaced by a default managed load balancer:

- `location /api/stream/ { return 403; }` — blocks go2rtc's admin API from the internet.
  **If go2rtc survives D1 and this rule doesn't come with it, its config API is public.**
- Two `limit_req_zone` rate limiters (30r/s stream, 10r/s api).
- The security header block (HSTS, X-Frame-Options, nosniff, Referrer-Policy).
- `client_max_body_size 100M` — moot once uploads go presigned, which is the point.

Each of these needs an explicit home in the new edge (WAF rule, LB config, or Next.js
middleware). Port them deliberately, item by item.

Auth behind a proxy: `AUTH_URL` must be the public origin, `AUTH_TRUST_HOST=true`, and
`X-Forwarded-Proto` must arrive intact or NextAuth will mint `http://` callbacks.

### Phase 6 — CI/CD

- Build once → push to a registry → deploy **by immutable digest**, not `latest`.
- Tag images with the git SHA; rollback becomes "redeploy the previous digest".
- Secrets from a real secret store, not a file written by the deploy job
  (`deploy.yml` currently `tee`s them into `/etc/sai-harmonic-beacon/production.env`).
- The current `Rollback on failure` step (`docker compose up -d` after a `down`) is not
  a rollback — it redeploys the same broken images. Replace with digest pinning.

### Phase 7 — Cutover

1. Deploy the new stack alongside the old, pointing at a **copy** of the data.
2. Verify: OIDC login, upload → approve → play, live beacon join, recording start/stop,
   playlist-bot failover, seeking within a long meditation.
3. Freeze writes, final data sync, flip DNS, watch.
4. Keep the old host intact and runnable for at least two weeks.

---

## 9. Sequencing, cost, and the honest caveat

**Critical path:** `Phase 0 → Phase 1 → everything else`. Phases 2, 3 and 6 can proceed
in parallel with Phase 1; Phase 4 cannot start until Phase 1 is done, because
multi-replica is exactly what local disk forbids.

**Effort concentration:** Phase 1 is roughly two-thirds of the work. If it stalls, the
migration stalls.

**The caveat.** Option B's benefits — horizontal scale, provider portability, no single
host — are real but only pay off under load this app does not currently have. Option A
(one VM, managed Postgres, same compose file) captures most of the operational
robustness for a small fraction of the effort.

**A defensible middle path exists and is probably the right one:** do **Phase 0 and
Phase 1** (which are unambiguously good — they remove the local-disk coupling that is
the actual architectural debt), take **D1** (delete go2rtc if the research confirms it),
and then decide between Option A and full Option B with the hard part already done.
Phase 1 is not wasted work under either outcome.

---

## 10. Provider selection

Research conducted 2026-07-25 across four parallel read-only agents (compute/PaaS,
database/storage, WebRTC/UDP, platform layer). Findings below are as of that date;
free tiers erode fast and every one of these needs re-checking before signup.

### 10.1 The discriminator nobody expects: `playlist-bot`

Not the web app — the **worker** is what disqualifies most free tiers. It holds a
persistent LiveKit connection, must be exactly one replica, and must never sleep.

- **Render** — background workers are **not available on the free plan at all**.
- **Koyeb** — Worker Services **excluded from the free tier**; free instances scale to
  zero after 1h idle with no override.
- **Cloud Run / Azure Container Apps** — the monthly free grant covers request-time
  compute. A persistent socket needs *CPU always allocated*, which is outside the grant
  and costs tens of dollars/month. This is an architectural mismatch, not a pricing
  footnote — in the default request-billed mode the CPU is throttled between requests
  and the websocket dies.
- **Railway / Zeabur / Fly.io** — no perpetual free always-on allowance remains in 2026.

**Only two candidates survive:** a plain VM, or Northflank's Sandbox tier (which
markets always-on with no sleep, and whose *2 free services* maps exactly onto
app + worker — but its resource caps are unpublished and unverified).

### 10.2 Selected stack

| Layer | Pick | Free-tier terms (verified 2026-07-25) | Gotcha |
|-------|------|----------------------------------------|--------|
| **Database** | **Neon** | 0.5 GB storage, 100 CU-hours/mo, pooling included, perpetual, no CC | Compute scales to zero after 5 min idle (cannot disable on Free) — cold start on first query. Fine for staging; don't build health checks that assume a warm connection |
| **Object storage** | **Cloudflare R2** | 10 GB Standard, 1M Class A + 10M Class B ops/mo, **$0 egress unconditionally**, perpetual | Free tier is Standard class only — don't create Infrequent Access buckets. Sources disagree on whether a payment method is required at signup; verify |
| **Live SFU** | **LiveKit Cloud (Build)** | 5,000 participant-min/mo, 50 GB egress, permanent, no CC | **Recording egress is only 60 min/month.** The app depends on track egress. Overage is audio-only $0.005/min — cheap, but it is not $0 |
| **Edge / TLS** | **Cloudflare Free** | TLS, DNS, WebSocket proxying, base managed WAF ruleset | See §10.3 — three real limits |
| **Registry** | **GHCR** | Unlimited private repos, free storage/bandwidth | "Currently free" is an informal Fair-Use policy, not a contractual allowance |
| **CI** | **GitHub Actions** | 2,000 min/mo private; self-hosted runners free and unlimited | The announced $0.002/min self-hosted platform fee (March 2026) was postponed and never took effect |
| **Secrets** | **GH Actions secrets** + **SOPS+age** | Free, unmetered | age key custody is entirely yours — no audit log, no rotation |
| **Observability** | **Grafana Cloud free** + self-hosted **Uptime Kuma** | 10k series / 50 GB logs, 14-day retention | Every free tier here caps retention at 14–30 days |
| **Compute** | see §10.4 | | |

### 10.3 Cloudflare Free — three limits that hit this app specifically

1. **100 MB request body ceiling.** The app's `MAX_UPLOAD_SIZE_MB=100` and nginx's
   `client_max_body_size 100M` sit *exactly* at it — multipart boundaries and headers
   can push a legitimate 100 MB upload over. Phase 1's presigned-PUT refactor makes
   this moot by routing bytes straight to R2 on a non-proxied hostname. **This is no
   longer just an optimisation; it is load-bearing.**
2. **100-second WebSocket idle timeout** (Free/Pro). LiveKit *signaling* runs over a
   WebSocket through the proxy and needs an application-level heartbeat or Cloudflare
   drops it silently. WebRTC media itself is UDP/SRTP and never transits the proxy, so
   only signaling is affected.
3. **Rate limiting is crippled**: 1 rule, 10-second counting window, IP-only keys, and
   **no custom WAF rules** on Free. The two `limit_req_zone` rules in the current nginx
   config cannot be reproduced. Rate limiting has to move into the app (middleware) or
   a self-hosted proxy layer.

### 10.4 Compute — the honest recommendation

| Option | Cost | Verdict |
|--------|------|---------|
| **Hetzner CX22** — 2 vCPU / 4 GB / 20 TB traffic | **€3.79/mo** | **Cheapest that actually works.** Two independent research agents converged on this. No capacity roulette, no sleep, no body-size or duration ceiling, full Docker control |
| **Northflank Sandbox** | €0 | The only PaaS claiming always-on free with 2 services. **Verify before planning around it** — resource caps are unpublished, and whether long-lived worker sockets are permitted on the free tier is unconfirmed |
| **Oracle Cloud A1** | €0 | **Quietly halved on 2026-06-15** from 4 OCPU/24 GB to 2 OCPU/12 GB, unannounced, with over-cap instances force-shut-down. Combined with chronic "Out of Capacity" provisioning errors and idle reclamation (p95 CPU <20% over 7 days), treat as a bonus, never as the primary plan |
| GCP e2-micro | €0 | **1 GB/month egress** — not the 200 GB commonly cited. Unusable for media |
| AWS / Azure | — | AWS free tier restructured 2025-07-15: accounts created after that date get a 6-month credit pool, **no free EC2**. Azure B1s is 12-month, not perpetual |

**Recommended test stack: Hetzner CX22 (€3.79/mo) running the app + playlist-bot
containers, with Neon + R2 + LiveKit Cloud + Cloudflare Free around it.**

Total ≈ **€4/mo**, plus LiveKit egress overage beyond 60 recording-minutes. The €4
buys away every free-tier failure mode above — sleep, capacity roulette, silent quota
cuts, worker exclusion — which for a staging environment whose entire purpose is
*validating that the architecture works* is worth far more than €4.

A genuinely $0 path exists via Northflank Sandbox. Verify it hands-on before betting
the plan on it.

---

## 11. Resolved decisions

| ID | Decision | Outcome | Evidence |
|----|----------|---------|----------|
| **D1** | Delete go2rtc? | **YES — delete it.** For pre-recorded audio, WebRTC buys sub-500 ms latency nobody needs, while costing a pinned public IP, open UDP, ICE that breaks behind NAT, and **zero CDN cacheability** (SRTP/UDP is fundamentally uncacheable by HTTP CDNs). Range requests give free byte-accurate seeking; WebRTC has no seek concept at all — it is a live pipe, not a random-access file | Confirmed by research + `src/lib/stream-file.ts` already implementing Range |
| **D2** | LiveKit Cloud vs self-hosted | **Cloud (Build) for staging**, self-hosted on the same VM if recording volume grows. Egress *is* available on the free tier but capped at 60 min/month | LiveKit pricing, verified 2026-07-25 |
| **D3** | Compute provider | **Hetzner CX22**, with Northflank Sandbox as the $0 alternative pending verification | §10.4 |
| **D4** | Object storage | **Cloudflare R2** — zero egress is decisive for streaming audio | §10.2 |
| **D5** | Full Option B or Phase 0+1 then Option A | **Open — Fede's call.** See §9 | — |

### What D1 changes about the whole plan

With go2rtc gone, **LiveKit becomes the only component in the entire architecture that
needs a public IP and inbound UDP.** And if LiveKit Cloud takes that, *nothing* in the
self-hosted footprint needs UDP at all — the deploy collapses to two ordinary
containers, a managed database, and a bucket.

That is a substantially smaller system than the one this document opened with, and it
is the single highest-value change in the migration. Phase 3 largely evaporates;
Phase 5's `/api/stream/` ACL problem disappears with the component it was protecting.

### Claims to re-verify before acting (per `.claude/AGENT_POLICY.md` §3)

Research is cheap and confident — that combination is dangerous. These drive R0/R1
decisions and must be confirmed first-hand:

- **Northflank Sandbox resource caps and worker-socket support** — the linchpin of the
  $0 path and the least verified claim in the entire research set.
- **R2 payment-method requirement at signup** — sources disagree.
- **Range request support on R2 presigned GETs** — a 5-minute smoke test:
  `curl -H "Range: bytes=0-1023" "<presigned-url>"` and check for `206` +
  `Content-Range`. Audio seeking depends on it entirely.
- **Neon's policy on long-idle *projects*** (compute suspension is documented and
  benign; project deletion was neither confirmed nor ruled out).
- **LiveKit Cloud egress on the Build tier** — confirm the 60 min/month figure against
  the app's actual recording usage before assuming staging fits.
