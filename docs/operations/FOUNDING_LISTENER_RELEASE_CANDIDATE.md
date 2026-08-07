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
| Deployed Listener application | `dad29d4dc5010603a5bbc7ed309c8f78e7c0f384` |
| Branch/documentation head | `dad29d4` |
| Listener database schema | `20260807100000_early_bird_welcome_access` |
| Authority application | `21c3637ee0f520ee79d20c247e2914699ed8a73a` |
| Public mode | Free for All OFF during coordinated registered-Free acceptance |
| Immediate Listener rollback | `55bf282` |
| Additional Listener rollback | `575b75a` |

Health must attest the deployed application SHA, not the later documentation or
test-only branch head.

## Completion matrix

| Requirement | State | Authoritative evidence |
|---|---|---|
| Ordinary Free requires identity when FFA is OFF | Proven | Runtime anonymous lease returned 401; protected synthetic identity completed schedule and stream flow. |
| Google authorization start | Proven | Real Chromium reached Google's chooser with exact Listener callback, one-time state and PKCE S256. |
| Google provider callback and account return | Human proven | A supervised human completed real Google sign-in, logout and sign-in again. A sanitized database audit found one recent provider identity/session while OAuth tokens, session IP and user-agent remained absent. |
| Apple identity | External blocker | Apple Developer Program login/2FA, App ID, Services ID, key/team identifiers, private key and generated client-secret JWT are absent. Provider stays hidden. |
| Public email/password and synthetic entry absent | Proven | Listener edge returns 404 for email sign-in, test-login, invitation/internal/event/staff surfaces. |
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
| Intro to Beacon lifecycle | Automated/browser proven; physical pending | Intro play/pause/seek, natural handoff, mutual exclusion, live-edge Stop/rejoin and duplicate guards pass. Acoustic/device acceptance remains human. |
| Mobile one-screen interaction | Browser proven; physical pending | Chromium 390x844 has no overflow; mode targets are 52 px and primary action 56 px. Physical keyboard/screen-reader/touch review remains. |
| Audio guardrail | Proven | Frozen-audio gate is green; this registration slice changed no asset, codec, rate, channel, gain, fade, buffer, routing or event audio. |
| App/origin/DB/canary | Proven | Public readiness, exact schema/SHA, stream health and decoded canary are green. |
| Telegram warning/critical/recovery | Proven | Dedicated delivery and recovery were exercised; Alertmanager currently has zero active alerts. |
| Storage | Proven | Approved media is on `/mnt/beacon-data`; root is 51% used/93 GB free and secondary volume is 6% used. |
| Capacity plan | Prepared, not measured | Deterministic external 3k/4k/5k shards are recorded. No same-host 150-client test or high-load claim was made. |
| Full gates | Proven | 1,124 tests, ESLint, TypeScript, build, Prisma, preview, origin and observability checks are green. |

## Delivered commits

- `d7ed952` — recurring registered-Free windows and combined access authority;
- `4b9e0fa` — exact-Origin auth mutation gate and session metadata scrubbing;
- `575b75a` — logout outside a Free window;
- `637c5e0` — deployed identity/Free operational evidence;
- `e0bc329`, `d4a7986` — current public acceptance runbook;
- `aba2057` — reproducible deployed registered-Free runtime smoke;
- `a21273a` — passwordless email fallback seam, hidden until delivery exists;
- `55bf282` — iPhone gesture-safe intro handoff;
- `dad29d4` — one-time welcome access and boundary synchronization.

PR #203 remains draft and mergeable. The exact application SHA above is the
deployed image; later documentation-only commits do not require rebuilding it.

## Current runtime and operations

- Listener, PostgreSQL and stream origin are isolated from the event project.
- Free for All is temporarily OFF for the coordinated registered-Free human
  acceptance. Restore it ON after this test before resuming anonymous sharing.
- Listener health/readiness, origin, PostgreSQL and decoded canary are green.
- Alertmanager has no active alert. A prior root-disk warning was real, then
  resolved after removing only old unreferenced Listener/authority image tags.
- Current/rollback images, every active image, containers, volumes, databases
  and approved media remain. Removed historical images are reproducible from
  their Git commits.
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
- #219 remains In Progress for physical iPhone natural-handoff/reconnect
  acceptance; the gesture-safe implementation is deployed.
- #213 is Todo; #211/#212 and the larger campaign/cosmic-campfire journey are
  post-MVP and do not block this bounded test.

## Remaining human sequence

Use `docs/operations/EARLY_BIRDS_FREE_ACCEPTANCE.md` as the authoritative
worksheet.

1. Finish playback/reconnect checks in the already active FFA-OFF interval.
2. Complete physical Chrome, Firefox, Android Chrome and iPhone Safari rows.
3. Run one 60-minute physical listen with intro, handoff, background/foreground,
   network transition and Stop/rejoin.
4. Restore FFA ON and verify anonymous playback before public sharing.
5. Run stepwise load from external generators before claiming measured scale.

Do not select a user's Google account, provision Apple, charge a provider,
alter audio or merge/promote the branch as part of an automated test.

## Rollback

Restore root-only
`/etc/harmonic-beacon/earlybirds-preview.env.pre-dad29d4`, select Listener image
`55bf282`, retain the preview database, additive welcome table and origin media,
recreate only the isolated Listener and run the preview health smoke. Nginx was
not changed by this deployment.

To end a public Free for All moment without rolling back code, set only the FFA
switch to OFF, recreate only the isolated Listener and verify anonymous
lease/manifest denial. Already signed or buffered media may drain for the short
manifest/signature horizon.
