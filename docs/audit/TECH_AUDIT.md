# Tech Audit — Claims in the Product & Policy Docs vs. the Codebase

*Audit date: 2026-06-09 · Scope: the `docs/` policy corpus + `BUSINESS_RULES.md`; infra readmes in Appendix A · Repo state: commit `b72b279` · See [README.md](./README.md) for methodology and severity scale.*

Every present-tense system claim in the policy docs was checked against the code. Each finding gives the doc claim, the code evidence, and a recommended fix: **BUILD** (implement before release), **RE-TENSE** (rewrite the doc as a phase-tagged commitment), or **CORRECT** (the doc is simply wrong about the code).

What checked out — for the record, these doc claims are **accurate**: `UserRole`/`ModerationStatus`/`TagCategory` enums, `isPublished`/`isFeatured`/`isHidden`/`defaultMix`/`originalPath` fields (`prisma/schema.prisma:16-105`); `ListeningSession`, `ScheduledSession`, `SessionRecording`, `SessionInvite`, `Favorite` models (`schema.prisma:151-267`); LiveKit topology `wss://live.altermundi.net` / room `beacon` / identity `beacon01` (`src/context/AudioContext.tsx:7,78`, `src/app/api/livekit/token/route.ts`); go2rtc on-demand stream creation with `#audio=opus` (`src/app/api/meditations/route.ts:160-206`); playlist-bot fallback publisher exists and reacts to `beacon01` presence (`services/playlist-bot/src/index.ts:240-288`); nginx rate limiting (`deploy/nginx-harmonic-beacon.conf:27-29`); repo-layout section of root README; no secrets in git history (full scan, all commits).

---

## BLOCKER — guaranteed user-facing mechanisms that do not exist

### T1 — Data export and account deletion endpoints

- **Claim**: `BUSINESS_RULES.md:31,279-281` — one-click export via `/api/users/me/export`; deletion via `DELETE /api/users/me` purging identifiable data within 30 days.
- **Code**: `src/app/api/users/me/route.ts` exports **GET only** (59 lines). No export route, no DELETE handler, no purge job anywhere.
- **Fix**: **BUILD** — this is the one gap that should be closed in code rather than in prose: both endpoints are small (the export is a few Prisma queries serialized to JSON; deletion is a cascade the schema mostly already supports), and they underwrite the corpus's central data-rights promises. Until merged, RE-TENSE the two doc lines.

### T2 — Audit log

- **Claim**: `BUSINESS_RULES.md:62` "Every administrative action is written to the audit log"; relied on throughout (`TRUST_AND_SAFETY.md:41-43` role-change events, `PHASE_2:133` financial events).
- **Code**: No `AuditLog` model in `prisma/schema.prisma` (ends at line 285); zero hits for any audit mechanism in `src/`.
- **Fix**: **BUILD** (append-only table + a `logAdminAction()` helper called from the existing admin routes is a day of work and is listed as a Phase 1 deliverable anyway, `PHASE_1:63`) or RE-TENSE every present-tense reference.

### T3 — Report system and session kill switch

- **Claim**: `BUSINESS_RULES.md:302-304` "Every scheduled session has an Admin-accessible kill-switch. Every content surface… has a report button. Reports are acknowledged within 24 hours"; full kill-switch spec in `TRUST_AND_SAFETY.md` §4; report capture spec in §2.5.
- **Code**: No `Report` model, no report endpoints, no report UI. No admin room-termination endpoint — the only session-end path is the Provider ending **their own** session (`src/app/api/provider/sessions/[id]/route.ts:125-181`).
- **Fix**: **RE-TENSE now; BUILD before any open signup.** These are the safety affordances the T&S doc stakes the brand on; flipping the repo public with the spec visible and the buttons absent is the worst of both.

### T4 — Signup/identity controls: CAPTCHA, email verification, rate limit, age gate

- **Claim**: `TRUST_AND_SAFETY.md:32-36` (CAPTCHA, email verification before first listen, per-IP signup rate limit, disposable-email scoring); `PHASE_1:38` + `RESEARCH_PROTOCOL.md:43` (18+ age gate, minors blocked from research).
- **Code**: None of it. Auth is Zitadel OIDC (`src/lib/auth-config.ts`); the app applies no gates of its own. Some controls may legitimately live in Zitadel — but nothing verifies or documents that configuration, and the docs claim them as platform properties.
- **Fix**: **CORRECT + RE-TENSE** — restate which controls are delegated to Zitadel (and verify them there, recording the config), which are app-level and unbuilt (age gate, listen-gating), and phase-tag the latter.

### T5 — "PII in logs is mechanically filtered" — the code does the opposite

- **Claim**: `TRUST_AND_SAFETY.md:66`; `PRODUCT_PRINCIPLES.md:58` "No logging PII to anywhere we can't purge."
- **Code**: `src/lib/auth-config.ts:89` — `` console.log(`[auth] jwt sync: sub=${token.sub} email=${token.email} role=${dbRole}`) `` logs subject ID + email on every JWT sync; `:57` logs the full roles claim. Container stdout ends up in Docker logs on the host — unpurgeable in practice.
- **Fix**: **BUILD (trivial)** — strip/mask the email from both log lines this week, regardless of release timing. Then RE-TENSE the "mechanically filtered" claim until structured logging (Phase 1 deliverable) exists.

### T6 — Public policy/transparency pages

- **Claim**: routes referenced as live surfaces — `/privacy`, `/terms` (`PHASE_1:32-33`), `/research` (`RESEARCH_PROTOCOL.md:149`), `/policy/content` (`CONTENT_POLICY.md:239`), `/trust` (`TRUST_AND_SAFETY.md:201`), `/incidents` (`TRUST_AND_SAFETY.md:92`), `/hearth` (`PHASE_2:42`), status page (`SLO.md` §7).
- **Code**: None exist. `src/app/` contains only: `admin`, `api`, `join`, `live`, `login`, `meditation`, `playback`, `profile`, `provider`, `session`, `sessions`, `settings`.
- **Fix**: **RE-TENSE** (most are explicitly Phase 1–2 deliverables; the furcio is the docs that cite them as present locations, e.g. CONTENT_POLICY §9 "We publish, at `/policy/content`").

---

## HIGH — policy logic the code does not enforce

### T7 — Business rules stated as system behavior with no enforcement

| Rule as documented | Where | Code reality |
|---|---|---|
| `completed` = durationSeconds ≥ 0.85 × duration (MEDITATION) / ≥60s (LIVE); finalized on 30-min inactivity | `BUSINESS_RULES.md:114-115` | Client sets `completed` arbitrarily; server applies `body.completed ?? true` with no validation (`src/app/api/sessions/[id]/route.ts:125`). No inactivity finalizer exists. |
| SCHEDULED→LIVE only within −10/+60 min of `scheduledAt` without admin override | `BUSINESS_RULES.md:104` | Start action checks only `status !== 'SCHEDULED'` (`src/app/api/provider/sessions/[id]/route.ts:111-123`). |
| Session exceeding declared duration by 100% auto-flagged | `BUSINESS_RULES.md:107` | No such mechanism. |
| LANGUAGE tag + one of MOOD/TECHNIQUE/DURATION required at publication | `BUSINESS_RULES.md:96-97`, `CONTENT_POLICY.md:36-38` | Admin approval endpoint performs no tag validation (`src/app/api/admin/meditations/[id]/route.ts:54-86`). |
| Two-reviewer approval for first-submission providers | `BUSINESS_RULES.md:159`, `CONTENT_POLICY.md:99` | Single-approver UI only (`src/app/admin/moderation/page.tsx`). |

- **Fix**: Each row: **BUILD** if the rule should bind at launch, otherwise **RE-TENSE**. Recommended minimum builds: the server-side `completed` computation (research integrity and future revshare attribution both depend on `ListeningSession` being trustworthy — `MONETIZATION.md:130` calls it "auditable from the ListeningSession ledger", which it currently is not) and the tag check at approval (one query in the approval handler).

### T8 — The "Hidden" content state is defined two contradictory ways

- **Claim**: `BUSINESS_RULES.md:93` (lifecycle table): Hidden = `ModerationStatus: APPROVED`, `isPublished: true`, `isHidden: true`. But `CONTENT_POLICY.md:174` (takedown workflow): "Admin moves content to `isHidden=true`, **`isPublished=false`**."
- **Problem**: The canonical table and the operational workflow disagree on the flag combination. Whichever the code eventually enforces, queries written from the other doc will leak or lose hidden content (e.g., a "visible = published && !hidden" filter behaves differently under each definition).
- **Fix**: **CORRECT** — pick one (the table's version preserves the pre-takedown publication state, which is more informative; the workflow's version is safer-by-default). Document the chosen invariant next to the schema.

### T9 — Continuity claims: standby, transition UI, client contract

- **Claims vs code**:
  - "warm-standby upstream" listed in the *current* source hierarchy (`BUSINESS_RULES.md:262`) — `beacon02` exists nowhere in code (only as Phase 1 *plan* in `SLO.md` §3 and `PHASE_1:68`). The BUSINESS_RULES phrasing presents it as already part of the documented hierarchy.
  - "fallback… surfaced to the listener as a 'Beacon in transit' state" (`BUSINESS_RULES.md:235`); "the UI tells the truth about it" (`SLO.md` §1) — **no source-state UI exists**. The client silently mutes/unmutes fallback audio on `beacon01` presence (`src/context/AudioContext.tsx:104-144,185`). Today a listener hearing the fallback has no indication it is not live — the exact situation `SLO.md:20` calls deception and `TRUST_AND_SAFETY.md:216` says "we do not" do.
  - Client contract `SLO.md` §8 ("These are **enforced in code review**"): exponential backoff to 15 min — not present; 30-second local audio cache — not present; transparent token refresh — only whatever the LiveKit SDK does by default.
  - "playlist-fallback switchover (already implemented) … < 10-second handover" (`SLO.md:87`) — the bot publishes on disconnect events with no measured/tuned handover bound (`services/playlist-bot/src/index.ts:240-288`); "10 seconds" appears nowhere in code.
- **Fix**: **BUILD the source-state UI first** — it is the smallest piece (the client already knows `beacon01` presence; render it) and it converts the continuity story from misleading to honest even while standby/backoff remain roadmap. RE-TENSE beacon02, the client contract, and the 10-second figure (or measure and then claim it).

### T10 — Research, monetization, and community schema described in operative detail with zero schema presence

- **Claim**: operative references to `ConsentRecord`, `ResearchParticipant`, `SurveyInstrument`, `SurveyResponse`, `rpid` (`PHASE_1:86-88`, `RESEARCH_PROTOCOL.md` §4), `Patronage` (`PHASE_2:33`), `JournalEntry`, `Sitting`, `ProviderApplication`, `PayoutStatement` (`PHASE_2`), pseudonymization pipeline diagram (`RESEARCH_PROTOCOL.md:103-116`).
- **Code**: none of these models exist (`prisma/schema.prisma` ends at `SessionParticipant`, line 285).
- **Assessment**: Mostly **correctly tensed** — the phase docs label these as deliverables. The furcios are the places that slip into present tense: `BUSINESS_RULES.md` §6 (research rules as operative), `RESEARCH_PROTOCOL.md:118` (processor claim, see LEGAL L14), `RESEARCH_PROTOCOL.md:99` (classification "is" three levels). **RE-TENSE** those specific spots.

### T11 — Role mapping diverges from the documented model

- **Claim**: `BUSINESS_RULES.md:13` — roles "synchronized via Zitadel (`BEAC_ADMIN`, `BEAC_PROVIDER`, `BEAC_LISTENER`)".
- **Code**: `src/lib/auth-config.ts:59-63` — checks `BEAC_ADMIN`, `BEAC_PROVIDER`, **and a legacy undocumented `certified_provider` claim**; `BEAC_LISTENER` is never read (absence of the other two → default). Internal role type uses `'USER'` as the default string, mapped to `LISTENER` only at DB sync (`auth-config.ts:87`).
- **Fix**: **CORRECT** the doc (listener-by-default, no claim required) and **decide** whether `certified_provider` is still a valid grant path — an undocumented role-granting claim is exactly what `TRUST_AND_SAFETY.md` §2.2's "role changes logged" posture should not tolerate.

### T12 — Observability stack claimed/relied on, none present

- **Claim**: `SLO.md` §9 (structured logs, metrics, traces, Sentry, external uptime monitor, alerts); `TRUST_AND_SAFETY.md:71-74` (healthchecks ✓ exist, external monitor ✗, WAF ✗ — plain nginx rate-limit only).
- **Code**: zero hits for Sentry or any structured-logging/metrics library; only ad-hoc `console.log`. Container healthchecks do exist (`docker-compose.yml:45-114`).
- **Fix**: **RE-TENSE** (Phase 1 already owns this work, `PHASE_1:57-65`); keep §9 as the target spec, but the SLO doc's measurement table (`SLO.md` §2 "How measured") should say "to be measured by", because today none of the listed measurement mechanisms exist — publishing SLO targets with no measurement apparatus invites the "show me the number" question with no answer.

---

## MEDIUM

### T13 — Resonance Journal encryption design is impossible under the current auth architecture

- **Claim**: `PHASE_2:93-94` — journal body "encrypted at rest with a key derived from the user's secret (so even Admin cannot read it)"; risk table `PHASE_2:159` — "Key derived from **user's password** with recovery-phrase option."
- **Problem**: Authentication is Zitadel OIDC with PKCE; **the application never possesses a user password** to derive a key from. As designed, the feature cannot be built. Additionally `BUSINESS_RULES.md:244` says the research layer can (with consent) read journal fields — contradicting "only the Listener can read" unless the design separates encrypted body from plaintext structured fields (which `PHASE_2:95` does say — the contradiction is in `BUSINESS_RULES.md:244`'s phrasing "only the Listener (and… the research layer) can read **them**" applying to entries wholesale).
- **Fix**: **CORRECT** the design before Phase 2: client-held key material (WebCrypto + recovery phrase), or app-managed encryption with an honest "Admin-resistant, not Admin-proof" claim. Align `BUSINESS_RULES.md` §7.3 wording with the body-vs-fields split.

### T14 — Commons commitment has no mechanism

- **Claim**: `BUSINESS_RULES.md:177` — Commons of "minimum 15 [published meditations] at any time across the top tag categories"; `MONETIZATION.md:67` "15 published meditations rotating monthly."
- **Code**: no rotation mechanism, no count guard, and (pre-monetization) no free/patron distinction at all — currently everything published is available to everyone, which exceeds the commitment but means the "minimum 15" floor exists nowhere.
- **Fix**: **RE-TENSE**; when patronage ships, the floor needs an actual guard (an admin dashboard warning is enough) or the commitment becomes silently breachable.

### T15 — Doc-internal numeric/SLA inconsistencies

1. S1 comms: 6h (`TRUST_AND_SAFETY.md:86`) vs 24h (`:129`) — see LEGAL L18.1.
2. Kindred private sittings "up to 6 co-listeners" (`MONETIZATION.md:33`) vs sittings capacity caps "e.g. 50" (`PHASE_2:157`) — different surfaces, but a reader can't tell; clarify.
3. `SLO.md:33` publishes a **mobile crash-free SLO** at launch tier when no mobile app exists (and the `feat/flutter-migration` branch named in `PHASE_2:185`/`PHASE_3:28` **does not exist** — branches are `main` and `release` only; no Flutter or Expo code anywhere in history). The mobile premise of Phase 3 currently has no code substrate; re-tag the branch reference to "to be created" or restore the missing branch from wherever it lives.
4. `docs/README.md:43` instructs editors to preserve the draft-status line — good; but `README.md:81` then markets those drafts as "enforceable" (LEGAL L7). The two should be reconciled in the same PR.

### T16 — i18n status

- **Claim**: EN/ES parity is consistently and honestly marked as Phase 1 work (`PHASE_1:102-105`). Accurate.
- **Code reality worth noting**: today's "language support" is a settings dropdown writing `app_language` to localStorage with no message catalogs (`src/app/settings/page.tsx:8-30`) — i.e., a control that visibly does nothing. Minor, but it's user-visible vaporware of the same species this audit exists to catch.
- **Fix**: hide the dropdown until next-intl lands, or label it.

---

## Appendix A — infra/dev readmes (outside the policy corpus; for completeness)

1. **`deploy/README.md:67`** — wrong env var name and wrong path: documents `MEDITATIONS_PATH=/mnt/raid1/harmonic-beacon/meditations`; the code reads **`MEDITATIONS_STORAGE_PATH`** and production mounts **`/mnt/n8n-data/harmonic-beacon/meditations`** (`docker-compose.yml:32,37`; the readme's own troubleshooting section at `:113` uses the correct path). Following the config section as written breaks the deploy. **CORRECT.**
2. **`deploy/README.md:61`** — "Create `.env` at project root" contradicts both `.env.example:5` ("no .env files on server") and the actual mechanism: CI writes `/etc/sai-harmonic-beacon/production.env` (`.github/workflows/deploy.yml:36-50`), which `TRUST_AND_SAFETY.md:67` gets right. Three docs, three stories; one is true. **CORRECT** the readme and the `.env.example` comment (it predates commit `6b5918e`).
3. **Operational exposure decision**: `deploy/README.md` publishes the production IP (`131.72.205.6`, `:68,104`), runner home path (`:46`), internal ports and storage paths. None are secrets, but together they are a tidy reconnaissance page. Decide deliberately whether `deploy/` stays in the public repo, gets genericized, or moves to a private ops repo. (Git history is clean: full-history scan found no committed secrets; only `.env.example` files were ever added.)
4. **`deploy/README.md` "Prisma migrations run automatically"** — true via CI on the host before containers start (`deploy.yml:25-28`), not inside the compose lifecycle; fine, but clarify for whoever does a manual deploy (the manual-deploy section omits the migrate step entirely — a real foot-gun). **CORRECT.**
5. **`TESTING.md`, `go2rtc/README.md`, `public/*/README.md`** — verified accurate (console strings exist at `src/context/AudioContext.tsx:316-349`; POST `/api/meditations` does create streams as described; `/data/meditations` is the in-container path, accurate in context).

---

## Suggested execution order (tech team)

1. **This week, regardless of release date**: T5 (strip email from logs — two lines), T11 decision on `certified_provider`.
2. **Before repo goes public**: T1 (export + delete endpoints), T8 (pick the Hidden invariant), Appendix A.1/A.2 (deploy doc corrections), A.3 (deploy-dir exposure decision), and the global re-tense pass over BUSINESS_RULES/T&S/SLO present-tense claims (T2, T3, T4, T6, T9, T10, T12).
3. **Before open signup**: T3 (reports + kill switch), T4 (age gate), T7 minimum builds (`completed` server-side, tag check), T9 source-state UI.
4. **Phase-gated as already planned**: everything else, with the docs now telling the truth about the gate.
