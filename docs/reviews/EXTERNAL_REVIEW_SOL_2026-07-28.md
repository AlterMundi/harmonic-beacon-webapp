# External review — Harmonic Beacon pivot and infrastructure migration

Date: 2026-07-28
Review basis: branch `docs/pivot-and-infra-planning`, commit `32322e53542b`

## Verdict

**Proceed with conditions.** The product direction—externally sold, voucher-gated interactive sessions on managed infrastructure—is coherent for AlterMundi, but the plan is not yet safe to execute as written. Four conditions are launch blockers: set and enforce a conservative `maxPublishers`; make paid entitlement mandatory and reconnect-safe; decide whether recording is disabled or migrated to object-backed cloud egress; and perform an end-to-end purchase, refund, payout, join, rejoin, promotion, failure, and fallback rehearsal. The current plan understates both implementation coupling and live-event operations. In particular, the token route presently admits any authenticated listener to a live session without an invite, a one-use invite cannot reliably reconnect, the current audio design creates two LiveKit connections per attendee, and the proposed per-session file publisher does not preserve the existing crossfade without additional track separation. A full database, file, app, media, and identity migration immediately before the first paid event would compound risk. Use LiveKit Cloud for the launch, cap the camera exercise, keep Zitadel temporarily if its forced-MFA policy can be relaxed, and move identity only after the paid-event path has stabilized.

## Verified claims table

This table covers every material “exists today” claim I audited. “Verified” means the repository supports the claim; it does not establish that the deployed host exactly matches this commit.

| Claim | Verdict | Evidence path |
|---|---|---|
| The application is Next.js 16 with PostgreSQL, Prisma, LiveKit, and NextAuth/Auth.js. | Verified. The pinned versions include Next `16.1.2`, Prisma `7.3.0`, LiveKit client/server packages, `pg`, and `next-auth` `5.0.0-beta.30`. | `package.json` |
| The Compose application has two services, `app` and `playlist-bot`; go2rtc has been removed. | Verified. No go2rtc service or source configuration remains in the active tree. | `docker-compose.yml`; `services/playlist-bot/` |
| PostgreSQL is on the host rather than in this Compose stack. | Verified. There is no database container; the example connection is to `host.docker.internal:5432`. | `docker-compose.yml`; `.env.example` |
| Audio, uploads, and recordings are local host-mounted storage. | Verified. The app mounts `/mnt/n8n-data/harmonic-beacon/{meditations,uploads,recordings}`. | `docker-compose.yml`; `.env.example` |
| The app, database migration, Compose deployment, and CI/deploy runner share substantial failure scope. | Verified for the repository-managed deployment. The deploy job runs on a self-hosted runner, migrates a localhost database, and starts Compose there; CI is also self-hosted. | `.github/workflows/deploy.yml`; `.github/workflows/ci.yml`; `docker-compose.yml` |
| The public media endpoint is configured as `wss://live.altermundi.net`; the bot normally reaches LiveKit on port 7880 on its host. | Verified as configuration. The bot defaults `LIVEKIT_INTERNAL_URL` to `ws://host.docker.internal:7880`. | `.env.example`; `docker-compose.yml` |
| The deploy workflow does not persist an explicit bot-internal LiveKit URL. | Verified. `LIVEKIT_INTERNAL_URL` is absent from the generated production environment, so Compose uses its port-7880 host default. | `.github/workflows/deploy.yml`; `docker-compose.yml` |
| Authentication currently has one Zitadel provider. | Verified. | `src/lib/auth-config.ts` |
| Zitadel role claims are translated to the application’s `ADMIN`, `PROVIDER`, and `USER` roles. | Verified. Fresh sign-in synchronizes the database role from the Zitadel claim. | `src/lib/auth-config.ts`; `prisma/schema.prisma` |
| The normal LiveKit token route requires authentication and issues a listen-only grant. | Verified. It generates a random listener identity with `canSubscribe: true`, `canPublish: false`, and a two-hour TTL. | `src/app/api/livekit/token/route.ts`; `src/lib/livekit-server.ts` |
| Scheduled sessions, participants, and invitation codes already exist. | Verified. Invitation codes have `maxUses`, `usedCount`, `expiresAt`, and `canPublish`; the participant key is unique per session/user. | `prisma/schema.prisma`; `src/app/api/provider/sessions/[id]/invites/route.ts`; `src/app/api/invites/[code]/route.ts` |
| Invite codes are generated with cryptographically secure randomness. | Verified. Twelve random bytes are encoded as base64url. | `src/lib/invite-codes.ts` |
| The scheduled-session token route separates provider and listener publishing rights. | Verified. Providers may publish; listeners publish only when an accepted invite grants `canPublish`. Token identities are based on database user IDs. | `src/app/api/scheduled-sessions/[id]/token/route.ts` |
| The current provider UI can create listener or publisher invite codes. | Verified, one code at a time. There is no bulk ticket import or bulk unique-code generator. | `src/app/api/provider/sessions/[id]/invites/route.ts`; `src/app/provider/sessions/[id]/page.tsx` |
| The playlist bot is one long-running global-room publisher with fallback behavior. | Verified. Room name and source directory are fixed at process start; it scans sorted `.ogg` files and loops them. | `services/playlist-bot/src/index.ts`; `docker-compose.yml` |
| Starting a scheduled session does not currently launch a room-specific file publisher. | Verified. The route changes database state to `LIVE`; there is no publisher orchestration. | `src/app/api/provider/sessions/[id]/route.ts`; `services/playlist-bot/src/index.ts` |
| The scheduled-session page has microphone controls and listener/provider publish differences, but no camera UI or promotion signaling. | Verified. `canPublish` is static for the room connection; there is no video track or LiveKit data-message implementation. | `src/app/session/[id]/page.tsx` |
| The session page has a crossfader. | Verified with an important limitation: all scheduled-room remote audio tracks receive the same session gain, while the other side controls the separate global-beacon connection. | `src/app/session/[id]/page.tsx`; `src/context/AudioContext.tsx` |
| An authenticated attendee normally holds a global-beacon LiveKit connection in addition to the scheduled-room connection. | Verified. `AudioContext` connects at authenticated layout scope and the session page creates its own room. | `src/context/AudioContext.tsx`; `src/app/session/[id]/page.tsx` |
| Server-side recording exists and uses LiveKit egress. | Verified. It starts individual track egresses for the audio tracks active at recording start and writes local files under `/data/recordings`. | `src/app/api/provider/sessions/[id]/recording/start/route.ts`; `src/lib/session-lifecycle.ts`; `src/lib/ffmpeg-mix.ts` |
| Local file delivery supports HTTP Range requests. | Verified. | `src/lib/stream-file.ts`; `src/app/api/sessions/[id]/recording/route.ts` |
| Liveness and database-readiness endpoints exist. | Verified. `/api/health` does not touch the database; `/api/health/ready` performs `SELECT 1`, has a three-second timeout, redacts errors, and returns 503 on failure. | `src/app/api/health/route.ts`; `src/app/api/health/ready/route.ts` |
| Readiness is not used by the current container or deployment health gate. | Verified. Compose and the deploy workflow call only `/api/health`. | `docker-compose.yml`; `.github/workflows/deploy.yml` |
| Sensitive database URL components can be redacted from errors. | Verified. Credentials and sensitive query parameters are masked. | `src/lib/redact.ts` |
| A static guard checks selected direct PII logging patterns. | Verified, but narrow. It scans console calls for direct `.email`, `.name`, `.avatarUrl`, `.picture`, and `.image` access; it is not a runtime or structured-log guarantee. | `src/lib/__tests__/no-pii-in-logs.test.ts` |
| Audit events, reports, account export/deletion, provider takedown, and admin session termination exist. | Verified. | `prisma/schema.prisma`; `src/app/api/users/me/route.ts`; `src/app/api/users/me/export/route.ts`; `src/app/api/provider/meditations/[id]/route.ts`; `src/app/api/admin/sessions/[id]/terminate/route.ts`; `src/lib/session-lifecycle.ts` |
| Physical media deletion is not complete. | Verified. Account deletion and provider takedown contain storage TODOs; hiding a record does not purge its media file. | `src/app/api/users/me/route.ts`; `src/app/api/provider/meditations/[id]/route.ts` |
| The current schema lacks the proposed voucher/order/plan/speaker/session-mode concepts. | Verified. There is no `Voucher`, `Order`, `Plan`, or `SessionSpeaker`, and `ScheduledSession` has no mode or `maxPublishers` field. | `prisma/schema.prisma`; `docs/PIVOT_PAID_SESSIONS_PLAN.md` |
| The proposed navigation feature flags do not exist yet. | Verified. Navigation is hard-coded; there is no `src/lib/features.ts`. | `src/components/BottomNav.tsx`; `src/app/sessions/page.tsx`; `docs/PIVOT_PAID_SESSIONS_PLAN.md` |
| Neon is not integrated yet. | Verified. The database code uses a generic `pg.Pool`; no Neon driver/package or linked project configuration exists. A `.neon` feature scaffold is present but does not prove provisioning. | `src/lib/db.ts`; `package.json`; `.neon/` |
| Fly.io deployment is not implemented. | Verified. There is no `fly.toml` or Fly deployment workflow. | repository tree; `deploy/`; `.github/workflows/` |
| Metrics, tracing, and an external error-monitoring integration are not present. | Verified by repository search. Existing health routes are not observability. | `package.json`; `src/`; `deploy/` |
| The repository contains 624 `it(...)`/`test(...)` definitions. | Verified statically. Runtime status was not verified: `npm test -- --reporter=dot` could not start because dependencies are not installed (`vitest: not found`). | `src/**/*.test.*`; `src/**/__tests__/*`; `package.json` |
| The repository includes license and notice files. | Verified. | `LICENSE`; `NOTICE` |

## Failed or unverifiable claims

### Failed against the repository

| Claim in the working set | Finding | Evidence |
|---|---|---|
| Existing invitation codes can gate the first paid events without application changes. | **Failed and launch-blocking.** For a session in `LIVE` state, an authenticated listener without an invite is intentionally issued a token. A unit test asserts this behavior. Paid entitlement is therefore optional, not a gate. | `src/app/api/scheduled-sessions/[id]/token/route.ts`; `src/app/api/scheduled-sessions/[id]/token/route.test.ts`; `docs/PIVOT_PAID_SESSIONS_PLAN.md` |
| A unique `maxUses: 1` ticket code is adequate for one attendee. | **Failed for reconnect.** The “uses exhausted” check occurs before the existing-participant exception. After first redemption, the same user can be rejected on refresh or reconnect. Redemption and participant upsert are also not one transaction. | `src/app/api/scheduled-sessions/[id]/token/route.ts`; `prisma/schema.prisma` |
| A per-session file publisher preserves the current provider/file crossfade interaction. | **Failed as specified.** In the scheduled room, every remote audio track gets the same session volume. The file side of the current crossfader is the separate global room. A bot and facilitator in one scheduled room need explicit source metadata and independent gain handling. | `src/app/session/[id]/page.tsx`; `src/context/AudioContext.tsx`; `docs/PIVOT_PAID_SESSIONS_PLAN.md` |
| The playlist bot can be adapted by passing `{roomName, filePath}` with little orchestration. | **Understated.** The current process has one room and one directory fixed at startup, a global fallback election, and no control API or linkage from session-start. Lifecycle, idempotency, failure reporting, concurrency, and cleanup are new work. | `services/playlist-bot/src/index.ts`; `src/app/api/provider/sessions/[id]/route.ts`; `docs/PIVOT_PAID_SESSIONS_PLAN.md` |
| Next.js is stateless and therefore trivial to replicate. | **Not true today.** Upload, recording, playback, cut/mix, and deletion paths depend on local files. It becomes stateless only after an object-storage driver and background media workflow are complete. | `docker-compose.yml`; `src/lib/stream-file.ts`; `src/app/api/provider/sessions/[id]/recording/start/route.ts`; `src/lib/session-lifecycle.ts`; `src/lib/ffmpeg-mix.ts`; `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md` |
| LiveKit Cloud is mainly an endpoint/credential change. | **Failed if recording remains enabled.** Current egress writes server-local paths and lifecycle code calls `existsSync` on those paths. Promoted speakers who publish after recording starts are also not captured by the initial track snapshot. Cloud launch requires R2/S3 egress output and lifecycle changes, or recording must be explicitly disabled. | `src/app/api/provider/sessions/[id]/recording/start/route.ts`; `src/lib/session-lifecycle.ts`; `src/app/api/sessions/[id]/recording/route.ts`; `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md` |
| The cited LiveKit benchmark is “one audio publisher plus 3,000 subscribers at about 92% CPU.” | **Failed.** The official benchmark assigns approximately 92% to the *video livestream* case. Its audio-only case is 10 publishers plus 3,000 subscribers at approximately 80%, with an average 3 kbps audio test stream—not the plan’s 128 kbps assumption. | `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`; [LiveKit benchmark](https://docs.livekit.io/transport/self-hosting/benchmark/) |
| A multi-node self-hosted cluster solves a 300-person all-camera room. | **Failed.** LiveKit distributes rooms between nodes, but one room must fit on one node. More nodes improve room-level capacity and fault domains, not the capacity of one existing room. | `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`; [LiveKit distributed setup](https://docs.livekit.io/transport/self-hosting/distributed/) |
| Two simultaneous 128 kbps audio sources equal 64 Mbps and 43 GB per 500-person, 90-minute event. | **Arithmetically inconsistent.** Two 128 kbps sources equal 256 kbps per listener, 128 Mbps aggregate, and about 86.4 GB per event. The document’s 43.2 GB result corresponds to 128 kbps *total*, such as two 64 kbps sources. | `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`, audio bandwidth calculation |
| The existing admin user route is the application’s role-promotion path. | **Failed.** The route explicitly returns 409 and instructs administrators to change roles in Zitadel. | `src/app/api/admin/users/[id]/route.ts`; `docs/AUTH_SIMPLIFICATION_ANALYSIS.md` |
| The Auth.js migration is mostly `auth-config.ts` plus a small data migration. | **Failed as an effort assumption.** Production routes throughout provider sessions, invitations, meditations, favorites, reports, audit, exports, deletion, and token issuance lookup users by `zitadelId`. The schema also makes it required and unique. | `src/lib/auth-config.ts`; `prisma/schema.prisma`; `src/app/api/`; `src/lib/`; `docs/AUTH_SIMPLIFICATION_ANALYSIS.md` |
| The deployment workflow has a rollback. | **Failed operationally.** The “rollback” restarts a build from the same checked-out source; there is no immutable previous image or database rollback. Migrations run before application replacement. | `.github/workflows/deploy.yml` |
| Deployment environment examples are reconciled. | **Failed.** `deploy/.env.example` uses legacy `ZITADEL_ISSUER`, `ZITADEL_CLIENT_ID`, and introspection names, while the application and root example use `AUTH_ZITADEL_ID` and `AUTH_ZITADEL_ISSUER`. | `deploy/.env.example`; `.env.example`; `src/lib/auth-config.ts`; `docker-compose.yml` |
| The corpus is fully reconciled to current line anchors and behavior. | **Only partially true.** The promote-to-speaker document records updated anchors, but other anchors remain stale; the auth document’s role-route interpretation is substantively wrong. Reconciliation did not catch the admission, reconnect, crossfade, or local-egress dependencies. | `docs/PROMOTE_TO_SPEAKER_BUILD.md`; `docs/AUTH_SIMPLIFICATION_ANALYSIS.md`; code paths above |

### Unverifiable from this repository

- **Exact production colocation.** The repository supports the claim that app, deploy runner, local PostgreSQL, local storage, and probably LiveKit share a host. It does not independently prove that Zitadel, LiveKit egress, or every other named sensitive service is on that same physical server. This needs a production inventory (`docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`; `docker-compose.yml`; `.github/workflows/deploy.yml`).
- **Measured Costa Rica latency.** The cited Argentina-to-Costa-Rica RTT and the superiority of a particular US region are not backed by measurements in the repository. Measure from representative Costa Rican, Argentine, North American, and European access networks before choosing a self-host region (`docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`).
- **Current deployed configuration.** Public environment examples and deploy scripts establish intent, not that production matches commit `32322e5`. Capture sanitized production topology, image digest, LiveKit version/configuration, backup state, and egress configuration before migration (`.env.example`; `deploy/`; `.github/workflows/deploy.yml`).
- **“Green” test suite.** There are 624 static test definitions, but dependencies were not installed in this checkout, so I could not execute them. This report did not install packages or change lockfiles (`package.json`; `package-lock.json`).
- **Ticket-platform code delivery and webhook behavior.** No integration exists in the repository, and platform capabilities differ. The team must validate unique-code delivery, CSV/API export, transfers, refunds, chargebacks, resend behavior, and webhook signatures with the chosen vendor (`docs/PIVOT_PAID_SESSIONS_PLAN.md`).
- **Auth.js MFA and role-enforcement assertions.** The planned stack is not implemented and the repository has no Auth.js adapter tables, WebAuthn package, or email sender. Role authorization can remain an application concern, but equivalent administrator MFA is not established by choosing social login plus magic links (`package.json`; `prisma/schema.prisma`; `docs/AUTH_SIMPLIFICATION_ANALYSIS.md`).
- **Credits and discounts.** Cloudflare Project Galileo and Google for Nonprofits/Ad Grants are application-based benefits, not approved budget offsets. No LiveKit nonprofit price was verified. Base-case budgeting must treat all credits as zero until accepted ([Project Galileo](https://www.cloudflare.com/galileo/); [Google for Nonprofits Argentina eligibility](https://support.google.com/nonprofits/answer/3215869?co=GENIE.CountryCode%3DAR&hl=en-CA); [Ad Grants](https://support.google.com/nonprofits/answer/1332166?hl=en)).

## Inconsistencies and hidden contradictions

1. **The launch gate is described as solved, but it is open by design.** “External ticketing, zero payment code” is sensible only if the application has a reliable entitlement boundary. The current route treats invitations as optional. Codes are bearer credentials, are not bound to a purchaser, are not atomically redeemed, and do not model refunds, transfers, gifts, or chargebacks (`src/app/api/scheduled-sessions/[id]/token/route.ts`; `prisma/schema.prisma`; `docs/PIVOT_PAID_SESSIONS_PLAN.md`).

2. **The target media room is singular, while the existing user experience is dual-room.** Every authenticated attendee connects to the global beacon, then the session page connects again to the scheduled room. This doubles billable WebRTC connection-minutes and approaches the LiveKit Ship plan’s 1,000-concurrent-connection quota at roughly 500 attendees before providers and bots are counted. Collapsing into one room is the right end state, but independent source gain/crossfade must be built first (`src/context/AudioContext.tsx`; `src/app/session/[id]/page.tsx`; [LiveKit pricing and quotas](https://livekit.com/pricing)).

3. **“Everyone can turn cameras on” conflicts with both cost control and client limits.** `PROMOTE_TO_SPEAKER_BUILD.md` first says a hundreds-person audience and all-camera mode cannot coexist safely and suggests a 25–50 person circle, then later calls a 300-person all-camera room supported. LiveKit Cloud removes server sizing work, not downstream bandwidth, rendering, device heat, mobile subscription limits, or a participant’s uplink quality. `maxPublishers`, maximum subscribed video tracks per device, resolution, simulcast layers, and the number of non-publishing viewers are one product decision, not separate infrastructure details.

4. **The infrastructure recommendation is conditional on the still-open load-bearing decision.** The document recommends LiveKit Cloud, then says video economics flip the answer toward dedicated self-hosting. That is not yet a decision. More importantly, a 300-person room cannot be spread across self-hosted SFU nodes, so the stated fallback requires a single, load-tested, high-network-capacity node and an operational standby—not merely a cluster (`docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`; [LiveKit distributed setup](https://docs.livekit.io/transport/self-hosting/distributed/)).

5. **Low-cost European bandwidth conflicts with Costa Rica latency goals.** The 20 TB included-traffic headline applies to Hetzner EU cloud locations, while US cloud instances include 1 TB. A US location may be better for Costa Rica, but the budget must use that region’s bundle and measured latency. Conversely, the EU bundle should not be justified as globally low-latency ([Hetzner Cloud](https://www.hetzner.com/cloud/); `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`).

6. **The plan is trying to reduce operational burden while retaining its hardest on-call component.** Neon, R2, and Fly reduce database, storage, and app-host operations. Self-hosting a large-room SFU, TURN, Redis, load balancer, egress workers, monitoring, and standby would reintroduce the highest-consequence live-event burden. For a small team, managed LiveKit is coherent with the other managed choices; self-hosting becomes coherent only after measured Cloud spend materially exceeds the cost of staffed operations.

7. **“Zero payment code” removes checkout implementation, not commerce responsibility.** AlterMundi still needs merchant onboarding, payout currency and timing, accounting records, fees/FX, refund and chargeback procedures, access revocation, support, and published terms. These are currently treated as adjacent rather than launch-critical (`docs/PIVOT_PAID_SESSIONS_PLAN.md`; `docs/INFRASTRUCTURE_SCALING_ANALYSIS.md`).

8. **The suggested Luma path may conflict with the Argentine legal entity.** Luma states that event proceeds are paid through Stripe, while Stripe’s public availability list does not include Argentina as a supported merchant country. That does not prove Luma will reject AlterMundi, but it makes Luma a poor default until the organization demonstrates a valid supported payout setup ([Luma payouts](https://help.luma.com/p/understanding-payouts-and-event-proceeds); [Stripe global availability](https://stripe.com/global)).

9. **Friction-light attendee auth and high-value paid access need separate controls.** Social login or magic link can reduce attendee friction, but the ticket entitlement must be bound to a verified identity and support reconnects, refunds, transfers, and support overrides. Administrator and provider accounts need stronger authentication than “email possession” alone. The auth document conflates identity-provider simplification with paid authorization (`docs/AUTH_SIMPLIFICATION_ANALYSIS.md`; `src/lib/auth-config.ts`; `src/app/api/scheduled-sessions/[id]/token/route.ts`).

10. **The working set gives conflicting launch guidance on auth.** The pivot plan proposes keeping Zitadel for the MVP and changing its forced-MFA policy; the README lists Auth.js as a locked migration. Both can be true as sequence, but not as simultaneous pre-launch work. The safest interpretation is “Auth.js is the destination, not a first-event dependency” (`docs/README.md`; `docs/PIVOT_PAID_SESSIONS_PLAN.md`; `docs/AUTH_SIMPLIFICATION_ANALYSIS.md`).

11. **Recording requirements are not reconciled with promotion or storage migration.** Per-track egress snapshots only current tracks, so a later-promoted listener is omitted. Local file existence determines whether a recording database row survives end-of-session. Video/audio consent, retention, deletion, and whether recordings are part of the paid product remain undefined (`src/app/api/provider/sessions/[id]/recording/start/route.ts`; `src/lib/session-lifecycle.ts`; `src/app/api/users/me/route.ts`).

12. **Isolation is the migration driver, but the sequence treats it like a scale optimization.** Moving every subsystem at once maximizes cutover risk. A temporary dedicated isolated VM, or LiveKit Cloud first while the app remains briefly on the existing host under an explicit exception, can remove the most dangerous bandwidth/failure coupling sooner. The target architecture can still be Neon + R2 + managed app + managed media.

## Cost-model sensitivity analysis

Network access was available for this review. The unit prices below were rechecked on 2026-07-28 against official public vendor pages. They still need account-region, tax, currency, quota, and contract confirmation before spend. Hetzner’s exact suitable instance, ticketing fees, Argentine payout costs, and any nonprofit discounts remain **needs external verification**.

### Corrected baseline

Assumptions from the infrastructure document unless noted: 500 listeners, 90 minutes, 8 sessions/month.

| Scenario | Monthly WebRTC minutes | Approximate downstream media | Rechecked LiveKit Cloud cost | Main sensitivity |
|---|---:|---:|---:|---|
| One room, audio total 128 kbps/listener | 360,000 | 345.6 GB | About **$167/month** on Ship: $50 base + $105 minute overage + about $12 data overage | Sessions × duration × participants |
| One room, two audio sources at 128 kbps each | 360,000 | 691.2 GB | About **$208/month** on Ship | Actual codec bitrate and whether both sources are continuously subscribed |
| Current two-room connection pattern, audio total 128 kbps | 720,000 | 345.6 GB | About **$347/month** on Ship | Duplicate connection-minutes |
| Current two-room pattern, two 128 kbps sources | 720,000 | 691.2 GB | About **$388/month** on Ship | Duplicate minutes plus bitrate |
| 50-person camera circle, each receiver averaging 7 Mbps subscribed video | 36,000 | 1.89 TB | About **$247/month** on Ship | Aggregate subscribed bitrate, not publisher count alone |
| 500 receivers each averaging 7 Mbps from a 40-publisher exercise | 360,000 | 18.9 TB | About **$2,090/month** on Scale; Ship is roughly $2,394 | Number of receivers × bitrate; this is the dangerous ambiguity in “40 cameras” |
| 300-person all-camera room, each receiver averaging 7 Mbps | 216,000 | 11.34 TB | About **$1,334/month** on Scale; Ship is roughly $1,414 | Subscription policy, simulcast layer, active-speaker pagination |

The LiveKit price inputs are Ship at $50/month with 150,000 WebRTC minutes, 250 GB downstream, 1,000 concurrent connections, and 600 track-egress minutes; overages are $0.0005/minute, $0.12/GB downstream, and $0.001/track-egress minute. Scale is $500/month with 1.5 million WebRTC minutes, 3 TB downstream, and 5,000 concurrent connections; downstream overage is $0.10/GB ([LiveKit pricing](https://livekit.com/pricing); [LiveKit billing](https://docs.livekit.io/deploy/admin/billing/)).

These estimates are directional, not bills. They omit taxes, support, recording storage, video egress/transcoding, ingress, and TURN overhead. They also assume decimal GB and that “7 Mbps per receiver” is the aggregate received bitrate after selective subscription. A gallery that subscribes to more/higher simulcast layers can be materially higher; active-speaker pagination can be lower. LiveKit documents plan and per-participant subscription limits, so the UI policy must be part of the load model ([LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/)).

### Vendor sanity checks

- **LiveKit Cloud:** The document’s audio-only order of magnitude is reasonable after correcting its bitrate formula, but the current two-room client can approximately double the minute charge. The `$400–600/month` camera estimate is plausible only for a small circle whose video is not sent to hundreds of additional viewers. It is not adequate for 300 all-camera or 500 viewers of 40 camera tracks. The largest variables are receivers, average subscribed bitrate, and sessions/month—not simply `maxPublishers`.

- **Self-hosted LiveKit:** A `$15–50/month` server plus `$10–30` TURN estimate is not an operations-equivalent comparison with Cloud. The official benchmark uses a 16-vCPU compute-optimized Google instance with 10 Gbps networking. A large room must fit on one node. A paid-safe design also needs monitoring, Redis/load balancing if clustered, egress capacity, backups/config management, and a tested standby. Exact server and traffic prices are **needs external verification**. Built-in TURN is available in LiveKit’s documented deployment, so a separate coturn bill is not automatically required ([LiveKit self-hosting](https://docs.livekit.io/transport/self-hosting/); [LiveKit benchmark](https://docs.livekit.io/transport/self-hosting/benchmark/)).

- **Neon:** The public Launch price is usage-based at $0.106/CU-hour plus $0.35/GB-month, with a representative `$15/month` workload shown by Neon. A continuously active minimum 0.25 CU endpoint is about 187.5 CU-hours, or about **$19.88/month before storage/history**. The document’s `$0–15` is plausible only for a small database that actually suspends; a readiness query every 30 seconds can prevent scale-to-zero. Budget **$15–25/month initially**, use a pooled connection for the app and a direct connection for migrations, and verify restore history and backup drills ([Neon pricing](https://neon.com/pricing); [Neon compute lifecycle](https://neon.com/docs/manage/endpoints/); `src/lib/db.ts`; `src/app/api/health/ready/route.ts`).

- **Cloudflare R2:** Standard storage is $0.015/GB-month with no direct internet egress charge; request operations are separately billed and a free allowance applies. `$0–1/month` is plausible for a small audio library, but not established for video recordings, repeated range requests, lifecycle transitions, or backup copies. The missing driver and deletion workflow are more important than the first-year storage bill ([R2 pricing](https://developers.cloudflare.com/r2/pricing/); `src/lib/stream-file.ts`; `src/app/api/users/me/route.ts`).

- **Fly.io:** Public pay-as-you-go examples put a single shared 1 GB machine around $5.92/month and 2 GB around $11.11/month before region, volumes, bandwidth, and extras. Thus `$10–25/month` is plausible for one small web instance, but a paid-event configuration with two app replicas and a separate publisher/FFmpeg worker is more safely budgeted at **$20–50+** until measured. There is no `fly.toml` to size today ([Fly.io pricing](https://fly.io/docs/about/pricing/); repository tree).

- **Ticketing and payout:** These costs are absent from the infrastructure total and can dominate the small hosting bill. Include ticket-platform fees, PayPal/processor fees, foreign exchange, withdrawal fees, refunds, chargebacks, tax/accounting, email delivery, and support labor. Ticket Tailor can connect directly to PayPal and sends ticket funds to that connected account; PayPal’s Argentina documentation says local-bank withdrawal is in ARS and may carry fees/partner requirements. Test a real purchase-to-bank cycle before sales ([Ticket Tailor PayPal setup](https://help.tickettailor.com/en/articles/950955-how-to-use-paypal-for-payment-processing); [Ticket Tailor payment flow](https://help.tickettailor.com/en/articles/2425375-how-to-take-payments-for-your-tickets); [PayPal Argentina withdrawal](https://www.paypal.com/ar/cshelp/article/how-do-i-withdraw-money-from-paypal-to-my-bank-account-help394?locale.x=en_AR)).

### What the total is most sensitive to

1. **Audience receiving video.** Each receiver at 7 Mbps for 90 minutes consumes about 4.725 GB. Multiplying that by 50, 300, or 500 receivers changes the answer by an order of magnitude.
2. **Sessions and duration.** WebRTC minutes and media transfer scale linearly with `participants × minutes × sessions`. Rehearsals and free/support access must be counted too.
3. **The two-room client.** It approximately doubles connection-minutes even when it does not double media bytes.
4. **Subscription policy and device class.** Active-speaker/paginated video at low simulcast layers can reduce 300-person transfer drastically; a full gallery cannot.
5. **Audience geography.** LiveKit Cloud’s listed unit rate does not change by attendee geography, but self-hosted latency, TURN use, region traffic bundle, and achievable network throughput do.
6. **Recording.** Track egress minutes, composition, encoding workers, video storage, retention, and playback can add both cost and operational load.
7. **Reliability level.** One small app VM is cheap; two replicas, standby media capacity, monitoring, log retention, and operator time are the honest paid-service comparison.

## Risk register

| Risk | Likelihood | Impact | Mitigation | Document section that should cover it |
|---|---|---|---|---|
| Authenticated users bypass paid admission because invitations are optional | Certain in current code | Critical revenue/access failure | Make entitlement mandatory for paid mode; deny token issuance without an active entitlement; test direct-route access | `PIVOT_PAID_SESSIONS_PLAN.md` — voucher/admission data model |
| One-use code fails on reconnect or is shared | High | Critical during live event | Bind redemption to a verified user in one transaction; permit that same user to rejoin; model revoke/transfer/refund; rate-limit attempts | `PIVOT_PAID_SESSIONS_PLAN.md` — admission lifecycle |
| Ticket refund/chargeback does not revoke access | Medium | High | Import/webhook reconciliation plus operator revoke action; define cutoff and exception policy | `PIVOT_PAID_SESSIONS_PLAN.md` — ticketing operations |
| Argentine nonprofit cannot complete payout or loses material value to FX/fees/holds | High until tested | High | Complete KYC and a real low-value purchase, refund, and ARS bank payout before public sales; accountant review | `PIVOT_PAID_SESSIONS_PLAN.md` — commercial launch checklist |
| `maxPublishers` remains open when tickets are sold | High | Critical | Set hard server and UI caps before publishing capacity; use invite/promotion permissions to enforce; load test at 1.5× expected | `PROMOTE_TO_SPEAKER_BUILD.md` — product constraints |
| Two-room design breaches Cloud connection quota or unexpectedly raises cost | High near 500 attendees | High | Disconnect global room while in a paid session or move bot into the session room with source-specific gain; verify quota | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — media topology/cost |
| Mobile/browser fails under large camera subscription/render load | High | High | Active-speaker pagination, low simulcast layers, explicit receive cap, representative phone rehearsal, audio-only fallback | `PROMOTE_TO_SPEAKER_BUILD.md` — client performance |
| Publisher/bot failure removes the core audio experience | Medium | Critical | Health/heartbeat visible to operator; local provider fallback audio; restart control; preloaded browser-safe backup track | `PIVOT_PAID_SESSIONS_PLAN.md` — file publisher operations |
| Promoted speaker is omitted from recording | High if recording starts first | High | Disable recording for launch or implement dynamic/composite egress and explicit consent; verify the output | `PROMOTE_TO_SPEAKER_BUILD.md` — recording behavior |
| LiveKit Cloud switch breaks local-path recording and playback | High | High | Configure R2/S3 egress output and object-backed lifecycle first, or disable the feature; end-to-end playback test | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — media migration |
| Large self-hosted room exceeds a single SFU node | Medium if self-host chosen | Critical | Prefer Cloud for launch; otherwise benchmark the exact codec/topology on compute-optimized 10 Gbps hardware and keep a tested spare | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — LiveKit option |
| Single-region app/database outage interrupts a paid event | Medium | High | Keep media managed; use Neon’s supported resilience, two app replicas when justified, external status/fallback link, refund trigger | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — reliability objectives |
| Tiny team has no event on-call capacity | High | Critical | Assign incident commander and producer; written runbook; freeze window; rehearsed go/no-go, support, fallback, and refund authority | New shared section — live-event operations |
| Current “rollback” cannot restore previous app/database behavior | High during migration | High | Immutable tagged image, backward-compatible expand/contract migrations, database backup/restore drill, timed rollback decision | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — migration/cutover |
| Health checks pass while database, R2, email, bot, or LiveKit is unusable | High | High | External synthetic purchase-free join check; readiness dependencies; operator dashboard and alerts; avoid probes that defeat Neon suspension | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — observability |
| R2 migration leaves orphaned personal media | Certain unless implemented | High privacy/compliance | Storage abstraction with delete/list/copy; deletion queue and audit; retention schedule; reconciliation job | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — object storage; compliance section |
| Full Auth.js migration breaks identities/roles/data rights before launch | High if rushed | High | Defer; inventory every `zitadelId` call site; stable internal identity table; staged dual mapping; admin/provider MFA | `AUTH_SIMPLIFICATION_ANALYSIS.md` — migration plan |
| Magic-link email is delayed, filtered, or sent to ticket-email mismatch | Medium | High | Pre-event login check, verified sender, resend/support flow, ticket transfer/gift rules, social-login fallback | `AUTH_SIMPLIFICATION_ANALYSIS.md` — attendee recovery |
| Vendor outage or quota limit during event | Low–medium | Critical | Confirm quotas/support tier; status monitoring; emergency meeting/fallback stream; customer communication and refund rule | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — failure scenarios |
| No privacy notice, terms, refund policy, recording consent, or processor inventory | Certain today | High | Publish minimum reviewed policies before sale; consent at purchase/join; document processors, retention, contact, deletion, refunds | `PIVOT_PAID_SESSIONS_PLAN.md` — Phase 1 compliance |
| Secrets/configuration differ between build, runtime, and bot | Medium | High | Typed configuration audit; build/runtime URL check; secrets inventory/rotation; deployment smoke test | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — deployment |
| Vendor lock-in grows unnoticed | Medium | Medium | Keep Postgres portable; use S3-compatible object API; retain LiveKit protocol and exportable recordings; map external provider IDs to stable internal IDs; quarterly restore/export drill | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — exit strategy |
| Simultaneous migrations create an untraceable cutover failure | High | Critical | Separate media/admission launch changes from identity; migrate one state system at a time with observable checkpoints | `INFRASTRUCTURE_SCALING_ANALYSIS.md` — execution plan |

## Recommended sequencing to first paid event

The estimates are focused engineering/operations person-days, not elapsed calendar time. Vendor KYC, bank settlement, legal review, DNS propagation, and participant recruitment can take longer and are excluded. Parallel work can shorten elapsed time but does not reduce total effort.

### What must be true before tickets are sold

1. **Freeze the event envelope and policy — 1–2 person-days.**
   - Set paid attendee capacity, `maxPublishers`, maximum received video tracks, resolution, session duration, and number of rehearsals.
   - Decide whether recording is off for launch. “Off” is the safer default until consent, dynamic track capture, R2 output, retention, and deletion are implemented.
   - Define cancellation/refund, transfer/gift, privacy, terms, recording consent, and incident authority.
   - Name the producer/incident commander and technical on-call person.

2. **Validate the commercial rail — 0.5–1 person-day plus external settlement time.**
   - Prefer a platform that can pay the Argentine entity through a verified existing rail. Ticket Tailor + PayPal is worth testing before Luma + Stripe.
   - Complete a real low-value ticket purchase, ticket email delivery, refund, chargeback procedure review, payout to AlterMundi’s bank, fee/FX reconciliation, and accounting export.
   - Do not count a platform as selected until this passes.

3. **Make admission paid, identity-bound, and reconnect-safe — 2–3 person-days.**
   - Add an explicit paid-event mode or entitlement/allowlist. In that mode, no entitlement means no LiveKit token.
   - Normalize and verify attendee email, or redeem a random unique code into a user-bound entitlement.
   - Redeem atomically; allow the same user to reconnect; support revoke, transfer, resend, refund, and operator override.
   - Add bulk CSV import/generation and tests for bypass, concurrency, expiry, sharing, rejoin, refund, and provider access.

4. **Keep launch authentication stable — 0.5–1 person-day.**
   - First try the pivot plan’s lower-risk action: relax Zitadel’s forced-MFA policy for listeners while retaining strong provider/admin controls.
   - Run a pre-event login clinic and document account recovery.
   - If Zitadel cannot provide acceptable attendee friction, implement only the smallest proven alternative and move the event date; do not combine an untested full identity migration with the first sale.

### What must be true before the first event starts

5. **Make the media path one-room-capable and operable — 3–5 person-days.**
   - Launch a selected file into the specific session with idempotent start/stop and visible health.
   - Distinguish bot/file audio from facilitator/speaker audio so the crossfader has independent gains.
   - Stop the global-beacon connection while a user is in a paid session, unless its quota/cost is explicitly accepted.
   - Provide an operator restart and a provider-local backup playback path. A constrained manual per-event publisher can reduce this to roughly 1–2 person-days for a pilot, but it must still be rehearsed.

6. **Move the event media to LiveKit Cloud — 1–2 person-days if recording is off; more if retained.**
   - Create production project/credentials, confirm concurrent-connection and subscription quotas, configure TURN behavior, and verify room/token/end-session paths.
   - If recording remains, first implement and test LiveKit egress to R2/S3-compatible output. LiveKit documents R2 through its S3-compatible output configuration ([LiveKit egress outputs](https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/)).
   - Test promotion/demotion, reconnect, provider disconnect, bot restart, and session termination.

7. **Remove the shared-server state dependency, if isolation is non-negotiable before payment — 7–11 person-days.**
   - **R2, 3–5 days:** storage interface, range/presigned delivery, copy and checksum verification, dual-read transition, upload/recording paths, deletion lifecycle.
   - **Neon, 2–3 days:** provision production and rehearsal branch, dump/restore, migration connection using the direct endpoint, application pooling, backup/restore drill, timed write freeze and cutover. Ensure health polling does not unintentionally keep compute active.
   - **Fly.io or isolated VM, 2–3 days:** app and publisher deployment, secrets/build-time LiveKit URL, immutable image, readiness, two-process lifecycle, smoke test, and real rollback.
   - These streams can overlap after interfaces are fixed. If 7–11 days cannot fit safely, use the isolated-VM bridge described below rather than a rushed partial managed migration.

8. **Install minimum observability and event operations — 1–2 person-days.**
   - External synthetic login/token/join test; app/database/R2/LiveKit/bot signals; operator dashboard; actionable alerts.
   - Runbook for admission support, bot/provider loss, region/vendor outage, capacity breach, event abort, customer communication, and refunds.
   - Avoid substituting the current liveness route for these checks.

9. **Rehearse and freeze — 1.5–2.5 person-days.**
   - Test purchase → ticket → identity → admission → join → refresh/rejoin → promote/demote → fallback → end/refund.
   - Load test at the enforced cap and at 1.5× the expected publisher count from Costa Rica, Argentina, North America, and Europe, including representative mobile devices and weak networks.
   - Run one no-developer-assisted dress rehearsal, fix blockers, then freeze production changes for at least 48 hours.

**Estimated minimum:** approximately **10–16 person-days** for a capped pilot using LiveKit Cloud, stable Zitadel, recording off, and a manual or modestly adapted publisher. A complete Neon + R2 + Fly/VM isolation migration raises this to approximately **17–27 person-days**, excluding legal/KYC elapsed time and unknown remediation from the load rehearsal. The corpus’s “weekend” framing is not credible for the full scope.

### Safe cutover order

If the whole isolation migration must happen before the paid event:

1. Fix admission and freeze session/media requirements.
2. Implement R2-backed storage and deletion, bulk-copy media, checksum it, and run dual-read before changing the database.
3. Rehearse PostgreSQL dump/restore into Neon; take a final backup; perform a short write freeze; migrate with the direct endpoint; run the application through a pooled connection.
4. Deploy immutable app and publisher images to Fly.io or an isolated VM against Neon/R2. Retain the previous environment as read-only rollback evidence, not a writable peer.
5. With recording disabled or R2 egress proven, switch scheduled-session media to LiveKit Cloud and run the complete synthetic journey.
6. Cut DNS/configuration with low TTL, observe through a rehearsal, and keep a timed rollback decision.
7. Freeze. Do not migrate identity during the same window.

If time is shorter, moving scheduled-session media to LiveKit Cloud first removes the most dangerous bandwidth/load coupling. An isolated application VM can then satisfy the isolation objective without simultaneously rewriting database, files, and identity.

### What can wait until after the first paid event

- Full Zitadel-to-Auth.js migration and removal of all `zitadelId` coupling.
- Self-hosted LiveKit economics testing; collect real participant-minute and downstream-GB data first.
- Video recording, composed recordings, attendee replay, and long retention.
- Multi-region app active/active, advanced tracing, automated ticketing webhooks, subscription plans, in-app payment, and polished analytics.
- A fully automated multi-session publisher fleet, if a safe operator-run publisher is sufficient for the capped pilot.
- Broad navigation/product cleanup unrelated to paid admission.

## Alternatives worth considering

1. **Ticket Tailor + PayPal instead of Luma + Stripe.** This is materially better aligned with an Argentine entity because Ticket Tailor supports a directly connected PayPal account, while Argentina is absent from Stripe’s merchant availability list. It is not automatically safe: AlterMundi must still pass KYC and test ARS withdrawal, fees, FX, refunds, and data export. The result of that test—not feature-list preference—should select the vendor.

2. **Keep Zitadel for the first paid event, then migrate.** The current application has extensive `zitadelId` coupling and an established roles flow. Relaxing attendee MFA while preserving provider/admin security removes less launch risk than introducing social providers, email delivery, new identity mappings, and new account-recovery paths at once. Auth.js can remain the destination.

3. **LiveKit Cloud with a hard 25–40 publisher circle.** This best matches a tiny team’s operational capacity. Use active-speaker/paginated subscriptions and measure actual downstream GB. Revisit a dedicated SFU only when several months of bills and load tests show a clear advantage. Do not self-host a 300-camera room based on the current benchmark reading.

4. **A dedicated isolated lift-and-shift VM as a bridge.** Move the existing app, PostgreSQL, files, and bot from the shared sensitive server to one dedicated VM, while putting paid-event media on LiveKit Cloud. This meets the primary isolation goal quickly, preserves a known stack, and allows Neon/R2 migration after the launch. It is not the final HA design, but it is safer than four simultaneous rewrites.

5. **A manual, per-event publisher as the pilot bridge.** An operator-started process with explicit `roomName` and file, health output, and a rehearsed local-provider fallback can validate the product before building a multi-tenant publisher service. It must not silently retain the global-room election logic.

6. **A conventional managed meeting as the emergency fallback.** A pre-created Zoom or similar meeting link is not a replacement for Harmonic Beacon’s differentiated crossfade experience, but it is a materially useful disaster path for a paid live event. The refund/communication runbook should state when the producer switches to it. Platform licensing and participant limits are **needs external verification**.

7. **R2 through its S3-compatible API without a Worker at first.** The corpus treats a Cloudflare Worker as a likely delivery layer, but server-generated short-lived access or an authenticated streaming route may be simpler for the first migration. Add a Worker only if measured delivery, authorization, or transformation needs justify another deployed component (`src/lib/stream-file.ts`; [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)).

Generic SFU replacements are not recommended for the launch. Daily, Twilio, Cloudflare Realtime, or a Zoom SDK would introduce a client/token/recording rewrite without resolving the product’s open camera policy or the team’s operational readiness. LiveKit Cloud preserves the current SDK and the option to return to the open-source server later.

## Open questions for the team

1. What are the sold attendee cap, expected attendance, `maxPublishers`, maximum visible/subscribed camera count, target resolution, and minimum supported phone?
2. During the camera exercise, do all 500 attendees receive the speaker circle, or are the 25–40 publishers isolated into a smaller room? This changes monthly media cost by roughly an order of magnitude.
3. Is recording a launch requirement? If yes, which tracks, when does consent occur, how long is it retained, who can play it, and how is deletion proven?
4. Can Zitadel forced MFA be disabled for listeners while remaining mandatory for providers/admins? Has this exact flow been tested on mobile?
5. Which legal entity is merchant of record, in which currency, through which payout rail, and has a complete purchase/refund/bank-settlement cycle succeeded?
6. How should transfers, gifted tickets, purchaser/attendee email mismatch, refunds, chargebacks, and support overrides change entitlement?
7. Who is the incident commander, event producer, technical on-call, customer communicator, and person authorized to abort/refund?
8. What are the explicit service objectives: maximum join delay, acceptable reconnection time, abort threshold, and refund trigger?
9. What is the actual sanitized production topology—host boundaries, LiveKit version/config, TURN, Redis, egress, backups, runner privileges, firewall, and restoration time?
10. What participant/geographic measurements support the chosen LiveKit region? Are Costa Rican mobile networks represented in the rehearsal?
11. Is full removal from the shared server a hard pre-sale condition, or can LiveKit Cloud plus a time-bounded isolated-VM bridge satisfy it?
12. What is the total monthly budget ceiling including ticket fees, FX, email, monitoring, redundant instances, recording, support labor, and taxes—not only infrastructure?
13. Who will review the privacy notice, terms, refund policy, recording consent, data-processor list, retention schedule, and cross-border transfer implications?
14. What immutable artifact and database state constitute rollback, and how many minutes after cutover is rollback still safe?
15. Which capabilities are explicitly excluded from the first paid event so the team can maintain a genuine freeze?
