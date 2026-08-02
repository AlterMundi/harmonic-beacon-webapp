# Harmonic Beacon weekend MVP roadmap

**Target:** first paid events on Saturday 2026-08-08 (two sessions)

**Planning baseline:** `main` at `faf5f13d06aff9c47c133818095f32c8153e0086`

**Final event order:** Session 1: Spanish 8:30 AM Costa Rica (14:30 UTC), Session 2: English 2:00 PM Costa Rica (20:00 UTC), both Saturday 2026-08-08.

**Delivery envelope:** 15.0 person-days, assuming four engineering-capable assignees working in parallel plus an ops/commercial owner.

The decisions in the 2026-07-28 brief override the older planning corpus. In particular, this roadmap does not migrate existing data, preserve the existing consumer product, use Zitadel, enable recording, build payments, or move the already-provisioned infrastructure elsewhere.

## 1. Product surface definition

### What exists at the end of the week

The deployed product has four surfaces and no general-purpose account area:

| Surface | Route | Users | Launch behavior |
|---|---|---|---|
| Public landing and ticket login | `/` | Anyone | Bilingual EN/ES page with the two event times, $50/$20 purchase links, terms/refund links, and a code + email form. It never exposes a room token. |
| Paid session room | `/session/[id]` | Entitled attendee or staff | Joins the stage and beacon-bed LiveKit rooms, renders the six-person stage, provides the Beacon/Voice crossfader, audio-only fallback, hand raise, and optional tapestry camera contribution. |
| Staff login | `/staff/login` | Julián, two operators, one admin | Seeded per-person credentials; no Zitadel/OIDC, public signup, password reset, or listener account. |
| Operator controls | `/ops/events/[id]` (`/ops/session/[id]` redirects), `/ops/admission` | Facilitator/operator/admin according to role | Unified event entry, hand queue, promote/demote/mute, participant and service health, ticket lookup, revoke, rebind, and comp/override issuance. |

Only two `ScheduledSession` rows are seeded. They have language, start time, `paidMode=true`, attendee cap `150` including comps, and `maxPublishers=6`. This is a psychodrama scene: `maxPublishers` includes facilitator Julián, leaving at most five rotating slots for the protagonist, director, and auxiliaries. The app does not offer event creation, meditation, playback, profile, provider library, admin moderation, recording, voucher, plan, billing, or in-app purchase surfaces.

### Admission and identity contract

- A ticket is a high-entropy unique code attached to exactly one scheduled session and price tier. The app stores an HMAC digest and last four characters, not the plaintext code.
- First successful use atomically binds the ticket to `trim(email).toLowerCase()`. Later use succeeds only for the same normalized email, including after refresh, browser restart, or a dropped connection.
- Success issues an opaque random `hb_session` cookie. Only its digest is stored. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `/`, and expires after the weekend plus a short support window.
- Every request resolves the session against the database and the current ticket status. Revoking a ticket therefore invalidates an existing cookie as well as new logins.
- Staff use the same opaque-session mechanism but authenticate at `/staff/login` with individually seeded strong credentials. Passwords use Node's `scrypt` with per-user salt; no plaintext credential is committed or placed in Compose.
- Login errors do not reveal whether a code or email exists. The endpoint is rate-limited at the app/reverse-proxy boundary. Logs contain ticket IDs/last-four and staff IDs, never codes, credentials, or attendee emails.
- `ADMIN` and `FACILITATOR_OP` may issue/revoke/rebind tickets. `OPERATOR` may revoke and issue a documented support override but cannot create staff. Every staff role may operate the stage within its event scope; only an assigned `FACILITATOR` or `FACILITATOR_OP` starts with publish permission. [The capability matrix](../../BUSINESS_RULES.md#11-capability-matrix) is authoritative.

### Media contract

For the weekend, retain the current, proven two-room crossfader topology:

1. The event stage room carries Julián and up to five promoted participants plus the subscribe-only audience.
2. The existing `beacon` room carries the playlist/live Beacon audio bed through `services/playlist-bot`.

`src/context/AudioContext.tsx` becomes event-scoped rather than globally mounted. It connects to the bed only from the paid room. Both `/api/scheduled-sessions/[id]/token` and the event-scoped `/api/livekit/token?sessionId=...` perform the same paid entitlement check. The extra connection is an intentional weekend trade: it preserves the differentiating crossfader without building and rehearsing a new per-room audio publisher. At 150 attendees it adds audio-only connections, not another 4.7 Mbps video fan-out.

The stage publishes simulcast. The active speaker/Julián tile requests the 720p layer; at most five auxiliary tiles request 360p. An attendee can turn video reception off without leaving or losing either audio source. Audience cameras never publish to LiveKit. A promoted participant must explicitly enable microphone/camera after the grant.

All publish permission originates server-side. A serialized database reservation limits active stage grants to six; the token route and live LiveKit grant update use that state. Reconnects retain the same stable stage identity and current grant. Demotion revokes the LiveKit grant and forcibly mutes/unpublishes the participant.

### Thumbnail tapestry contract

The target v1 is public to attendees, but it is not on the critical path and has a pre-approved staff-only cut:

- After an explicit user gesture and browser camera permission, the client produces a 100 px JPEG every 2.5 seconds and POSTs it through an entitlement-gated app endpoint.
- A separate in-memory `services/tapestry` process retains one latest frame per opaque participant identity, removes frames after 10 seconds, and produces one composite JPEG per session. It never writes raw frames to disk.
- The public composite endpoint has a two-second shared-cache TTL and no attendee identity or email. Cloudflare caches only that endpoint. In staff-only mode, the same image is returned through an authenticated operator route and is not publicly cached.
- Ticket terms disclose the thumbnail snapshots. Camera permission remains explicit; declining it never prevents event admission.

### Persistence and deployment choice

Use a fresh PostgreSQL container, not SQLite. The repository already uses Prisma 7, `@prisma/adapter-pg`, `pg`, migrations, and PostgreSQL transactions. Atomic first-use binding and concurrent publisher reservations need one reliable shared writer. SQLite would add a driver/schema/deployment change and single-file lock/backup behavior for no useful weekend reduction.

The fresh database lives at `/mnt/beacon-data/postgres`; there is no migration of users, meditations, vouchers, recordings, or old sessions. Compose on `mona` runs the app, Postgres, LiveKit, playlist bot, and—until cut—the tapestry service. Nginx terminates TLS for `live.harmonicbeacon.com`; LiveKit signaling is proxied over WSS and media/TURN use the already opened ports. Egress/recording is absent.

### Launch definition of done

The MVP is done only when:

- a real paid ticket reaches the Argentine nonprofit rail and a real refund and bank payout have been verified;
- an unentitled direct call to either LiveKit token route is denied;
- the same ticket/email can join, refresh, disconnect, and rejoin, while a different email and a revoked ticket cannot;
- six simultaneous publishers work and two concurrent seventh promotions cannot create a seventh grant;
- 150 subscribers receive the planned stage layers and both audio sources during a 20-minute soak;
- an attendee can switch to audio-only and continue hearing Beacon plus voice;
- the bot, provider, network, app, and fallback/refund failure paths have been rehearsed without developer assistance;
- production is frozen under the policy in Section 4.

## 2. Workstreams

| Workstream | Outcome | Likely owner profile | Effort |
|---|---|---|---:|
| WS1 — Auth and entitlement | Fresh ticket/staff identity, reconnect-safe sessions, admission support | Backend/full-stack | 3.0 pd |
| WS2 — Paid session room | Strict token gates, preserved crossfader, six-person video stage, audio-only mode | LiveKit/frontend | 3.0 pd |
| WS3 — Spotlight and hand queue | Race-safe six-publisher control and usable operator console | Backend + full-stack | 2.5 pd |
| WS4 — Thumbnail tapestry | Bounded ingest/composite service and optional public presence view | Service/frontend | 1.5 pd |
| WS5 — Deploy, reliability, and event ops | Mona Compose/TLS/TURN, health view, runbook, load test, rehearsal, freeze | Infra + tech ops | 3.5 pd |
| WS6 — Commercial and human launch actions | Proven payout rail, configured tickets/policies, DNS/secrets/staff/fallback | Ops/human | 1.5 pd |
| **Total** | | | **15.0 pd** |

## 3. Kanban cards

Cards are ordered within each workstream. A dependency means the upstream card's interface and tests must be merged before final integration; independent implementation may start earlier against the contract in Section 1.

### WS1 — Auth and entitlement

#### WS1-01 — Freeze the fresh weekend data and session-auth contract

- **Workstream:** WS1 — Auth and entitlement
- **Effort:** 1.0 person-day
- **Scope:** Simplify `prisma/schema.prisma`; create `prisma/migrations/<timestamp>_weekend_mvp/migration.sql`; reduce `prisma/seed.ts`; retain `src/lib/db.ts`; create `src/lib/session-auth.ts`, `src/lib/ticket-code.ts`, and their tests. Keep `ScheduledSession` for the existing room/routes, reduce `User` to seeded staff, and add minimal `TicketEntitlement`, `WebSession`, and event-participant/grant fields. Seed exactly two sessions and four staff records from environment-supplied credential digests. Define `TICKET_CODE_PEPPER`, cookie TTL, language, tier, attendee cap, `maxPublishers=6`, hand timestamp, grant timestamp, and revoke/audit fields. This is a fresh schema; write no data migration or compatibility layer.
- **Dependencies:** None
- **Acceptance criteria:**
  - `prisma validate`, `prisma generate`, and a migration against an empty Postgres database succeed.
  - Schema constraints make ticket code digests unique, staff emails unique, and participant identity unique within an event.
  - A unit test proves opaque session tokens and ticket codes are stored only as digests and use constant-time comparison where applicable.
  - Seed fails closed if staff credential material or either event definition is missing, and never logs a plaintext password/code.
  - The event defaults and database constraint/migration pin `maxPublishers` to six for the weekend rather than accepting a client-provided value.
- **Risk notes:** Ani's strip and this schema touch the same high-conflict files; merge this contract first and have both efforts converge on it. Do not preserve `zitadelId` merely for compatibility—there is no data migration.

#### WS1-02 — Build ticket-code and staff login with reconnect-safe cookies

- **Workstream:** WS1 — Auth and entitlement
- **Effort:** 1.0 person-day
- **Scope:** Replace the current Zitadel redirect in `src/app/login/page.tsx` and `src/app/login/LoginClient.tsx`; create `src/app/api/auth/ticket/route.ts`, `src/app/api/auth/staff/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/staff/login/page.tsx`, and auth route tests; update `src/app/page.tsx`, `src/app/layout.tsx`, `middleware.ts`, `src/lib/auth.ts`, and `src/auth.ts` as the strip requires. The authoritative API helper must query `WebSession` and the current entitlement/staff status; middleware may optimize navigation but must not be the authorization boundary. First redemption uses a transaction and conditional update to bind the normalized email and create the cookie.
- **Dependencies:** WS1-01
- **Acceptance criteria:**
  - First valid code + email binds once and returns the secure `hb_session` cookie; refresh and a second login with the same normalized email succeed.
  - Two concurrent first-use requests with different emails produce exactly one winner. The loser receives the same generic error as a nonexistent code.
  - Wrong email, expired/revoked ticket, expired session, disabled staff user, and direct protected-route access are denied.
  - Revoking the entitlement makes an already issued cookie fail on its next protected API request.
  - Twenty failed attempts from one trusted-proxy client address inside ten minutes produce `429`; success and failure logs contain no code or email.
  - Four separately seeded staff credentials resolve to the intended `FACILITATOR`, `OPERATOR`, `OPERATOR`, and `ADMIN` roles.
- **Risk notes:** A process-local limiter is acceptable only because launch has one app instance; Nginx/Cloudflare must provide the outer limit. Do not add email delivery, magic links, NextAuth adapters, passwords for attendees, MFA, or account recovery.

#### WS1-03 — Add ticket batch/import and operator admission overrides

- **Workstream:** WS1 — Auth and entitlement
- **Effort:** 1.0 person-day
- **Scope:** Create `scripts/weekend-tickets.ts`; create `src/app/ops/admission/page.tsx`, `src/app/api/ops/admission/route.ts`, `src/app/api/ops/admission/[id]/route.ts`, and tests. Support batch generation/import per event/tier, one-time CSV output for the ticket platform, lookup by normalized email/last four/entitlement ID, revoke, clear/rebind with a required reason, and comp/override issuance. Reuse or reduce `src/lib/audit.ts` so each mutation records actor, action, target, time, and non-PII reason metadata.
- **Dependencies:** WS1-01
- **Acceptance criteria:**
  - Generating 150 codes yields 150 unique high-entropy values; rerunning an import is idempotent and does not duplicate entitlements.
  - Batch import/generation and comp issuance reject any operation that would take paid plus comp entitlements above the event's 150-attendee cap.
  - Plaintext codes appear only in the one-time operator export, never in database rows or application logs.
  - Revocation blocks token issuance immediately. Rebind requires `ADMIN` or the documented `OPERATOR` support permission and preserves an audit record.
  - A comp/override code is scoped to one event, expires after that event, cannot grant publish permission, and consumes one of that event's 150 attendee slots.
  - Role tests prove an attendee cannot load or mutate admission data and a facilitator cannot silently rebind a ticket.
- **Risk notes:** Confirm Ticket Tailor's actual unique-code import/email format in WS6-01 before locking the CSV columns. Keep a paper/offline mapping under ops control for admission support; do not commit ticket exports.

### WS2 — Paid session room

#### WS2-01 — Entitlement-gate both room tokens and preserve the crossfader

- **Workstream:** WS2 — Paid session room
- **Effort:** 1.5 person-days
- **Scope:** Rewrite the relevant auth in `src/app/api/scheduled-sessions/[id]/token/route.ts` and `src/app/api/livekit/token/route.ts`; extend `src/lib/livekit-server.ts`; adapt `src/context/AudioContext.tsx`; move its mounting out of the global `src/app/layout.tsx` and into the event room; update route/helper tests. The stage token uses a stable opaque event identity and current grant; the bed token takes `sessionId`, validates the same principal, and uses a non-PII bed identity. Both are subscribe-only for attendees unless a current stage grant exists. Remove recording state/actions from `src/app/session/[id]/page.tsx` and `src/app/provider/sessions/[id]/page.tsx`; recording routes must return a disabled/not-found response and no egress service is deployed.
- **Dependencies:** WS1-01
- **Acceptance criteria:**
  - No cookie, wrong-event ticket, revoked ticket, ended/cancelled event, or arbitrary authenticated staff role can obtain an attendee token.
  - A valid attendee receives subscribe-only tokens for exactly their event stage and the configured `beacon` bed room; neither token embeds email or ticket code.
  - An assigned facilitator (`FACILITATOR` or `FACILITATOR_OP`) may enter a scheduled room for preflight and receives microphone/camera sources; all staff remain subscribe-only in events where they are not the assigned facilitator unless explicitly promoted.
  - Refresh preserves the attendee's stage identity and active grant. Opening a second device has a documented "new connection replaces old" result rather than creating a new floor identity.
  - With the bot publishing in `beacon`, the UI independently changes bed and stage-voice gain through the existing crossfader.
  - Direct tests cover the launch blocker: a live paid event never issues either token without an active entitlement/staff authorization.
- **Risk notes:** The two-room topology means roughly two LiveKit connections per attendee. That is acceptable at the 150 cap and avoids a new audio publisher, but the load rehearsal must include both. Do not accidentally let the globally mounted `AudioProvider` request bed tokens on the landing page.

#### WS2-02 — Render the six-person simulcast stage with audio-only degradation

- **Workstream:** WS2 — Paid session room
- **Effort:** 1.5 person-days
- **Scope:** Refactor `src/app/session/[id]/page.tsx`; create `src/components/session/StageLayout.tsx`, `src/components/session/StageTile.tsx`, and focused tests. Handle remote video tracks, active-speaker changes, permission changes, camera/mic toggles, connection quality, and disconnect/rejoin while retaining the existing terminal-state behavior. Configure adaptive stream and publisher simulcast. Render one 720p spotlight and no more than five 360p auxiliaries. Add an explicit audio-only control that unsubscribes video but leaves stage audio and the bed connection running.
- **Dependencies:** WS2-01
- **Acceptance criteria:**
  - With Julián and five auxiliaries publishing, every audience client renders exactly one spotlight at the 720p-sized layout and at most five 360p-sized tiles; non-publishers never create tiles.
  - Active-speaker change moves the speaker to the spotlight without duplicating or leaking video elements.
  - A newly promoted attendee sees "Your turn—enable camera and mic"; neither device is enabled without a gesture. Demotion stops/unpublishes both within two seconds.
  - Audio-only mode stops all video subscriptions and rendering while both crossfader sources remain audible and reconnect still works.
  - A representative iPhone Safari, Android Chrome, and laptop complete join, permission, promotion, demotion, background/foreground, and reconnect checks.
- **Risk notes:** The current room page has only hand-built audio attachment. Avoid adding a large component framework during the freeze window unless evaluated on Tuesday. Mobile should prefer the spotlight plus a small auxiliary strip, not six equal decoders.

### WS3 — Spotlight console and hand queue

#### WS3-01 — Enforce the six-publisher cap and live grant lifecycle

- **Workstream:** WS3 — Spotlight and hand queue
- **Effort:** 1.5 person-days
- **Scope:** Create `src/lib/stage-control.ts`, `src/app/api/ops/sessions/[id]/participants/route.ts`, `src/app/api/ops/sessions/[id]/stage/route.ts`, and tests; extend the WS1 data model only through its agreed grant fields. Implement promote, demote, mute, and reconcile using `getRoomService().updateParticipant`/track mute. Serialize reservations on the session row (or a Postgres advisory lock), count Julián, cap at six, and compensate/reconcile if LiveKit changes fail after the database reservation. The stage token route reads the same durable grant.
- **Dependencies:** WS1-01, WS2-01
- **Acceptance criteria:**
  - Julián occupies grant one. Five further promotions succeed; a sixth attendee promotion receives `409 stage_full`.
  - A concurrency test sends two promotion requests for the last slot and proves only one grant becomes active and LiveKit never receives a seventh positive publish update.
  - Promote grants only microphone and camera; demote immediately revokes permission, force-mutes existing tracks, and clears the durable grant.
  - A promoted attendee who refreshes receives the same grant; a demoted attendee cannot regain it with an old browser state or direct token call.
  - Reconcile makes database grants and connected LiveKit permissions agree after a simulated LiveKit API failure or operator page reload.
  - Only staff with event-operation capability can mutate grants; `FACILITATOR` is assignment-scoped while `FACILITATOR_OP`, `OPERATOR`, and `ADMIN` operate globally. Every mutation is audited without email/code.
- **Risk notes:** Database and LiveKit are not one transaction. Make the database the authority, compensate on failure, surface "reconcile needed" to the operator, and never relax the cap as an error fallback.

#### WS3-02 — Ship the hand queue and spotlight operator console

- **Workstream:** WS3 — Spotlight and hand queue
- **Effort:** 1.0 person-day
- **Scope:** Create `src/app/api/scheduled-sessions/[id]/hand/route.ts`, `src/app/ops/session/[id]/page.tsx`, `src/components/session/HandRaiseButton.tsx`, `src/components/ops/SpotlightConsole.tsx`, and tests. Use a database-backed `raisedAt` queue with two-second polling for the weekend—no new websocket/data-channel protocol. Show connected/left state, current stage grant, queue age, media state, and connection quality. Provide give floor, take floor, mute, lower/remove hand, and reconcile actions.
- **Dependencies:** WS3-01
- **Acceptance criteria:**
  - An entitled attendee can raise/lower one hand for their event; repeated raises are idempotent and cannot move them ahead without first lowering.
  - The console orders hands by original `raisedAt`, survives refresh, and reflects joins/leaves and grant changes within four seconds.
  - Give/take floor invokes WS3-01 and exposes `stage_full`, LiveKit failure, and reconciliation states clearly enough for an operator to act.
  - Julián and both operators can use the console concurrently without duplicate promotions; attendee and unrelated staff access is denied.
  - The full raise → promote → explicit mic/camera enable → demote interaction completes without reconnect.
- **Risk notes:** Polling is intentionally less elegant and more recoverable than transient LiveKit data messages. Do not add chat, auto-advance, reactions, or audience moderation beyond the queue.

### WS4 — Thumbnail tapestry

#### WS4-01 — Build the bounded in-memory tapestry service

- **Workstream:** WS4 — Thumbnail tapestry
- **Effort:** 1.0 person-day
- **Scope:** Create `services/tapestry/package.json`, lockfile, `tsconfig.json`, `Dockerfile`, `src/index.ts`, and service tests. Expose internal authenticated ingest, composite JPEG, and `/health` endpoints. Accept only JPEG, at most 20 KB, target 100 px, keyed by opaque session/participant IDs supplied by the app. Replace the prior frame, expire at ten seconds, cap entries at 150 per seeded session, and composite at most once per second using `sharp`. Keep all bytes in memory.
- **Dependencies:** None
- **Acceptance criteria:**
  - Invalid content type, oversized body, unknown session, bad internal secret, and a 151st identity are rejected without retaining bytes.
  - A new frame replaces the old frame for that identity; a stale participant disappears from the next composite within 12 seconds.
  - No raw frame or composite is written to disk; process restart yields an empty tapestry.
  - A 60-ingest-request/second, 150-participant, ten-minute test stays within the container's defined CPU/memory limit and continues serving a valid JPEG.
  - `/health` reports service state and counts but no participant identifiers.
- **Risk notes:** `sharp` native packaging must be proven in the exact Docker image on Tuesday. If it becomes the long pole, cut WS4 before substituting an unbounded in-process implementation in Next.js.

#### WS4-02 — Add camera snapshots and the cached/staff-only tapestry views

- **Workstream:** WS4 — Thumbnail tapestry
- **Effort:** 0.5 person-day
- **Scope:** Create `src/components/session/ThumbnailSender.tsx`, `src/components/session/ThumbnailTapestry.tsx`, `src/app/api/tapestry/frame/route.ts`, `src/app/api/tapestry/[sessionId]/route.ts`, and tests; wire the room page and operator view. The app validates event entitlement, replaces principal IDs with opaque tapestry IDs, and proxies to the internal service. Capture via canvas every 2.5 seconds after explicit opt-in. Pause capture when hidden/disconnected and avoid opening a second camera stream while that participant is publishing on stage. Set the public composite's short shared-cache headers; staff-only mode requires operator auth and `private, no-store`.
- **Dependencies:** WS4-01, WS2-02
- **Acceptance criteria:**
  - Camera capture never starts before a click and permission; declining/stopping camera does not affect room access.
  - The browser sends a JPEG at most once per 2.5 seconds, stops on unmount/background, and never sends email/code in URL, headers, or body.
  - Public mode returns `Cache-Control` suitable for a two-second Cloudflare shared TTL and no cookies; staff-only mode cannot be fetched without staff authorization and is never publicly cached.
  - Promoting a tapestry contributor does not create conflicting camera capture or break the stage camera.
- **Risk notes:** This is the first cut. Public display depends on WS6-02 consent copy and WS6-03 cache configuration; otherwise deploy the already-implemented staff-only mode.

### WS5 — Deployment, reliability, and event operations

#### WS5-01 — Deploy the fresh stack on mona with TLS and TURN

- **Workstream:** WS5 — Deploy, reliability, and event ops
- **Effort:** 1.5 person-days
- **Scope:** Replace the launch portions of `docker-compose.yml`; create `deploy/livekit.yaml`; update `Dockerfile`, `.env.example`, `deploy/.env.example`, `deploy/nginx-harmonic-beacon.conf`, `deploy/setup-nginx.sh`, and `deploy/README.md`; add a small Postgres backup script under `deploy/`. Compose must run `app`, `postgres`, `livekit`, `playlist-bot`, and `tapestry` (profile/cuttable), with health checks and bounded logs/resources. Put Postgres at `/mnt/beacon-data/postgres` and bed assets at `/mnt/beacon-data/beacon-records`. Bind HTTP control ports to loopback/internal networks, expose only the required LiveKit media/TURN ports, and proxy app + WSS signaling through Nginx at `live.harmonicbeacon.com`. Configure LiveKit's UDP media mux and TURN on the provisioned 3478 TCP/UDP path; verify restrictive-network fallback. Inject keys through `/etc/harmonic-beacon/production.env`/`LIVEKIT_KEYS`, never tracked config. Do not run LiveKit Egress.
- **Dependencies:** WS1-01 for final migration/env names; implementation starts Tuesday from this contract
- **Acceptance criteria:**
  - `docker compose config` contains no secret values or Zitadel/recording dependency; all five services become healthy after a clean boot.
  - Postgres data survives a full Compose down/up; a scripted dump to `/mnt/beacon-data/backups` restores into an empty database and boots the app.
  - `https://live.harmonicbeacon.com/api/health` and WSS signaling have valid TLS; app APIs and LiveKit API/control ports are not directly internet-exposed.
  - Direct UDP media works, and a test client on a network with direct UDP blocked joins through configured TURN. Failure of this test is a launch blocker, not an audio-only exception.
  - The playlist bot publishes the bed and recovers after its container is killed/restarted.
  - A tagged current image and previous known-good image/config can be selected to restore the app in ten minutes without rolling back the database.
- **Risk notes:** Cloudflare must not cache APIs or sit in the UDP media path. If TURN/TLS on the currently provisioned port cannot traverse the representative restrictive network, the operator must add the separately named DNS/port configuration before rehearsal; do not discover this during the event.

#### WS5-02 — Wire event health and write the operator runbook

- **Workstream:** WS5 — Deploy, reliability, and event ops
- **Effort:** 1.0 person-day
- **Scope:** Extend `src/app/api/health/ready/route.ts`; create `src/app/api/ops/health/route.ts`, `src/app/ops/health/page.tsx`, and tests; create `docs/ops/WEEKEND_EVENT_RUNBOOK.md`. Keep `/api/health` liveness-only. The operator check covers Postgres, LiveKit API, stage room, publisher grant count, bed publisher presence, and tapestry health, with timeouts and redacted errors. The runbook assigns incident commander, spotlight operator, stream/support operator, and Julián; covers admission, code rebind/revoke, bot loss/local bed fallback, provider loss, participant abuse, capacity, app/DB/LiveKit/vendor outage, raincheck policy, customer communication, abort, and refund authority.
- **Dependencies:** WS5-01, WS2-01, WS4-01
- **Acceptance criteria:**
  - Operator health turns non-green within 30 seconds of simulated DB, LiveKit, bot, or tapestry loss and identifies the failed subsystem without exposing secrets/PII.
  - Publisher count over six is a red invariant alarm; five participant grants plus Julián is green.
  - Liveness stays green during a DB outage while readiness returns `503`.
  - Every failure section has one owner, detection signal, first action, fallback/abort threshold, attendee message template in EN and ES, and refund decision owner.
  - Bot loss has a rehearsable browser/local audio fallback; total platform failure points to the pre-created external meeting, not an improvised URL.
- **Risk notes:** Do not mount the Docker socket into the app for health. Query service APIs/health endpoints. Tapestry failure is yellow/cuttable; entitlement, LiveKit, missing bed audio, or cap violation is red.

#### WS5-03 — Run capacity test, full dress rehearsal, and production freeze

- **Workstream:** WS5 — Deploy, reliability, and event ops
- **Effort:** 1.0 person-day
- **Scope:** Create `docs/ops/WEEKEND_REHEARSAL.md` and a dated result sheet under `docs/ops/rehearsals/`; execute the automated and human checks on production-like mona. Test 150 attendees with both LiveKit connections, six simulcast publishers at the intended layers, and a 20-minute soak; include at least one Argentina network, one non-Argentina network, iPhone Safari, Android Chrome, and a restrictive/TURN path. Then run purchase → code/email → join → refresh → disconnect/rejoin → raise hand → promote → demote → audio-only → revoke/override → bot failure → provider failure → raincheck → refund.
- **Dependencies:** WS1-02, WS1-03, WS2-02, WS3-02, WS5-02, WS6-01, WS6-02, WS6-03; WS4-02 only if tapestry remains public
- **Acceptance criteria:**
  - No seventh publisher appears; the sixth-publisher stage and concurrent last-slot race both pass under load.
  - All 150 subscribers remain connected for 20 minutes, receive both audio sources, and stage egress stays below the 3 Gbps NIC budget with no sustained CPU saturation or material packet-loss alarm.
  - Join succeeds within ten seconds on representative clients; reconnect returns within ten seconds and preserves entitlement/hand/grant as applicable.
  - A no-developer-assisted dress rehearsal completes the entire journey, including the actual external refund and fallback communication.
  - Every failed step has a named blocker owner and deadline. The go/no-go owner signs the result before freeze.
- **Risk notes:** A synthetic LiveKit load test does not replace six real browsers/cameras and mobile checks. Do not waive the commercial, entitlement, cap, TURN, bed-audio, or fallback failures to meet the date.

### WS6 — Commercial and human launch actions

#### WS6-01 — Prove Ticket Tailor + PayPal through the Argentine bank

- **Workstream:** WS6 — Commercial and human launch actions
- **Owner hint:** ops/human — finance/account holder
- **Effort:** 0.5 person-day, excluding provider settlement elapsed time
- **Scope:** Complete KYC and a real low-value Ticket Tailor purchase using the proposed PayPal account. Verify buyer receipt and unique-code delivery/export behavior, perform a real refund, initiate and confirm payout into the Argentine nonprofit's bank account, and reconcile platform fee, PayPal fee, FX, net ARS amount, settlement time, refund timing, accounting export, and chargeback procedure.
- **Dependencies:** None
- **Acceptance criteria:**
  - Purchase, code/attendee export, refund, and bank receipt are evidenced in the private ops record with no card/bank data committed to this repo.
  - Finance names the merchant/legal entity, payout account, refund authority, fee/FX expectation, and support contact.
  - Ticket Tailor's exact unique-code import/delivery format is handed to WS1-03.
  - Public ticket sales remain closed until the bank receipt succeeds. If it cannot succeed by Thursday, use another already-proven rail or do not run a paid event.
- **Risk notes:** This is a commercial go/no-go, not a software cut-line. A provider UI that says "payout configured" is not evidence of settlement.

#### WS6-02 — Configure the two capped events, ticket tiers, and attendee terms

- **Workstream:** WS6 — Commercial and human launch actions
- **Owner hint:** ops/human — event producer + policy owner
- **Effort:** 0.5 person-day
- **Scope:** Create Saturday Session 1 (Spanish, morning) and Session 2 (English, afternoon) events (or record the Tuesday language swap), each capped at 150 sold tickets with $50 global-north and $20 global-south tiers. Load the WS1-03 codes, send bilingual login/support instructions, and publish minimum privacy, camera-thumbnail consent, cancellation/refund, transfer/email-mismatch, fallback-meeting, and recording-off terms. Record the sales close and attendee reminder schedule.
- **Dependencies:** WS6-01, WS1-03
- **Acceptance criteria:**
  - A purchase at each price tier receives exactly one code for the correct session and lands on the correct login flow.
  - Paid plus comp entitlements cannot exceed 150 per session; the four staff identities are outside that audience count, and no ticket/comp entitlement creates publish rights.
  - Terms explicitly disclose a 100 px camera snapshot every 2–3 seconds for the tapestry, no raw-frame persistence, optional browser permission, processors, refund trigger, and that launch recording is off.
  - EN and ES confirmation/reminder/support copy is reviewed by a fluent human and includes event time with timezone.
- **Risk notes:** Do not infer global-north/south eligibility in application code this week. The ticket platform owns tier choice and payment; operators handle abuse manually.

#### WS6-03 — Complete DNS/Cloudflare, production secrets, staff seed, and fallback controls

- **Workstream:** WS6 — Commercial and human launch actions
- **Owner hint:** ops/human — server/Cloudflare owner + event producer
- **Effort:** 0.5 person-day
- **Scope:** Verify A/AAAA reachability for `live.harmonicbeacon.com`, set Cloudflare SSL to Full (strict), proxy/cache only appropriate HTTP paths, and add the short-TTL tapestry cache rule while bypassing auth APIs, tokens, health, and LiveKit signaling. Create `/etc/harmonic-beacon/production.env` with mode `0600`, generate independent LiveKit/ticket/session/internal-service secrets, and seed four named staff with separately delivered credentials. Define raincheck policy and private operator communication channel and private operator communication channel; assign incident and refund authority.
- **Dependencies:** WS5-01 and WS1-01 for final config/seed contracts; DNS, fallback, and contact work starts Tuesday
- **Acceptance criteria:**
  - Public DNS resolves IPv4/IPv6 to mona where supported, the certificate chain is valid, and Cloudflare never caches login/token/API responses.
  - Repeated tapestry requests show the intended approximately two-second edge cache behavior; staff-only mode bypasses the public cache.
  - No secret is present in Git, Compose output, image history, shell history supplied to the rehearsal record, or public health output.
  - All four staff complete a login check with their own credential; disabled/incorrect credentials fail.
  - Both fallback links are host-controlled, tested from an attendee device, sized for the cap, and present only in the runbook/operator channel until invoked.
- **Risk notes:** The public Cloudflare hostname does not proxy LiveKit UDP. Keep advertised media/TURN candidates pointed at mona and test IPv4 as the universal fallback if client IPv6 is unreliable.

## 4. Critical path and integration schedule

### Critical path to the event

There are three converging paths:

1. **Admission/commercial:** (WS1-01 → WS1-03) and WS6-01 converge at WS6-02 → WS5-03.
2. **Room/floor:** WS1-01 → WS2-01 → WS3-01 → WS3-02 → WS5-03.
3. **Production:** WS5-01 → WS5-02 → WS5-03.

WS1-02 and WS2-02 are mandatory parallel branches that must also converge before rehearsal. WS4 is explicitly outside the critical path. No ticket sale should precede WS6-01; no production freeze should precede WS5-03.

### Original integration schedule and current event date

The July 28–August 2 rows below record the completed MVP integration sequence.
The event-owner decision moved the two production sessions to Saturday
2026-08-08; that current live date supersedes the original run-day rows.

| Day | Cards and integration outcome |
|---|---|
| **Tue 07-28** | Freeze Section 1 by noon. Land WS1-01 and WS4-01. Start WS5-01. Ops starts WS6-01 immediately, verifies DNS, creates rainchecks/contact channel, and prepares WS6-03. Ani's strip rebases onto the WS1 schema/surface contract rather than deleting launch seams. |
| **Wed 07-29** | Land WS5-01 on mona, then WS1-02, WS1-03, and WS2-01. Complete WS6-01 and WS6-03; load a tiny test ticket batch. Run the first two-browser smoke: ticket login, both tokens, crossfader, staff login, restart/reconnect. Land WS6-02 only after the real rail test. |
| **Thu 07-30** | Land WS2-02, WS3-01, WS4-02, and WS5-02. Integrate six real publisher browsers plus a small subscriber load. Exercise cap races, grant reconciliation, bot restart, TURN, audio-only, revoke/rebind, and both language ticket paths. Decide the tapestry cut by **18:00 ART**; after that it is staff-only or absent, not a Friday rescue project. |
| **Fri 07-31** | Land WS3-02 by 11:00 ART. Run WS5-03 capacity soak at 11:00 and the no-developer-assisted purchase-to-refund dress rehearsal at **14:00 ART**. Fix only rehearsal blockers. Re-run the failed segment plus smoke suite. **Production freeze at 18:00 ART or T-12h before Saturday's doors, whichever is earlier.** |
| **Sat 08-01 / Sun 08-02** | Original rehearsal window; integration and feedback continued with commerce closed. |
| **Sat 08-08** | No routine deploys after freeze. Run the T-2h/T-45m/T-20m checks, then ES at 08:30 Costa Rica / 14:30 UTC and EN at 14:00 Costa Rica / 20:00 UTC. Export the private attendance/refund ledger and hold the full post-event review. |

### Freeze policy

- After Friday freeze, allowed changes are ticket inventory/revocation, event copy/time correction, secret rotation for a confirmed compromise, and a minimal Sev-1 fix for entitlement bypass, inability to join/hear, publisher-cap failure, or operator safety control.
- A Sev-1 code/config change requires incident-commander approval, a second technical reviewer, targeted regression plus smoke test, a tagged artifact, and documented rollback. If that cannot fit before doors, invoke the fallback/refund plan.
- Tapestry, layout polish, analytics, and non-blocking browser quirks never justify a post-freeze deploy.
- Session 2 uses the Session 1 artifact. A Session 1 incident is handled operationally unless the same non-cuttable Sev-1 would make Session 2 unsafe.

## 5. Explicit cut-lines

Cut in this order, and stop work on the cut item rather than replacing it with a new design:

1. **Public tapestry → staff-only tapestry.** Keep ingest/composite for the operators; remove the attendee composite and Cloudflare cache. Saves WS4-02 public integration/policy risk.
2. **Staff-only tapestry → no tapestry.** Remove the service/profile and camera sender from Compose/UI. The paid stage and audience audio/video are unaffected. Saves all WS4 work and capacity risk.
3. **Automatic active-speaker switching → operator-pinned spotlight.** Keep Julián at 720p and five fixed 360p auxiliaries; the spotlight operator selects the main tile. Do not cut stage video or the six-publisher cap.
4. **Admission polish → manual operator support.** Keep code + email, revoke, and rebind; drop search niceties, bulk UI, and comp UI in favor of the tested CLI. Never relax identity binding or the token gate.
5. **Two sessions → one session.** By Friday noon, keep the session with the proven payout/code batch, most confirmed attendees, fluent operator coverage, and successful language rehearsal; refund/cancel the other using published terms. Do not choose solely by price tier.
6. **Custom event cannot pass a non-negotiable gate → fallback or cancel/refund.** Entitlement enforcement, reconnect, the six-publisher cap, both audio sources, TLS/TURN, staff control, merchant rail, and the full rehearsal are not cuttable. If any remains red at freeze, do not accept/run a paid custom-platform event; invoke the pre-created meeting only under the disclosed fallback policy or cancel/refund.

Runtime audio-only mode is graceful degradation, not a scope cut: the stage video remains part of the launched product, while any attendee with a weak device/network can choose audio-only.

## 6. Deliberately out of scope

- **Zitadel, OIDC, social login, magic links, attendee accounts, passwords, MFA, account recovery, and old identity migration.** Ticket + email is the attendee identity; four seeded staff credentials are enough.
- **Existing users/content/data migration.** There is no meditation library, favorites, profile, voucher, listening history, report migration, recording, or media copy. The launch database is fresh.
- **In-app checkout, PayPal APIs/webhooks, orders, plans, vouchers, subscriptions, tax logic, price-tier eligibility, chargeback automation, and ticket-platform synchronization.** Ticket Tailor/PayPal plus human reconciliation owns commerce this week.
- **Recording/egress, playback, R2, raw/composed stage archives, transcripts, and recording consent.** Recording is off, its UI is absent, and no egress container/credentials are deployed.
- **Audience WebRTC video, open floor, all-camera circle, breakout rooms, chat, reactions, auto-advance, audience screen share, or more than six publishers.** Audience presence is snapshots; Julián controls every stage grant.
- **A new per-session bed publisher, server-side audio mix, or one-room media rewrite.** The existing global bed room and `services/playlist-bot` preserve the crossfader for the weekend.
- **Multi-node LiveKit, Redis, Kubernetes, multi-region/failover SFU, LiveKit Cloud, Fly.io, Neon, R2, or moving away from mona.** The provisioned single VPS and 150 cap are the fixed launch envelope.
- **Advanced observability.** No Prometheus/Grafana/tracing/Sentry project. Bounded health checks, container logs, operator dashboard, and event metrics are sufficient for two sessions.
- **General design-system cleanup, navigation preservation, provider/admin parity, mobile app, meditation playback/upload, analytics, SEO, or feature flags for old product surfaces.** Ani's strip should delete/hide anything not listed in Section 1 rather than preserving it for hypothetical reuse.
- **Automated refunds, customer messaging, bank reconciliation, or legal review tooling.** These are explicit human runbook actions for the pilot.

Anything in this section requires a post-weekend roadmap and must not be reintroduced during the Friday freeze.
