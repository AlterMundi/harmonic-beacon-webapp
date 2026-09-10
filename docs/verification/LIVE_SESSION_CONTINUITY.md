# Live session continuity batch

## Scope and acceptance

The approved batch covers issues #495, #68 and #70. It does not change acoustic
settings (#93), redesign the full room (#469), or integrate the separate Google
identity and Account authority work in #519/#520.

- **#495 — Audio activation:** derive the activation affordance from effective
  playback readiness of the required sound sources. Already-unlocked playback
  must not retain a pending activation action. A blocked/failed attempt offers
  one retry without leaving the room, duplicate playback or altered mixing.
- **#68 — Locale:** update ES/EN in place, including the Staff parent and its
  embedded room. Persist the preference and document language without losing
  room instances, tracks, playback, camera/microphone state or local UI state.
- **#70 — Deliberate exit:** application-controlled actions that abandon an
  active event require an explicit localized stay/leave choice. Cancel/Escape
  preserve room/media/state and return focus; confirmation performs the intended
  transition once. Guard attendee and Staff top-level navigation, not only the
  embedded room. Local panels, in-place locale changes and links opening another
  tab are not exits. Leaving the scene remains distinct from leaving the room.
- **Authority:** ended events, revoked access and involuntary disconnection must
  not become stuck behind a voluntary-exit dialog.

Document unload uses the browser's native confirmation where supported. Its
wording and availability belong to the browser; operating-system termination,
forced process exits and unsupported mobile unload paths cannot be guaranteed
an application warning. Browser/device emulation is not physical-device evidence.

## Verification contract

1. Record each regression test failing for the missing behavior, then passing
   with its fix. Keep the test commands and outputs in the release receipt.
2. Run integrated unit, type, lint, production build and dependency/contract
   gates, with independent review of the complete candidate diff.
3. Run the PostgreSQL and real LiveKit fixture on disposable infrastructure;
   never borrow production credentials, participant data or live events.
4. Exercise `audio-activation.spec.ts` and `continuity-navigation.spec.ts` on
   Chromium, Android Chrome emulation, Firefox and iPhone WebKit emulation.
   No-capture cross-engine cases use the `live continuity without capture`
   suite title; capture-specific cases must not pretend to run on Linux WebKit.
   `live-batch-browser-contract.test.ts` protects test selection and prevents
   release-only skipping of Firefox/WebKit qualification.
5. Record actual per-step outcomes and test skips for the exact candidate.
   A green umbrella job with the required tests skipped is not qualification.
   The shared stack fixture fails CI if database readiness is unavailable;
   explicit local skips remain available for public-only development. The
   batch's media suites must also fail when their required LiveKit is absent.
6. Validate isolated Live staging only within its documented capabilities:
   landing and health/readiness, plus explicitly configured identity surfaces.
   Staging has no LiveKit and cannot qualify room/media continuity.

## Integration and release

Keep separately reviewable correction commits in one integration PR. Preserve
all production-only fixes during a separate reviewed promotion to `release`;
re-read current heads and overlapping PRs before promotion. The release workflow
must qualify its exact SHA, not reuse a green check for a different merge tree.

Use the existing release workflow and versioned root-owned helper only. Before
production mutation verify all event sessions and actual LiveKit rooms and
participants, rollback-image provenance, grant-effect/token-fence quiescence,
and recovery prerequisites. A schema migration additionally requires a fresh
verified backup and an isolated successful restore of that exact backup.
Never clear production grants/outbox markers or alter session lifecycle via
ad hoc SQL to make a preflight pass.

After deployment, verify public revision and readiness, app/reconciler/tapestry
health, room/media continuity and exit confirm/cancel behavior. Update the owning
issues with what is actually delivered; unrelated original human/device or
product acceptance remains explicitly pending rather than auto-closing an epic.

The dated receipt must identify SHAs, PRs/review, exact CI runs and relevant job
steps, red/green evidence, staging/media scope, backup/restore applicability,
preflight, rollback images, deployment and post-deploy checks. This document is
an acceptance contract, not a claim that any delivery gate has passed.
