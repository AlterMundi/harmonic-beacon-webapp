# Quality rubric scorecard — 2026-08-04

**Baseline:** `main` at `9044505` after PRs #143 and #144
**Issues:** #64, #69
**Status:** automated/technical review complete; human and physical-device acceptance pending

This scorecard applies the 0–3 rubric defined in #64 to the surfaces that
exist today. It does not turn automation into human acceptance. Scores reflect
the checked-in behavior and reproducible browser evidence; the final column
states what a non-technical reviewer or a physical device must still confirm.

## Scale

- **0 — absent:** the requirement is not represented.
- **1 — fragile:** some intent exists, but a normal path can contradict it.
- **2 — acceptable:** the requirement is coherent and has repeatable evidence.
- **3 — strong:** the behavior is unusually clear and is covered across its
  important states, not merely the happy path.

Any score below 2 blocks acceptance. A table with no score below 2 is still
**provisional** until the named human/device checks are signed off.

## Scorecard

| Surface | Arc | Attention | Truth | Continuity | Recoverability | Reach | Register | Remaining human/device check |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Ticket threshold, entry, and waiting | 3 | 3 | 3 | 2 | 3 | 2 | 3 | Read ES/EN time, ticket error, and waiting copy without team explanation on a phone. |
| Attendee room and collective presence | 3 | 2 | 3 | 3 | 2 | 2 | 3 | Real iPhone/Android: one-handed controls, background/foreground, partial permissions, Beacon plus voice. |
| Invitation, decline/accept, return, and closing | 3 | 3 | 3 | 3 | 2 | 2 | 3 | Screen reader and physical camera/microphone consent through two consecutive events. |
| Staff sign-in and event hub | 2 | 2 | 3 | 2 | 3 | 2 | 2 | A first-time facilitator can identify their event and role limits without help. |
| Conductor cockpit and persistent room | 3 | 2 | 3 | 3 | 2 | 2 | 2 | Julián/operator can explain the primary signal and move through all drawers on mobile without losing the room. |
| Admission and health support | 2 | 2 | 3 | 3 | 2 | 2 | 2 | Operator rehearsal with real failure states confirms that actions and recovery language are sufficient. |
| Stage and public tapestry ground | 2 | 2 | 3 | 3 | 2 | 2 | 3 | #129 must pass privacy/performance review; people must distinguish camera-off, reconnecting, stage, and larger room in five seconds. |

Current automated minimum: **2/3**. Final rubric status: **not signed off**.

## Evidence by criterion

### Arc

- `e2e/tests/smoke.spec.ts` covers the real ticket and staff entry paths.
- `e2e/tests/whole-system.spec.ts` covers two consecutive waiting → live →
  invitation → return → closing lifecycles with one `FACILITATOR_OP` identity.
- `e2e/tests/session-termination.spec.ts` distinguishes a deliberate ending
  from a transport failure.

The event hub and support consoles score 2 rather than 3 because their human
handoff still needs rehearsal; the code can prove routing, not comprehension.

### Attention

- Responsive and visual baselines cover 1440, 1024, 768, 390, and 320 px.
- Invitation and terminal states use one modal/terminal action instead of
  exposing competing controls.
- The cockpit has a computed primary signal, while all five tools remain
  available without navigation.

The live room and cockpit stay at 2: their visual hierarchy is coherent, but
real participants must confirm that stage, tapestry, mix, room count, and
operational signals do not compete under actual event pressure.

### Truth

- Test sessions are excluded from public discovery by durable `isTest` data.
- Attendees see their name and human state, not opaque identity fragments or
  role enums.
- PR #144 exercises the five-role presentation in ES/EN and proves the
  assigned/unassigned `FACILITATOR_OP` boundary over HTTP and in the browser.
- Health, admission, waiting, reconnect, duplicate-login, and ended states are
  intentionally distinct while authentication failures remain non-enumerable.

The public tapestry remains a collective image, not a participant directory.
Any future public identity sidecar requires an explicit privacy decision; it
cannot inherit this score automatically.

### Continuity

- `e2e/tests/media-continuity.spec.ts` instruments signaling sockets,
  peer connections, media elements, detachments, duplicate sources, `play()`
  and `AudioContext.resume()` while controls and cockpit drawers change.
- `src/app/session/[id]/__tests__/media-continuity.test.tsx` protects the same
  invariants at integration level.
- `e2e/tests/stage-invitation.spec.ts` uses two real browser identities and
  LiveKit for decline, accept, camera/microphone publication, and return.
- Frozen audio paths remain protected by CODEOWNERS and the audio-boundary CI
  workflow.

The threshold/hub score 2 because they do not own active media; continuity
there means that entering the next surface does not create an ambiguous second
identity or room.

### Recoverability

- Retry appears for transient entry/transport failures and is absent for
  terminal ended/cancelled states.
- Reconnect uses a bounded sequence with a fresh token and preserves intended
  camera/microphone state.
- Staff denial returns to the authorized event hub without disclosing another
  event, and operator errors keep the relevant tool open.

Live media and support surfaces remain at 2 until physical degraded-network,
device removal, and real provider failure rehearsals confirm the automated
model.

### Reach

- Axe enforces WCAG A/AA, including contrast; no accessibility rule is
  disabled.
- Keyboard focus, focus trapping, Escape/return, visible focus, reduced motion,
  long localized copy, and no horizontal overflow are automated.
- Responsive and visual suites cover all five target widths.

Every surface remains at 2 until real VoiceOver/TalkBack, touch reach, browser
chrome, safe-area, and partial-permission checks are attached to #24/#69.

### Register

- The shared nocturnal palette, serif display hierarchy, monospace operational
  cues, quiet borders, and spacious cards are captured by reviewed baselines.
- Waiting, invitation, room, and tapestry use the product's threshold/scene/
  collective language rather than generic dashboard vocabulary.

Staff support tools score 2 because operational density is appropriate there,
but a human review must confirm that they still feel like one Beacon room and
not a collection of admin products.

## Sign-off checklist

- [ ] Non-technical ES reviewer can predict each role's authority.
- [ ] Non-technical EN reviewer can predict each role's authority.
- [ ] Julián completes two consecutive events without developer assistance.
- [ ] Attendee journey passes on physical iPhone Safari and Android Chrome.
- [ ] Desktop Firefox/Chrome with real camera and microphone pass.
- [ ] Degraded network, background/foreground, partial permission, and device
      removal have dated evidence.
- [ ] #129 passes its privacy, bounded-request, freshness, and stale-order review.
- [ ] #93/#94 provide human acoustic evidence; continuity tests do not certify
      intelligibility.

Until every applicable item is checked, #64 and #69 stay open even though the
automated rubric has no score below 2.
