# Founding Listener release-candidate handoff

Date: 2026-08-09

Public acceptance host: `https://listen.harmonicbeacon.com/`

Integration branch: `early-birds`

Draft pull request: `AlterMundi/harmonic-beacon-webapp#203`

This is the handoff for a bounded real public test. It does not authorize a
merge to `main`, a worldwide campaign, paid-provider activation, real charges,
an event-stack deployment or an acoustic change.

## Current commercial checkpoint — 2026-08-12

The weekly-Free candidate has advanced to a complete Founding Listener pre-release lane:

- canonical uninterrupted Founder continuity and USD 5/month offer;
- PayPal Sandbox and Mercado Pago TEST browser acceptance;
- self-service cancel/reactivate and terminal Free fallback;
- private paid-operation metrics, alerts, backup/restore and sales kill switches;
- production provider adapters and public checkout present but fail-closed/default-off.

The release is not yet authorized for real sales. Backend magic-link delivery is merged at
`SairaAsua/proyecciones-mito@c443a7ec9b387fa54ff16904e1a5d561613ec102` but still needs an event-safe
runtime rollout. Remaining gates also include final ES/EN legal/copy review, controlled rotation of the exposed Google OAuth
client secret, protected PayPal/MP Live credentials, one supervised low-value Live lifecycle per
provider, a hermetic font build and explicit main/public-sales approval. See
`docs/operations/FOUNDING_LISTENER_COMMERCIAL_LAUNCH.md` and issue #315 for the current checklist.

## Status: weekly Free deployed for acceptance

Release `1f8368d2fda19b30b74c95af884d862838f73305` is deployed on the isolated
Listener. The active policy is three hours per account per fixed seven-day cycle,
anchored at first real authorized Free playback, with no base rollover and
server-time metering. Two devices consume their listening union once; intro and
Beacon both count; Stop/disconnect are bounded by leases. Active canonical
membership/invitation and FFA remain unlimited/non-metered. Optional credits
use auditable idempotent grants with immutable facts, a monotonic consumed
total and optional expiry. Daily scheduling and the separate welcome grant are
absent from UI and authorization; their public APIs return 404.

This remains an experimental pre-release. Prior Free-policy clients and
binaries are unsupported. Recovery means stop/kill-switch and roll-forward
repair, never restoring daily/welcome authorization.

## Candidate identity

| Artifact | Exact value |
|---|---|
| Deployed Listener application | `1f8368d2fda19b30b74c95af884d862838f73305` |
| Operational smoke/documentation head | `8444ed7d06b2764c519f65ce4d32932346a94fdd` |
| Listener database schema | `20260808160000_listener_weekly_quota` |
| Authority application | `21c3637ee0f520ee79d20c247e2914699ed8a73a` |
| Public mode | Free for All OFF during coordinated registered-Free acceptance |
| Recovery | Stop/kill-switch and roll forward; old policy images unsupported |

Health must attest the deployed application SHA, not the later documentation or
test-only branch head.

## Completion matrix

| Requirement | State | Authoritative evidence |
|---|---|---|
| Ordinary Free requires identity when FFA is OFF | Proven | Runtime anonymous lease returned 401; protected synthetic identity completed schedule and stream flow. |
| Google authorization start | Proven | Real Chromium reached Google's chooser with exact Listener callback, one-time state and PKCE S256. |
| Google provider callback and account return | Human proven | A supervised human completed real Google sign-in, logout and sign-in again. A sanitized database audit found one recent provider identity/session while OAuth tokens, session IP and user-agent remained absent. |
| Apple identity | External blocker | Apple Developer Program login/2FA, App ID, Services ID, key/team identifiers, private key and generated client-secret JWT are absent. Provider stays hidden. |
| Public email/password and synthetic entry absent | Proven | Listener edge returns 404 for email sign-in, test-login and internal/event/staff surfaces. Public invitation redemption is an explicit, bounded exception below. |
| Public invitation redemption | Deployed; one human gate remains | Staging bearer entry redirects once to canonical `listen`; staging cannot mint the cookie or accept redemption. Canonical HTTPS+Host+Origin is the only mutation boundary, bearer paths are unlogged/no-store/no-referrer and terminal cookies are cleared. Automated nginx/browser negatives pass; one real Google+valid-invitation flow remains. |
| OAuth/session privacy and CSRF boundary | Proven | Exact-Origin mutation gate, callback state/cookie+PKCE, token scrubbing, zero persisted session IP/user-agent and logout tests/runtime smoke. |
| Passwordless email fallback | Listener ready; authority blocked | #221 is merged and hidden/fail-closed until the existing Gmail authority implements `SairaAsua/proyecciones-mito#44` and protected delivery values are installed. |
| Three-hour weekly Free quota | Proven | Unit/integration/PostgreSQL matrix plus deployed virgin-account smoke. |
| First-play cycle anchor | Proven | Page view and lease preparation do not anchor; the first authorized listening transition creates one immutable anchor. |
| Exact seven-day reset/no rollover | Proven | Server-clock cycle arithmetic, multi-cycle inactivity and reset tests are green. |
| Browser clock/timezone independence | Proven | Authorization and countdown derive from server time; no timezone or DST input remains. |
| Live remaining/renewal state | Deployed; human timing pending | Countdown follows server snapshots, Stop halts consumption and boundary retries revalidate without reload. |
| Lease cannot outlive quota | Proven | Lease/heartbeat/manifest all repeat the same account lock, settlement and exhaustion boundary. |
| Maximum two devices | Proven | Runtime third device displaced the oldest; its heartbeat returned 410 `displaced`; newest lease fetched signed HLS. |
| Canonical Founder access anytime | Proven | Canonical projection is evaluated before Free; ACTIVE/GRACE/paid-through and terminal/refund boundaries are tested and deployed. |
| Free/FFA never fabricate membership or Purchase | Proven | Separate schedule/technical-account tables and route-level override; no payment/Meta event is emitted by Listener paths. |
| FFA reversible | Proven | OFF denied anonymous lease; ON restored anonymous lease 200 without schema or membership mutation. |
| ES/EN and override | Proven | Locale default, explicit intro override, private byte ranges and distinct immutable assets pass tests/runtime. The deployed Free-account smoke proved Spanish returns authorized `206 audio/mp4` instead of a false membership denial under concurrent lease signaling. |
| Intro to Beacon lifecycle | Automated/browser and iPhone human proven | Intro play/pause/seek, natural handoff, mutual exclusion, live-edge Stop/rejoin and duplicate guards pass. Nico confirmed the deployed iPhone flow worked correctly after the gesture-safe fix. |
| Mobile one-screen interaction | Browser and iPhone proven; broader physical matrix pending | Chromium 390x844 has no overflow; mode targets are 52 px and primary action 56 px. iPhone playback passed; physical keyboard/screen-reader and Android/Firefox review remains. |
| Audio guardrail | Proven | Frozen-audio gate is green; the public field uses server-side analysis and changed no asset, codec, rate, channel, gain, fade, buffer, routing or event audio. |
| Reactive harmonic field | Deployed; extended physical matrix pending | Nico accepted the selected Radial ribbons preset after confirming correct intro and Beacon audio. Public frames require the active listening lease; the technical Lab is default-off and staging-only. |
| App/origin/DB/canary | Proven | Public readiness, exact schema/SHA, stream health and decoded canary are green. |
| Telegram warning/critical/recovery | Proven | Dedicated delivery and recovery were exercised; Alertmanager currently has zero active alerts. |
| Storage | Proven | Approved media is on `/mnt/beacon-data`; after the final image build root retained about 65 GB free and the secondary volume remained about 6% used/89 GB free. |
| Capacity plan | Prepared, not measured | Deterministic external 3k/4k/5k shards are recorded. No same-host 150-client test or high-load claim was made. |
| Full gates | Proven | 1,461 tests with 28 standard skips, ESLint, TypeScript, build, Prisma, preview, origin and nginx checks are green for the deployed visual release. |

## Delivered commits

- `f8a8ece` — server-owned weekly quota, grants, leases and migrations;
- `af5ae6a`, `f5a8152` — generation/sequence playback signaling and duplicated-tab identity isolation;
- `407516d` — rollout, FFA quiescence, future-effective membership and operational hardening;
- `808bf0e` — removal of pre-release daily/welcome APIs and implicit old-client defaults;
- `8444ed7` — exact deployed weekly runtime smoke.
- `7036eb3` — human-readable renewal countdown in days and hours.
- `6a5d4b6` — explicitly approved 70% initial Listener volume.
- `68b930c` — one-checkbox introduction choice and readable dark select menu.
- `49fd9c8` — truthful prepared-source lifecycle, coherent Pause/Stop layout,
  unified control panel and bottom weekly status/membership action.
- `ae1d0ba` — Free-authorized ES/EN intro range delivery under quota/heartbeat
  contention, with bounded serialization retry and recoverable UI failure.
- `1f8368d` — accepted server-analyzed Radial ribbons field on the canonical
  Listener, with the Reactive Field Lab default-off and staging-only.

Historical pre-weekly experiments:

- `d7ed952` — recurring registered-Free windows and combined access authority;
- `4b9e0fa` — exact-Origin auth mutation gate and session metadata scrubbing;
- `575b75a` — logout outside a Free window;
- `637c5e0` — deployed identity/Free operational evidence;
- `e0bc329`, `d4a7986` — current public acceptance runbook;
- `aba2057` — reproducible deployed registered-Free runtime smoke;
- `a21273a` — passwordless email fallback seam, hidden until delivery exists;
- `55bf282` — iPhone gesture-safe intro handoff;
- `dad29d4` — one-time welcome access and boundary synchronization;
- `b843c7d` / merge `2de5923` — truthful failures, locale-safe SSR and responsive/accessibility hardening;
- `563bebf` / merge `67ceefc` — canonical, privacy-preserving public invitation redemption;
- `c7145a1` / merge `2344b10` — bounded Listener runtime namespace compatibility;
- `497772c` / merge `b8a04fe` — startup-tolerant public disable/kill-switch verification.
- `200242d` / merge `20406da` — canonical-first invitation cookie with
  rollback-compatible dual-write, conflict rejection and dual-clear.

PR #203 remains draft and mergeable. The exact application SHA above is the
deployed image; later documentation-only commits do not require rebuilding it.

## Current runtime and operations

- Listener, PostgreSQL and stream origin are isolated from the event project.
- Free for All is OFF so ordinary public access requires canonical identity and
  server-authorized weekly Free quota, invitation or Founder access. It remains an
  independent, reversible operator override.
- Listener health/readiness, origin, PostgreSQL and decoded canary are green.
- Alertmanager has no active alert. A prior root-disk warning was real, then
  resolved after removing only old unreferenced Listener/authority image tags.
- Current image is `1f8368d`. Image `ae1d0ba` remains the same-schema recovery
  target for this visual-only release; earlier policy images are historical and
  are not valid rollback targets.
- The fixed public-disable command was exercised after deployment. Its first
  health probe observed the normal Next.js startup connection reset, retried,
  then proved liveness, readiness and anonymous lease denial before exiting 0.
- `live.harmonicbeacon.com`, LiveKit, event Beacon audio and the event database
  were not changed.

## GitHub coordination truth

- #214 is implemented and deployed as ordinary weekly Free quota.
- #195 remains open: measured external load/CDN rehearsal.
- #196 remains open only for Apple developer credentials and physical Apple
  acceptance; the real Google callback/logout/relogin passed.
- #197's continuity-bound authority/Listener correction is merged and deployed to
  isolated staging. Byte-exact contracts, terminal tombstones, uninterrupted
  Founder semantics and synthetic pre-release retirement are proven. The card can
  close independently of provider activation.
- #198 remains open: physical acoustic/accessibility and 60-minute acceptance.
- #201 is In Progress: the human acceptance matrix.
- #216's old daily-window acceptance is obsolete; weekly reset/countdown human
  acceptance replaces it.
- #217 remains open while backend #44 is merged but not yet deployed to the
  shared PMP email runtime. Its rollout needs an event-safe maintenance window,
  a dedicated service token and one controlled Gmail callback smoke.
- #218 is closed/Done with deployed runtime evidence.
- #219 is closed/Done after positive physical iPhone acceptance of the deployed
  gesture-safe handoff.
- #210 remains open for the later auth/cookie and cross-repository namespace
  phases; runtime environment compatibility is merged and deployed.
- #213 remains open for the final public-human invitation/experience evidence.
- #211 is deployed. #212's accepted field is public; its technical laboratory
  remains default-off and can be re-enabled only on staging for later variants.
- #199/#200 have fresh provider evidence: PayPal Sandbox completed USD 5
  activation, cancel-pending-end, reversal and terminal refund; Mercado Pago TEST
  completed checkout, pause, reactivation and reconciliation. Both adapters and
  their production lanes remain default-off. No Live credential, public checkout
  flag or real sale is active.

## Remaining human sequence

Use `docs/operations/EARLY_BIRDS_FREE_ACCEPTANCE.md` as the authoritative
worksheet.

1. Review and accept the final ES/EN offer, seller, cancellation/refund, privacy
   and support copy.
2. Rotate the exposed Google OAuth client secret through the protected store and
   re-run callback/logout without printing it.
3. Self-host the approved fonts so the release build has no Google Fonts network dependency (#327).
4. Deploy backend #44 in an event-safe maintenance window and prove one controlled
   magic-link request, email, callback and Free entry.
5. Install protected PayPal and Mercado Pago Live credentials with all sales
   flags still OFF, then run one explicitly approved low-value lifecycle per provider.
6. Approve merge to `main` and public checkout separately; retain the immediate
   new-sales kill switch throughout launch.

Do not select a user's Google account, provision Apple, charge a provider,
alter audio or merge/promote the branch as part of an automated test.

## Recovery after the weekly migration

Previous experimental policy images are unsupported. Disable or stop only the
Listener, retain PostgreSQL and origin media, repair forward from the weekly
schema and rerun the complete health/access smoke. Do not down-migrate or
restore daily-schedule/welcome authorization.

To end a public Free for All moment without rolling back code, set only the FFA
switch to OFF, recreate only the isolated Listener and verify anonymous
lease/manifest denial. Already signed or buffered media may drain for the short
manifest/signature horizon.
