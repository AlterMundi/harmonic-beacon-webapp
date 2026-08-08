# Founding Listener release-candidate handoff

Date: 2026-08-07

Public acceptance host: `https://listen.harmonicbeacon.com/`

Integration branch: `early-birds`

Draft pull request: `AlterMundi/harmonic-beacon-webapp#203`

This is the handoff for a bounded real public test. It does not authorize a
merge to `main`, a worldwide campaign, paid-provider activation, real charges,
an event-stack deployment or an acoustic change.

## Candidate identity

| Artifact | Exact value |
|---|---|
| Deployed Listener application | `20406dae49e8cbabba38d0cb099d8f400276113e` |
| Last runtime-changing branch head | `20406da` (documentation may advance independently) |
| Listener database schema | `20260807200000_listener_regional_presence` |
| Authority application | `21c3637ee0f520ee79d20c247e2914699ed8a73a` |
| Public mode | Free for All OFF during coordinated registered-Free acceptance |
| Immediate Listener rollback | `b8a04fe` |
| Additional Listener rollback | `2344b10` |

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
| Two-hour recurring Free window | Proven | Unit/integration matrix plus deployed registered-Free smoke for custom and Listen now. |
| One-time 30-minute first listen | Proven | Deployed protected smoke covered virgin state, explicit activation, exact duration, idempotent replay, lease/manifest cap and one-time rejection. |
| Seven-day change lock and idempotency | Proven | Runtime custom selection, exact replay and 409 cooldown response. |
| IANA zone, DST and server clock | Proven in tests | Spring gap, fall ambiguity, canonical zone and server-derived Listen now are deterministic. Human review covers comprehension only. |
| Current/next/change state | Deployed; human timing pending | The page arms server-boundary revalidation without continuous polling and has automated start/end tests. #216 retains the physical boundary gate. |
| Lease cannot outlive Free window | Proven | Runtime three-device smoke compared every lease expiry with the exact active end; manifest authorization repeats the same boundary. |
| Maximum two devices | Proven | Runtime third device displaced the oldest; its heartbeat returned 410 `displaced`; newest lease fetched signed HLS. |
| Canonical Founder access anytime | Proven | Canonical projection is evaluated before Free; ACTIVE/GRACE/paid-through and terminal/refund boundaries are tested and deployed. |
| Free/FFA never fabricate membership or Purchase | Proven | Separate schedule/technical-account tables and route-level override; no payment/Meta event is emitted by Listener paths. |
| FFA reversible | Proven | OFF denied anonymous lease; ON restored anonymous lease 200 without schema or membership mutation. |
| ES/EN and override | Proven | Locale default, explicit intro override, private byte ranges and distinct immutable assets pass tests/runtime. |
| Intro to Beacon lifecycle | Automated/browser and iPhone human proven | Intro play/pause/seek, natural handoff, mutual exclusion, live-edge Stop/rejoin and duplicate guards pass. Nico confirmed the deployed iPhone flow worked correctly after the gesture-safe fix. |
| Mobile one-screen interaction | Browser and iPhone proven; broader physical matrix pending | Chromium 390x844 has no overflow; mode targets are 52 px and primary action 56 px. iPhone playback passed; physical keyboard/screen-reader and Android/Firefox review remains. |
| Audio guardrail | Proven | Frozen-audio gate is green; this registration slice changed no asset, codec, rate, channel, gain, fade, buffer, routing or event audio. |
| App/origin/DB/canary | Proven | Public readiness, exact schema/SHA, stream health and decoded canary are green. |
| Telegram warning/critical/recovery | Proven | Dedicated delivery and recovery were exercised; Alertmanager currently has zero active alerts. |
| Storage | Proven | Approved media is on `/mnt/beacon-data`; after the final image build root retained about 65 GB free and the secondary volume remained about 6% used/89 GB free. |
| Capacity plan | Prepared, not measured | Deterministic external 3k/4k/5k shards are recorded. No same-host 150-client test or high-load claim was made. |
| Full gates | Proven | 1,222 tests with 19 standard skips, ESLint, TypeScript, build, Prisma, preview, origin, nginx and observability checks are green. PR #203 is clean and all required checks are green. |

## Delivered commits

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
  server-authorized Free, welcome, invitation or Founder access. It remains an
  independent, reversible operator override.
- Listener health/readiness, origin, PostgreSQL and decoded canary are green.
- Alertmanager has no active alert. A prior root-disk warning was real, then
  resolved after removing only old unreferenced Listener/authority image tags.
- Current image `20406da` and rollback images `b8a04fe` and `2344b10`, every
  active image, container, volume, database and approved media remain.
- The fixed public-disable command was exercised after deployment. Its first
  health probe observed the normal Next.js startup connection reset, retried,
  then proved liveness, readiness and anonymous lease denial before exiting 0.
- `live.harmonicbeacon.com`, LiveKit, event Beacon audio and the event database
  were not changed.

## GitHub coordination truth

- #214 is closed/Done: ordinary Free schedule.
- #195 remains open: measured external load/CDN rehearsal.
- #196 remains open only for Apple developer credentials and physical Apple
  acceptance; the real Google callback/logout/relogin passed.
- #197 remains open: separately approved paid-provider rollout; canonical
  membership consumption itself is complete.
- #198 remains open: physical acoustic/accessibility and 60-minute acceptance.
- #201 is In Progress: the human acceptance matrix.
- #216 is In Progress: the boundary implementation is deployed and needs only
  physical start/end confirmation.
- #217 remains open on the external Gmail delivery endpoint #44.
- #218 is closed/Done with deployed runtime evidence.
- #219 is closed/Done after positive physical iPhone acceptance of the deployed
  gesture-safe handoff.
- #210 remains open for the later auth/cookie and cross-repository namespace
  phases; runtime environment compatibility is merged and deployed.
- #213 remains open for the final public-human invitation/experience evidence.
- #211 is deployed; #212 remains feature-flagged pending visual acceptance and
  does not block the minimal public Listener.

## Remaining human sequence

Use `docs/operations/EARLY_BIRDS_FREE_ACCEPTANCE.md` as the authoritative
worksheet.

1. Complete one real Google sign-in through a valid synthetic invitation.
2. Confirm one scheduled Free start and end while the page remains open.
3. Complete the remaining physical Chrome, Firefox and Android Chrome rows;
   retain the accepted iPhone result.
4. Run one 60-minute physical listen with intro, handoff, background/foreground,
   network transition and Stop/rejoin.
5. Run stepwise load from external generators before claiming measured scale.

Do not select a user's Google account, provision Apple, charge a provider,
alter audio or merge/promote the branch as part of an automated test.

## Rollback

Run the fixed disable command from release `20406da` first. Restore the exact
root-only environment backup `/etc/harmonic-beacon/earlybirds-preview.env.pre-20406da`,
select Listener image `b8a04fe` (or `2344b10` for the preceding compatibility
release), retain the
preview database and origin media, recreate only the isolated Listener, run
`nginx -t` before any reload and execute the complete preview health/access
smoke. Do not roll back the additive database schema.

To end a public Free for All moment without rolling back code, set only the FFA
switch to OFF, recreate only the isolated Listener and verify anonymous
lease/manifest denial. Already signed or buffered media may drain for the short
manifest/signature horizon.
