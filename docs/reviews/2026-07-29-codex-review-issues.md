# Codex review issue fallback — 2026-07-29

GitHub issue creation was attempted before implementation with:

```text
gh issue list --repo AlterMundi/harmonic-beacon-webapp ...
```

It failed because this sandbox cannot reach `api.github.com`. Creating the
required Git branch also failed because the sandbox mounts `.git` read-only
(`cannot lock ref`). Implementation is therefore kept as a working-tree
diff for the orchestrator to place on `feat/codex-review-20260729`. The issues below
are therefore the required filing fallback. They are written so the orchestrator
can create them with `gh issue create` after this branch is audited.

The existing open issues #24, #25, #26, #27, and #30 could not be fetched in
this sandbox. This review deliberately excludes the protected WS5-03 and WS6-x
human/operations work (capacity execution, DNS, secrets, payment rail, and
rehearsal) to avoid duplicating or changing that scope.

## Handoff status

- Requested branch: `feat/codex-review-20260729`; not created because `.git`
  is read-only. The complete implementation is an uncommitted working-tree diff
  against `main` at `a3323d3db085`.
- Commits: none; ref creation and commits both require the blocked `.git`
  write access.
- Root verification: `npm run test` passed (47 files, 401 tests);
  `npm run lint` passed with no findings; `npm run build` passed; and
  `npx tsc --noEmit` passed.
- Service verification: the tapestry TypeScript build passed. Tapestry tests
  cannot bind the `tsx` IPC socket in this sandbox (`EPERM`). The playlist-bot
  build cannot resolve its native `@livekit/rtc-node` package after the sandbox
  blocked its install script.
- Live LiveKit/TURN, real PostgreSQL lock behavior, two-room audio, native
  playlist output, 150-attendee load, and mobile-browser behavior remain
  unverified and require the scheduled rehearsal environment.

## Issue: [review] Room: Beacon bed is silent until an unavailable playback action

**Local reference:** R1

**Status:** Completed in the working tree (R1). Audio activation, visible
failure copy, initial-connect retry, and enabled room/provider tests are in
place.

### What was found

- `src/context/AudioContext.tsx` initializes `isPlaying` to false and only calls
  `HTMLAudioElement.play()` for new bed tracks when that flag is true.
- The paid room in `src/app/session/[id]/page.tsx` changes the bed volume but
  never calls `togglePlay`; it renders no playback activation control.
- Stage audio catches and discards autoplay failures. On gesture-gated browsers,
  especially mobile Safari, an attendee can be connected with a healthy-looking
  UI and hear neither source.
- The bed connection failure is logged but not surfaced to the attendee, and the
  initial room error view has no retry action.

### Why it matters

Both Beacon and stage voice are non-cuttable launch requirements. A silent
connection that looks connected is especially dangerous with 150 attendees
because support cannot distinguish it quickly from a server outage.

### Proposed change

Add one prominent bilingual, explicit audio-start action that unlocks both
LiveKit rooms from a user gesture, preserves the existing crossfader, and reports
bed/activation failures without disconnecting the attendee. Add a retry action
to initial connection failures and cover the behavior in enabled room tests.

### Acceptance criteria

- A connected attendee can activate both stage voice and the Beacon bed with one
  clearly labeled button.
- Current and subsequently subscribed tracks play after activation.
- Failure to activate audio or connect the bed is visible and actionable.
- The existing two-room crossfader and audio-only video-unsubscribe behavior are
  unchanged.
- Room tests are enabled and cover audio activation, connection retry, and
  disconnect/rejoin behavior.

## Issue: [review] Spotlight: queue controls call missing actions and omit live state

**Local reference:** R2

**Status:** Implemented in the working tree (R2), with one documented
limitation: the Room Service participant response exposes connection and track
state but not connection-quality telemetry. The UI reports quality as unknown
rather than fabricating it. Lower-hand controls, live media state, failure
fallback, and facilitator protection are complete and tested.

### What was found

- `src/components/ops/SpotlightConsole.tsx` posts `action: "lower_hand"` after a
  promotion and from "Remove hand".
- `src/app/api/ops/sessions/[id]/stage/route.ts` accepts only `promote`,
  `demote`, `mute`, and `reconcile`; both lower-hand operations return 400.
- The hand remains at its old timestamp and returns to the front after a later
  demotion, violating queue fairness.
- `src/app/api/ops/sessions/[id]/participants/route.ts` returns only durable
  database fields. The console's connected, media, and quality fields therefore
  normalize to unknown/empty, so operators cannot see live tracks or use the
  rendered per-track mute controls.
- The console offers "Take floor" for the facilitator. The server also permits
  demoting the facilitator even though Julián's reserved grant is part of the
  six-publisher contract.

### Why it matters

These are primary two-second operator controls. During a live psychodrama, stale
hands, unavailable mute controls, and accidental removal of the facilitator are
session-safety failures rather than polish.

### Proposed change

Wire the existing `lowerParticipantHand` domain operation into the staff route,
enrich participant snapshots from LiveKit with a bounded failure fallback, and
protect the assigned facilitator's baseline grant in both API and UI.

### Acceptance criteria

- Successful promotion clears the original hand; manual "Remove hand" works and
  is audited.
- A later demotion does not restore a served hand.
- The console shows connected/left, media mute state, and connection quality
  when LiveKit is reachable, and clearly marks live state unavailable otherwise.
- Operators can mute current published tracks.
- The assigned facilitator cannot be demoted; muting remains available.
- Route and component tests cover every control and the LiveKit-unavailable path.

## Issue: [review] Media auth: seeded facilitator identity conflicts with stable room identity

**Local reference:** R3

**Status:** Completed in the working tree (R3). Principal-scoped seeded-row
migration and regression coverage are in place.

### What was found

- `prisma/seed.ts` creates each facilitator participant with a random UUID
  `participantIdentity`.
- `src/lib/room-entitlement.ts` derives a different stable HMAC identity and
  upserts by `(scheduledSessionId, participantIdentity)`.
- The migration also has a partial unique index on
  `(scheduled_session_id, staff_user_id)`. On a fresh seeded database, the
  facilitator's first token request can therefore try to create a second row for
  the same staff principal and fail the database constraint.
- The partial principal indexes are not represented in Prisma's schema API, so
  unit mocks did not expose the conflict.

### Why it matters

Julián must be able to join preflight and owns publisher slot one. A fresh
production seed that prevents his first token from being minted is a launch
blocker.

### Proposed change

Resolve or migrate the existing participant row by its event-scoped principal
before applying the stable identity, while retaining the uniqueness guarantees
and concurrent token safety.

### Acceptance criteria

- A freshly seeded facilitator obtains a stable stage token without creating a
  duplicate participant.
- Repeated and concurrent token calls reuse one participant row and identity.
- Attendee and staff identities remain event-scoped, stable, and non-PII.
- Tests reproduce the seeded-row case and guard the fix.

## Issue: [review] Admission: cap checks race and rebind leaves old sessions active

**Local reference:** R4

**Status:** Completed in the working tree (R4). All seat issuance paths share a
scheduled-session row lock, duplicate-only imports work at capacity, and rebind
revokes old browser sessions.

### What was found

- Generate, import, and comp flows in
  `src/app/api/ops/admission/route.ts` count active entitlements inside a
  transaction but do not lock the scheduled-session row. Concurrent operations
  can both observe capacity and commit beyond the 150-person cap.
- Import checks capacity using every input code before `skipDuplicates`, so a
  repeated idempotent import can be rejected when the event is already full.
- Rebind/clear in `src/app/api/ops/admission/[id]/route.ts` changes the ticket
  binding but does not revoke existing `WebSession` rows. The old device remains
  authorized because principal resolution checks current ticket state, not the
  login email.

### Why it matters

The attendee cap and immediate support reset are binding admission contracts.
Both paths are likely to be used under pressure at doors.

### Proposed change

Serialize all seat reservations on the scheduled-session row, count only novel
import digests under that lock, and make rebind/clear atomically revoke existing
ticket web sessions with the supplied audit reason.

### Acceptance criteria

- Concurrent last-seat issuance produces one success and one `cap_exceeded`.
- Paid, comp, and support-override entitlements can never exceed 150 active
  seats.
- Repeating an import is idempotent even when the event is at capacity.
- Rebind and clear immediately invalidate every existing cookie for that ticket.
- Tests cover concurrent capacity and session revocation behavior.

## Issue: [review] Landing: purchase and Costa Rica event time are easy to miss

**Local reference:** R5

**Status:** Completed in the working tree (R5). Event cards lead with Costa
Rica time, display both prices, use prominent purchase actions, and retain
Argentina/UTC references and bilingual login copy.

### What was found

- `src/app/page.tsx` renders event time in Argentina and UTC, but the attendee
  contract and ticket campaign lead with Costa Rica local time.
- The purchase action is a small underlined link below each event, visually
  weaker than the login form and easy to miss on mobile.
- The settled $50/$20 tier choice is not mentioned near the purchase action.
- The root metadata in `src/app/layout.tsx` still describes the stripped
  meditation product and makes unsupported calm, sleep, and stress-relief
  claims that conflict with `docs/PRODUCT_PRINCIPLES.md`.
- A signed-in staff page labels a link "Go to operator controls" but sends to
  `/`.

### Why it matters

First-time buyers must identify the correct language/time and next step without
support. Misleading metadata and navigation add avoidable uncertainty during
the paid launch.

### Proposed change

Show Costa Rica, Argentina, and UTC explicitly; make each bilingual purchase
action prominent with the published tier prices; replace stale metadata with
event-accurate language; and correct the staff destination.

### Acceptance criteria

- Each event card names its language and Costa Rica time first, with Argentina
  and UTC conversions.
- The buy-ticket action is unmistakable and usable at phone width, with both
  published tiers visible.
- EN/ES login and support copy remain present.
- Metadata contains no unsupported therapeutic or stripped-product claims.
- Signed-in staff reach `/ops/health`.

## Issue: [review] Build: Google Fonts network dependency blocks production artifacts

**Local reference:** R6

**Status:** Completed in the working tree (R6). The build has no remote-font
fetch, uses the supported Webpack production builder, lint is clean, and nine
room integration tests plus two provider audio tests run and pass.

### What was found

- Baseline `npm run build` fails when `next/font/google` cannot fetch Inter from
  `fonts.googleapis.com`.
- The root layout still mounts the unused legacy NextAuth `SessionProvider`.
- All seven integration tests for `src/app/session/[id]/page.tsx` are
  `describe.skip`, leaving the most critical client flow outside the passing
  test count.

### Why it matters

A rollback or Sev-1 artifact may need to be built under restricted or degraded
network conditions. Skipped room tests hide regressions in reconnect and audio
behavior.

### Proposed change

Use the existing system-font stack with no build-time download, remove the
unused legacy provider, update the room test double, and enable the room tests.

### Acceptance criteria

- `npm run build` succeeds without access to Google Fonts.
- The root layout has no unused NextAuth runtime wrapper.
- The room integration tests run rather than skip and pass with the current
  LiveKit event surface.
- `npm run test`, `npm run lint`, and `npm run build` pass.

## Issue: [review] Playlist bot: fallback keys off participant presence, not live audio

**Local reference:** R7

**Status:** Deferred; review finding only. Requires LiveKit-native integration
verification and is not safe to change without the rehearsal environment.

### What was found

- `services/playlist-bot/src/index.ts` fades the playlist out whenever identity
  `beacon01` is present, even if that participant has not published an audio
  track or its track has ended.
- The app health check sees the bot's published track, but cannot tell that its
  captured frames have faded to silence.

### Why it matters

A connected-but-silent primary source can make both the live source and fallback
silent while health appears green.

### Proposed change

Drive fallback state from the primary source's actual audio publication/mute
lifecycle, and expose a bot state signal that distinguishes publishing audio
frames from merely holding a LiveKit track.

### Acceptance criteria

- The playlist remains audible when `beacon01` is connected without live audio.
- Track publish/unpublish/mute transitions crossfade exactly once.
- Reconnect reconstructs the correct state from current publications.
- Health turns red when neither source is producing audio.
- Behavior is verified against the deployed `@livekit/rtc-node` version.

## Issue: [review] Tapestry: ingest during a composite build can lose invalidation

**Local reference:** R8

**Status:** Deferred; future reliability finding for the cuttable tapestry.

### What was found

- `services/tapestry/src/composite.ts` clears `dirty` after an asynchronous build.
  An ingest that calls `markDirty()` while that build is in flight can have its
  flag overwritten to false even when the new frame was not part of the built
  inputs.

### Why it matters

The affected participant can remain stale until another frame happens to dirty
the session. This is not on the paid room's critical path, but it is a
maintainability issue for the future platform.

### Proposed change

Track a monotonic session revision and clear dirty state only when the completed
composite was built from the current revision.

### Acceptance criteria

- Ingest during an in-flight build always schedules or triggers a subsequent
  rebuild.
- Concurrent callers still share one in-flight build.
- The once-per-second rebuild bound remains intact.
- A focused race test proves the newest frame is eventually visible.

## Issue: [review] Ops docs: launch date is internally contradictory

**Local reference:** R9

**Status:** Deferred to the human/ops owner because the brief forbids modifying
open WS5-03/WS6-x scope.

### What was found

- The current seed contract pins both sessions to Saturday 2026-08-01.
- `docs/ops/WEEKEND_EVENT_RUNBOOK.md` says "Saturday 2026-08-02"; August 2 is
  Sunday.
- `docs/plans/WEEKEND_MVP_ROADMAP.md` contains both a Saturday August 1 run day
  and a Sunday August 2 second-session plan, while its launch surface says both
  sessions are Saturday.
- Deployment/schema comments still refer to a July 31/August 2 or August 1/2
  weekend.

### Why it matters

Operators printing the runbook or checking a fallback schedule could prepare on
the wrong day. This needs a single human-confirmed source of truth before sales
and reminders.

### Proposed change

The event owner should confirm the two-session Saturday schedule, then update the
roadmap, runbook, deployment comments, attendee communications, and private
operator calendar in one pass.

### Acceptance criteria

- Every public, operator, seed, and deployment reference agrees on date,
  language order, Costa Rica time, Argentina time, and UTC time.
- A fluent EN/ES human reviews the attendee-facing schedule.
- The correction is included in rehearsal materials without changing the
  already-settled software contracts.
