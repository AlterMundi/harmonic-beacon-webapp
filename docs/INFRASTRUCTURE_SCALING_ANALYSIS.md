# Infrastructure & Scaling Analysis

**Status:** Research · 2026-07-25 · updated 2026-07-25/27 · reconciled against `main` 2026-07-28 · **peer-review reconciled 2026-07-28**.

> **🔬 Peer-review reconciliation (2026-07-28).** From
> [`docs/reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md`](./reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md) — corrections
> adopted below:
> - **Two-room cost, missed entirely:** every attendee holds a **global "beacon" room connection** (`AudioContext`)
>   *plus* the session room — **two** LiveKit connections. That ~doubles billable connection-minutes (~$347 vs
>   ~$167/mo on Ship) and nears the 1,000-concurrent Ship quota at ~500 attendees. **Disconnect the global room
>   during a paid session** (or move the file-bot into the session room with source-specific gain) before launch.
> - **Audio bandwidth math was inconsistent:** two **128 kbps** sources = 256 kbps/listener = **128 Mbps** aggregate
>   ≈ **86.4 GB** per 500-person 90-min event (my "43 GB / 64 Mbps" implied 128 kbps *total*, i.e. two 64 kbps
>   sources). Numbers corrected below.
> - **Benchmark nuance:** the "3,000 subscribers" single-node figure is an **audio-only, ~3 kbps test stream** (10
>   publishers @ ~80% CPU); the ~92% figure is the **video** case. Real 128 kbps audio capacity is lower — don't
>   over-read the headline.
> - **300-person room = ONE big node, not a cluster.** Multi-node LiveKit spreads *rooms*, never one room — my
>   video section's "multi-node cluster for 300 all-camera" was self-contradictory. Fixed.
> - **Recording breaks on Cloud:** egress writes server-local paths and lifecycle `existsSync`-checks them; promoted-
>   after-start speakers aren't captured. **Disable recording for launch, or configure R2/S3 egress first.**
> - **The deploy "rollback" is not real** (rebuilds from the same source; no immutable image, no DB rollback).
> - Hetzner's **20 TB is EU-only** (US ≈ 1 TB) — don't cite it as globally low-latency for a Costa-Rica audience.
> - See the review's **corrected cost table** (rechecked vendor prices 2026-07-28) for camera-circle scenarios,
>   where the dominant variable is **receivers × subscribed bitrate**, not publisher count.

> **🔄 Reconciliation note (2026-07-28).** Deltas since drafting; the analysis and recommendations stand, with
> these corrections to the "current state":
> - **go2rtc is fully removed** (commit `9512899`). Meditation audio is now served over plain HTTP range
>   requests (`src/lib/stream-file.ts`), and `docker-compose.yml` now runs just **two services** (`app` +
>   `playlist-bot`). Drop go2rtc from the inventory below (kept, struck through, for continuity).
> - **Observability partially exists now:** liveness `GET /api/health` (no DB) and readiness `GET
>   /api/health/ready` (DB `SELECT 1`, 3 s timeout, redacted errors, 503 on failure). Still **no metrics /
>   tracing** — so the "no observability" claim is now only half true.
> - **Neon is being prepared, not provisioned.** A `.neon` init scaffold + vendored Neon skills exist, but there
>   is no project link, no `@neondatabase/*` dep, and `DATABASE_URL` still points at **host Postgres**. So the
>   DB→Neon recommendation is *already the team's direction* but not yet done — good alignment.
> - **Most compliance gaps are closed:** `LICENSE`/`NOTICE` (Apache-2.0), PII-log redaction, data export +
>   account deletion, an audit log, a reports/abuse system, and an admin session kill-switch all now exist.
>   **Storage caveat that reinforces the R2 recommendation:** deletion **cannot purge stored audio yet** (no
>   object-storage driver — a `TODO(storage)` gap), and audio still sits on the shared local `/mnt/n8n-data`
>   disk. Moving audio to R2 + a driver is now also a *compliance* need, not just a delivery one.
> - `deploy/.env.example` is stale/legacy; the authoritative env surface is root **`.env.example`** + the
>   deploy.yml secrets heredoc.
**Question posed:** The app is self-hosted on our own server/infrastructure; that won't be compatible with a
growing audience. What should the web-services architecture become?

> **⚠️ Decisions locked by the team (2026-07-25/27) — these override the earlier "broadcast" recommendation:**
> 1. **Migrate OFF our own infrastructure.** The driver is **isolation, not scale**: the same infra hosts other
>    sensitive services we don't want disturbed if Beacon spikes. So Beacon must move to its *own* dedicated
>    (managed or isolated) infrastructure.
> 2. **Sessions are interactive.** The provider leads, but there is a **sharing round** where listeners unmute
>    their microphones to share experiences. → two-way audio is required.
> 3. **Keep low latency.** Unless it's strictly necessary to change it, preserve today's sub-second latency.
> 4. **Everyone's camera on (2026-07-27).** As a group **connection exercise**, participants activate their
>    cameras like a Zoom meeting — this is *mutual* video, not a one-way provider broadcast. → many-to-many
>    audio **and** video.
>
> **Consequence:** the HLS-broadcast path is off the table. You need a **WebRTC SFU** — the correct one is the
> one you already run, **LiveKit** (a Zoom-class SFU; mutual video is squarely in its wheelhouse). The question
> is no longer "which delivery model" but **"where do we host it, cleanly isolated, and at what group size."**
> Decision #4 uses a **two-knob video model** (Part 3.5): each viewer only renders/receives ~40 tiles
> (pagination — Zoom's model, so **room size is irrelevant to any device**), while the **number of simultaneous
> camera publishers** is the real infra/cost limit. Large camera rooms (e.g. ~300 all-on-camera, paginated) are
> possible but are a **large-meeting tier** (LiveKit Cloud egress cost, or a multi-node self-host) — which pushes
> cost toward **self-hosting**. Parts 3–5, 7 below are updated accordingly; earlier broadcast text is superseded.
**Method:** Grounded in the repo's actual deploy configs (`docker-compose.yml`, `deploy/`, `go2rtc/`,
`services/playlist-bot`) + three parallel live-web research passes (real-time audio, managed data/auth/storage,
hosting + nonprofit programs). Every external price/limit was cited with a source and date in the underlying
research; re-verify on vendor pages before committing spend.

---

## TL;DR — the four things that matter (revised for the locked decisions)

1. **Keep LiveKit — it is now the *correct* tool, not just an incumbent.** With a live sharing round + a
   low-latency requirement, WebRTC is exactly right, and you already have it integrated. You also keep the
   client-side crossfader and all existing session code. A single 16-core LiveKit node handles **~3,000 audio
   subscribers per room**, so 500 listeners + a handful of active speakers is comfortable — you are not
   node-bound at your target scale.
2. **The sharing round is a "promote-to-speaker" pattern, not 500 simultaneous publishers.** Listeners join
   muted (`canPublish:false`, as the current token route already does); when it's someone's turn, the provider
   grants publish rights to that one person (or a few). Bandwidth and CPU stay bounded because only 1–3 people
   ever publish at once. This is a standard LiveKit livestream pattern and an extension of code you already have.
3. **The migration is about isolation + zero-ops + global latency — which points to LiveKit Cloud** as the
   path of least resistance: it's nearly a **config-swap** (your code already speaks the LiveKit SDK), it fully
   isolates Beacon's load from your other sensitive services, and its **global edge network actually improves
   latency** for your Costa-Rica-plus-global audience versus a single self-hosted node. The alternative —
   self-hosted LiveKit on a *dedicated* cloud VM — is much cheaper at scale but single-region and you own
   ops/failover. (Full trade-off in Part 3.)
4. **Cost is manageable but video reshapes it.** Audio-only, LiveKit Cloud lands ≈**$170/mo** and simplicity
   wins. But **everyone-on-camera (Decision #4) is ~8–15× the bandwidth**, pushing Cloud toward **~$400–600+/mo**
   while a **self-hosted dedicated box with included bandwidth stays ~$30–95/mo** — so **camera-on
   sessions tilt the recommendation toward self-hosting** (still isolated from your sensitive infra, just
   cheaper). Using **Zoom's two-knob model**, each viewer only renders ~40 tiles (pagination), so **room size
   isn't a device limit** — but the number of *live camera publishers* is the cost/infra limit: ~40 runs on one
   node cheaply, while **~300 all-on-camera is a large-meeting tier** (Cloud egress ~$150–190/session, or a
   multi-node self-host; prefer camera slots). See Part 3.5.

---

## Part 1 — What you run today (grounded inventory)

Everything below lives on **one server (`inference-public`, single public IP `131.72.205.6`, AlterMundi infra,
Argentina)**, behind one host nginx, deployed by a GitHub Actions runner **on the same box**.

| # | Service | Role | Where | Scaling reality |
|---|---------|------|-------|-----------------|
| 1 | **Next.js 16 app** | UI + API + SSR | Docker `:3003→3000` | Stateless — trivial to move/replicate |
| 2 | **PostgreSQL 16** | All app data (Prisma) | Host, not containerized | Single instance, backups/PITR unclear |
| 3 | **LiveKit SFU** | Real-time WebRTC audio fan-out | `live.altermundi.net`, host `:7880` | **Fine at 500; SPOF; egress-bound** |
| 4 | **LiveKit Egress** | Per-track session recording | Host | CPU-heavy, competes with #3 |
| 5 | ~~**go2rtc**~~ **REMOVED** | was WebRTC meditation streaming | — | Deleted (commit `9512899`); meditation now HTTP range via `stream-file.ts`; compose is `app` + `playlist-bot` only |
| 6 | **Zitadel** | OIDC identity + roles | `auth.altermundi.net` | On critical path for paid access |
| 7 | **File storage** | meditations / uploads / recordings | Local RAID `/mnt/n8n-data` | **No CDN, no geo, shared with n8n** |
| 8 | **nginx** | TLS, reverse proxy, rate-limit | Host | Fine |
| 9 | **playlist-bot** | File → LiveKit audio ingest | Docker | Becomes the session mixer (see Part 3) |
| 10 | **CI/CD runner** | GitHub Actions self-hosted | **Same box as prod** | Should never share a box with prod |

### Three structural risks, independent of any headcount

- **Single point of failure / single uplink.** App, DB, SFU, auth, storage, *and CI* share one machine and one
  network path. Once sessions are **paid**, a mid-session outage or a saturated uplink means refunds and lost
  trust — a very different stakes level than a free beta.
- **Geography.** Origin in Argentina is roughly **~180–220 ms RTT from Costa Rica** (traffic hairpins through
  Miami). For a Costa-Rica-primary + global audience, that's the worst-positioned major option — audible in
  real-time audio, invisible once you put a northern CDN edge in front.
- **Noisy-neighbor storage.** Audio sits on a RAID volume shared with an unrelated n8n instance
  (`/mnt/n8n-data`), with no CDN and no signed-URL protection — bad for both reliability and the anti-piracy
  goal in the pivot.

---

## Part 2 — The reframe: it's not a "LiveKit won't scale" problem

The research is unambiguous: **a single self-hosted LiveKit node handles ~3,000 one-way audio subscribers**
(`c2-standard-16`; the audio-only case is 10 publishers + 3,000 subscribers at ~80% CPU **with a ~3 kbps test
stream** — the ~92% figure is the *video* livestream case, so real 128 kbps audio capacity is lower). Your
500-listener target — even doubled to
~1,000 *track* subscriptions because you currently send **two tracks** (voice + Beacon) for the client-side
crossfade — sits comfortably inside one box. LiveKit's multi-node/distributed mode (which requires Redis + a
signaling bridge) **spreads different *rooms* across nodes; it does not split one big room** — so it wouldn't
even help a single 500-person session. Distributed LiveKit is about running *many* rooms and getting failover,
not about a bigger single room.

So the genuine constraints are:

- **Downstream bandwidth cost.** SFU fan-out = bitrate × subscribers. At 128 kbps × 2 sources × 500 = 256
  kbps/listener ≈ **128 Mbps sustained, ~86 GB per 90-min session**; at 5,000 listeners, ~1.28 Gbps / ~860 GB.
  (If each source is 64 kbps, halve these.) *Where those bytes are
  served from* dominates cost far more than which SFU software you run.
- **Redundancy** — one node = one failure domain.
- **Geography** — see Part 1.

All three are better addressed by changing the *delivery model* and *where bytes egress from* than by scaling
the SFU.

---

## Part 3 — Decision resolved: keep WebRTC (LiveKit), migrate where it runs

> *Superseded:* an earlier version of this section recommended server-side-mix → HLS broadcast. The team's
> clarification (interactive sharing round + keep low latency) rules that out — HLS's 2–8 s latency and one-way
> nature can't carry a live sharing round. **WebRTC SFU it is, and LiveKit is the SFU you already run.**

### Why LiveKit is now the right call (not just the incumbent)

- **Two-way + low latency = WebRTC.** The sharing round needs listeners to publish audio in real time; that is
  precisely what an SFU does and precisely what CDN broadcast cannot.
- **You keep everything you built.** The client-side beacon/facilitator crossfader in
  `src/context/AudioContext.tsx`, the session token route, per-track egress recording, the file-publishing
  `services/playlist-bot` — all stay. No pipeline rewrite.
- **You are not node-bound at target scale.** 500 subscribers + 1–3 active speakers ≪ the ~3,000-subscriber
  single-node benchmark.

### Design the sharing round as "promote-to-speaker" (important)

Do **not** let 500 people publish at once — that's neither needed nor affordable. Pattern:

```
All listeners join with canPublish:false  (already how /api/scheduled-sessions/[id]/token works)
        │
Sharing round begins → provider (or a queue) promotes ONE listener at a time:
        │   grant publish via RoomServiceClient.updateParticipant({canPublishSources:['microphone']})
        │   or re-issue that user's token with canPublish:true
        ▼
Speaker shares → is demoted back to listener when done → next person promoted
```

- Only 1–3 publishers are ever live, so bandwidth/CPU stay flat regardless of audience size.
- **Build list (extends existing code):** a "raise hand" signal (LiveKit data channel), a provider moderation
  panel (promote / demote / mute / mute-all / force-mute on session end), and echo/feedback handling (ensure
  promoted speakers' clients use echo cancellation; auto-mute on demote). This is new product surface —
  moderation of 500 potential mics is a real feature, budget for it.
- Your `SessionInvite.canPublish` field and the `canPublish` plumbing in the token route are the seed of this;
  you're adding *dynamic* promotion on top of the current *static* grant.

### Where to run LiveKit — the actual decision now

| Option | Cost @ 500×8/mo | Latency for CR+global | Ops burden | Isolation from your other infra | Migration effort |
|--------|-----------------|-----------------------|------------|-------------------------------|------------------|
| **LiveKit Cloud** *(recommended)* | **~$170/mo** (Ship + overage), scales with use | **Best** — global edge, media served near each user; Cloud's distributed mesh also removes the single-room ceiling | **Lowest** — none | **Total** — vendor-run | **Lowest** — ~config swap: change `LIVEKIT_URL` + API key/secret; your code already uses `livekit-server-sdk` |
| **Self-hosted LiveKit on a dedicated cloud VM** (Hetzner/Fly/OVH) | **~$15–50/mo** flat (Hetzner EU incl. 20 TB egress) | Single-region — worse for a global audience unless you add TURN/edge | High — you own scaling, failover, upgrades, TURN | **Full** — separate box from your sensitive services | Low — move the LiveKit config/containers to the new box |
| Cloudflare Realtime (SFU) | ~$0–free tier | Best — global edge | High — it's infra, not an SDK; you build signaling/reconnection | Total | **High** — replace LiveKit integration |

**Recommendation: LiveKit Cloud.** It directly satisfies all three locked decisions at once — it gets Beacon
entirely **off your own infrastructure** (the stated goal), it is **near-zero migration** because your code
already speaks LiveKit, it **preserves and improves low latency** via a global edge (a real technical win for a
Costa-Rica + worldwide audience that a single self-hosted node cannot match), and at ~$170/mo it costs about a
third of one session's target revenue while scaling with actual usage. Ask their sales about
startup/nonprofit credits (a startup-credits program exists; no published nonprofit tier).

**Choose self-hosted-on-a-dedicated-VM instead only if** cost-at-scale or digital-sovereignty outweighs ops
burden and global latency — e.g. if you expect to grow far past 500/session and can staff the ops. It's the
cheaper-at-scale, more-sovereign, more-work option, and it still achieves the isolation goal (Beacon on its own
box, away from your sensitive services). Add **TURN (coturn)** and consider a second region if you go this way.

### Recording

Keep **LiveKit Egress** (you already use it). Track egress is ~$0.001/min (~$0.09 per 90-min session) on Cloud;
free as software if self-hosted. Archive the resulting files to Cloudflare R2 (Part 4).

---

## Part 3.5 — Video (everyone's camera on): latency is fine, *scale* is the wall

Decision #4 adds mutual video — everyone activates their camera as a group connection exercise, like Zoom.
Two things must be said plainly.

### Video does NOT hurt latency
WebRTC carries video in real time at the same sub-second latency as audio, and LiveKit does video natively.
Latency is simply **not the axis video threatens** — this *reinforces* the keep-LiveKit decision (you would
never carry mutual interactive video over HLS). What video costs you is **bandwidth, device capacity, and
money** — ~**8–15× the bitrate of audio**.

### The real constraint: two separate knobs (Zoom's model), not "small rooms only"
An earlier draft said "everyone-on-camera and hundreds can't coexist." That was too strong. The accurate
statement: **you can't *render* hundreds of tiles at once, but you CAN run a large room where everyone's camera
is on and each viewer paginates through a subset — that's exactly what Zoom does.** Separate the two knobs:

1. **Tiles rendered per screen (client-side) — decided ≈ 40.** Pagination + active-speaker spotlight +
   selective subscription mean each client only *receives and decodes* ~40 streams regardless of room size.
   Self-view is local; simulcast sends each tile at a size matching its render; **Dynacast** stops forwarding
   layers nobody is viewing. This makes **room size irrelevant to any individual device** — the "how does Zoom
   show a 500-person call" answer.
2. **Simultaneous camera publishers (server-side) — the infra/cost limit.** This is what ingest + forwarding
   capacity and the bill actually scale with, and it's independent of what any screen shows.

| Session size | Feasible? | What it takes |
|--------------|-----------|---------------|
| **Circle ≤ ~40 on camera** | ✅ easily | Single self-hosted node; everyone fits one page (no paging). Cheapest. |
| **~300 all on camera, paginated** | ✅ yes (Zoom-style) | Ingest ~450 Mbps + forwarding is a **large-meeting tier**. ⚠️ **This is ONE room, so it must fit on a single high-capacity node — a multi-node cluster does NOT split one room.** Options: **LiveKit Cloud** (its distributed mesh does handle big single rooms; ~$150–190/session egress) **or** a **single, load-tested, high-network node + a hot standby** (not a cluster). Strongly prefer **publish-when-visible/speaking (camera slots)** to cut both cost and node load. |
| **Rendering 300 tiles at once on one screen** | ❌ impossible | No device decodes that; not a goal — pagination handles it. |

**Recommendation:** build the **pagination/selective-subscription rendering (knob #1, ≈40 tiles)** regardless —
it's the Zoom mechanism and makes the viewer side scale to any room. Set the **publisher count (knob #2)** by
the infra you commit to: ≤~40–50 publishers runs cheaply on one node; **~300 all-on-camera is a real
large-meeting tier** (Cloud egress cost or a multi-node self-host) — and at that size prefer **camera slots /
publish-on-demand** since nobody can watch 300 faces anyway. This is a deliberate cost/UX decision, not a hard
wall (see Doc 3 §11 Q7). It also means the **scale assumption is now: room size is bounded by the publisher
budget you choose, not by the screen.**

### Bandwidth & the cost tilt (why video favors self-hosting)
Even a **50-person all-camera circle** ≈ 50 clients × ~7 Mbps ≈ **~350 Mbps**, ≈ **~240 GB per 90-min session**
— the same order as a provider-video broadcast, but now *inherent to the format*. Consequence for hosting:

- **LiveKit Cloud** meters data at ~$0.10–0.12/GB, so video egress is a real line item — a camera-on session can
  cost **10–20× an audio-only one**, and monthly cost climbs from ~$170 toward **~$400–600+** depending on
  volume.
- **Self-hosted LiveKit on a dedicated VM with included bandwidth (Hetzner EU, 20 TB)** absorbs that egress at
  **~$0**. → **The everyone-on-camera requirement materially shifts the recommendation toward
  self-hosted-on-a-dedicated-box** for video-heavy usage, where before (audio-only) LiveKit Cloud won on
  simplicity. See revised Part 5.

### Making it work well (build/ops notes)
- **Simulcast** (on by default in LiveKit): each camera publishes multiple resolution layers; the SFU sends the
  right layer per subscriber — essential for mixed desktop/mobile.
- **Adaptive stream + selective/paginated subscription:** clients subscribe only to on-screen tiles; pause
  off-screen. Cap the visible grid (e.g., 25) with pagination + an active-speaker spotlight.
- **Audio-only toggle** for participants on weak connections/data plans.
- **coturn (TURN)** becomes more important with video if self-hosting (more clients behind restrictive NATs).

---

## Part 4 — Component-by-component recommendations

| Component | Today | Recommended | Why |
|-----------|-------|-------------|-----|
| **Session audio (WebRTC SFU)** | Self-host LiveKit on shared box | **LiveKit Cloud** (near config-swap, global edge, zero-ops). Cheaper-at-scale alt: **self-hosted LiveKit on a dedicated VM + coturn** | Interactive sharing round + low latency require an SFU; Cloud gets it off your infra and improves global latency (see Part 3) |
| **Compute (Next.js app)** | One AlterMundi box | **Fly.io** (managed, can also host companion Node/ffmpeg processes) or a **dedicated Hetzner/VPS** separate from your sensitive infra | Goal is isolation off the shared box; avoid Vercel/Netlify only if you still self-host media — with LiveKit Cloud carrying media, Vercel becomes viable for the app alone (mind egress) |
| **Database** | Host Postgres 16 | **Neon (Launch)** — scale-to-zero, ~$0–15/mo, pooled endpoint for Prisma; or **DigitalOcean Managed PG ($15/mo)** for a flat, predictable bill w/ included PITR | Managed backups/PITR + pooling matter now that data is paid-user data; migration is a trivial `pg_dump`/restore |
| **Auth** | Self-host Zitadel | **Stay on Zitadel.** Only if self-host ops feels too risky post-payments → **Zitadel Cloud ($100/mo)** | You already run exactly what you need (OIDC + ADMIN/PROVIDER/LISTENER + social) at $0; every alternative is a *second* painful migration to land roughly where you are. **Do not go back to Supabase Auth.** |
| **Object storage + CDN** | Local RAID (shared) | **Cloudflare R2 (zero egress) + a Worker for signed/expiring URLs.** Close 2nd: **Backblaze B2 + Bunny.net** (best turnkey token-auth) | Egress dominates audio economics; R2's $0 egress makes it disappear. Signed URLs deliver the pivot's anti-piracy goal. Gets audio off the n8n disk. |
| **Recording** | LiveKit Egress | **Record the server-side mix to disk (ffmpeg/Liquidsoap)** → archive to R2 | It's the canonical program feed, effectively free, no compositing job |
| **CDN / static assets** | nginx from origin | **Cloudflare Free in front of the app** (330+ PoPs, $0, DDoS/SSL) — but route bulk *audio* via Bunny/R2, not free Cloudflare (their terms forbid disproportionate media on the free CDN) | Serves the app close to global users while the Argentine origin stays the control plane |
| **CI/CD** | Runner on the prod box | **Move the runner off the prod machine** (GitHub-hosted, or a separate cheap VM) | A build should never be able to starve or crash production |

---

## Part 5 — Cost model (recommended architecture)

Assumptions: 500 concurrent listeners, 90-min sessions, ~8 sessions/month, interactive (WebRTC), ~1–3 active
speakers at a time during the sharing round.

### Recommended: LiveKit Cloud (zero-ops, off your infra)

| Line item | Recommended | Est. monthly |
|-----------|-------------|--------------|
| Session audio (WebRTC SFU) | **LiveKit Cloud** (Ship $50 + participant-min & data overage) | **~$170** |
| Recording | LiveKit Egress (track, ~$0.09/session) | ~$1 |
| Compute (Next.js app) | Fly.io / dedicated small VM | ~$10–25 |
| Database | Neon Launch (scale-to-zero) | ~$0–15 |
| Auth | Zitadel (self-host on the app VM, or Zitadel Cloud $100) | $0 (or $100) |
| Object storage | Cloudflare R2 (zero egress) + signed URLs | ~$1 |
| **Total** | | **~$185–210/mo** |

### Cheaper-at-scale alt: self-hosted LiveKit on a dedicated VM

| Line item | Recommended | Est. monthly |
|-----------|-------------|--------------|
| Session audio (WebRTC SFU) | Self-hosted LiveKit + coturn on **Hetzner EU** (20 TB egress incl.) | ~$15–50 |
| Everything else (app, DB, auth, storage, recording) | as above | ~$12–45 |
| **Total** | | **~$30–95/mo** |

**Reading the two:** LiveKit Cloud costs more (~$185–210/mo) but buys zero ops, a global low-latency edge, and
a one-day migration — ~40% of a *single* session's ~$500 target revenue, and it grows only with usage.
Self-hosted-dedicated is roughly half to a third the cost and more sovereign, but you own scaling, failover,
TURN, and upgrades, from a single region.

### Video changes this — the everyone-on-camera surcharge

The figures above are **audio-only**. With Decision #4 (mutual camera-on, Part 3.5), video egress dominates:

| Scenario | LiveKit Cloud (metered egress) | Self-hosted (incl. bandwidth) |
|----------|-------------------------------|------------------------------------------|
| Audio-only session | baseline (~$170/mo total) | ~$30–95/mo total |
| **~40-camera circle (~240 GB/session)** | **~$400–600+/mo** (data $0.10–0.12/GB) | **~$30–95/mo** (single node; egress ~$0 on 20 TB) |
| **~300 all-on-camera, paginated (~1.5 TB/session)** | **~$150–190/session in data** (four-figure/mo) | bandwidth ~$0 but the room must fit **one high-capacity node + a hot standby** (NOT a cluster — one room can't span nodes) |

**So video flips the hosting recommendation.** For an audio-only product, LiveKit Cloud's simplicity won. Once
**camera-on is standard**, self-hosted LiveKit on a box with included bandwidth is **several times cheaper**, and
the gap widens with room size. Revised guidance:

- **Small camera circles (≤~40):** either works; LiveKit Cloud is simplest, self-hosted-single-node is cheapest.
- **Large camera rooms (~300 all-on-camera):** a real large-meeting tier. **Self-hosted = one high-capacity
  node + a hot standby** (cheap bandwidth, real ops — *not* a cluster; one room can't span nodes) or **LiveKit
  Cloud** (its mesh handles big single rooms, heavy egress bill). At this size, **strongly prefer camera slots /
  publish-when-visible** (Doc 3 §11 Q7) to cut both — nobody watches 300 faces at once.
- Either way it still satisfies "off our own infra / isolated." Pragmatic path: launch on Cloud, migrate to
  self-hosted as camera usage/room-size grows (same software, low-friction).

Reframe from Part 3.5: **room size is bounded by the *publisher* budget you choose, not by the screen** (each
viewer only renders ~40 tiles). Bandwidth — driven by live publishers and what's actually viewed — decides the
bill.

---

## Part 6 — Nonprofit credits & grants (the funding lever)

Given the funding crisis, this may matter as much as the architecture. AlterMundi is an Argentine *asociación
civil / fundación*, not a US 501(c)(3) — most programs accept "international equivalents" but gate on
validation.

**Highest-leverage single prep step: get AlterMundi validated once via TechSoup Argentina / Wingu *and*
Goodstack.** That one action unlocks AWS, Microsoft, Google, Twilio, and more. Have IGJ/DPPJ registration docs
ready.
**⚠️ Framing caution:** Microsoft explicitly excludes "telecommunications/utilities" — present the mission as
**digital inclusion / community benefit / education**, not as a telecom/ISP operator.

**Tier 1 — apply now (internationally open, free, strong fit):**
- **Cloudflare Project Galileo** — free Business-tier CDN/WAF/DDoS/Zero-Trust, ongoing, textbook fit for a
  community-networks nonprofit. *This directly serves your app + assets for $0.*
- **Google for Nonprofits + Ad Grants** — **$10,000/month in-kind Google Search ads (~$120k/yr)**. This is a
  *marketing* windfall — exactly what you need to fill paid sessions — plus some GCP credit.
- **Twilio.org Impact Access** — comms-relevant credit + ongoing discounts.
- **Fastly Fast Forward** — free CDN/edge via the OSS track (great fit given LibreMesh/LibreRouter heritage).

**Tier 2 — likely eligible, real value:** Microsoft for Nonprofits ($2,000/yr Azure), AWS Nonprofit Credit
Program ($2,000/yr via TechSoup), DigitalOcean for Nonprofits ($2,500 one-time), GitHub for Nonprofits (free
Team).

**Cash grants that fit the mission ideologically (money, not credits):** **LACNIC FRIDA** (~$10k–40k, community
networks), **ISOC Foundation Community-Centered Connectivity** (up to $200k), **NLnet/NGI Zero** (up to €50k,
OSS). These are a strong match for a community-networks org and worth a dedicated application effort.

---

## Part 7 — Suggested migration roadmap

Sequenced so nothing blocks the near-term paid-sessions launch, and so each step is independently valuable.

**Phase 0 — De-risk the current box (days, do regardless of everything else)**
- Move the CI runner off the prod machine. Verify Postgres backups actually restore. Put **Cloudflare Free** in
  front of the app for TLS/DDoS/static-asset edge. Start the **TechSoup/Wingu + Goodstack** validation and file
  the Tier-1 credit applications (they take time to approve).

**Phase 1 — Get LiveKit off your infra (the core move)**
- Provision **LiveKit Cloud**, point the app at it (change `LIVEKIT_URL` + API key/secret; your
  `livekit-server-sdk` code and egress calls work unchanged). This alone removes Beacon's real-time load from
  the shared box — the stated goal — with near-zero code change, and improves global latency. Keep the
  spatialized-file publisher (`services/playlist-bot`) publishing the Beacon track into the session room as
  originally designed (pivot WS3), now against Cloud.
- Then build the **sharing-round "promote-to-speaker"** feature (Part 3): raise-hand signal, provider
  moderation panel, dynamic `canPublish` promotion/demotion, mute-all. This is the main new dev effort.

**Phase 2 — Offload the rest of the stateful stack off your infra**
- Move the **Next.js app** to Fly.io or a dedicated VM (separate from your sensitive services). Migrate audio
  files to **Cloudflare R2 + signed URLs** (delivers the pivot's anti-piracy requirement and gets audio off the
  shared n8n disk). Migrate Postgres to **Neon** (or DO Managed PG).

**Phase 3 — Harden & decide auth**
- Auth may change entirely (see the auth-simplification analysis — moving off mandatory-MFA Zitadel). Whatever
  the choice, harden it now that it guards payments (tested restore, monitoring, patching), or lift to a managed
  provider. **Already done since the first draft:** health/readiness probes exist, PII-log redaction, a
  `LICENSE`, data export/deletion, an audit log. **Still to do before public paid launch:** metrics/tracing
  (only health probes exist today), privacy policy / terms / refund policy, and an object-storage driver so
  account deletion can actually purge audio.

---

## Part 8 — Honest uncertainties

- Cost math assumes ~64–128 kbps audio; a higher-bitrate **spatialized** Beacon scales bandwidth (and any
  per-GB cost) proportionally. Per-viewer-hour models (IVS) are bitrate-independent.
- Nonprofit "international equivalent" eligibility is policy-accepted but **auto-approval for Argentina is not
  guaranteed on any vendor page** — expect manual review, and mind the telecom-exclusion framing risk.
- Some vendor figures came from aggregators, not the vendor's own live page (flagged in the underlying
  research) — reconfirm on official pricing pages before committing budget.
- The **broadcast-vs-interactive** question is now *resolved* (interactive, keep low latency → WebRTC/LiveKit).
  The remaining open trade-off is **LiveKit Cloud vs self-hosted-dedicated** — cost-at-scale and sovereignty vs
  ops burden and global latency. Start on Cloud; the migration back to self-hosting is itself low-friction
  (same software) if cost ever forces it.
- **Moderation of up to 500 potential microphones** is genuinely new product surface (raise-hand queue,
  promote/demote, mute-all, echo handling, abuse control). Don't under-scope it — it's the main net-new
  engineering the interactive requirement introduces.
- LiveKit Cloud's exact bill depends on how participant-minutes are counted for muted subscribers and on your
  real audio bitrate; reconfirm against a Cloud quote before committing. A dedicated self-hosted node's ceiling
  (~3,000 subscribers / single room) is a benchmark, not a guarantee — load-test before relying on it.
- **Video caps and costs are order-of-magnitude estimates.** The everyone-on-camera group-size ceiling
  (~25–50) and the ~240 GB/session figure depend on chosen resolution/bitrate, simulcast layers, and how many
  tiles you render; validate with a real LiveKit load test at your target circle size before committing to a
  cap or a host. The **open product decision** — the exact max group size for camera-on "connection circle"
  sessions — drives both the UX and the hosting choice and should be settled explicitly.
```
