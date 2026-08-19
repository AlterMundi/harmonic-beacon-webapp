# Weekend human rehearsal

Use this runbook for a no-developer-assisted rehearsal on the exact candidate
that could be used for an event. It complements automated CI and synthetic
LiveKit load evidence; it does not replace either.

The rehearsal uses synthetic identities and an `isTest=true` session. Never
reuse a paid attendee, production ticket, event room, email address, promotion,
or payment to make the test convenient.

## Roles

Assign these responsibilities before opening a browser:

| Responsibility | Person | Account/capability |
|---|---|---|
| Go/no-go and facilitator |  | Assigned `FACILITATOR_OP` |
| Independent operator |  | `OPERATOR` or `ADMIN` |
| Attendee A |  | Synthetic ticket principal |
| Attendee B |  | Synthetic ticket principal |
| Mobile attendee |  | Synthetic ticket principal |
| Evidence recorder |  | No production credentials required |

One person may cover more than one attendee device, but the facilitator must
not operate an attendee browser. The evidence recorder reads the script and
records outcomes without coaching the expected result.

## Entry gate

Record every item in a dated sheet under `docs/ops/rehearsals/`. Do not begin
until all of these are true:

- the public health endpoint is ready and exposes the intended Git SHA;
- the candidate's release gates are green and its rollback SHA is known;
- the session is visibly marked as a test and is absent from public discovery;
- the facilitator is assigned to that exact session;
- Spotlight, admission, health and session links all resolve to the same UUID;
- the Beacon publisher/fallback is ready, with no seventh Stage publisher;
- no capacity run, deploy, migration or cleanup is active on the same target;
- every tester knows the abort phrase and has a fallback communication channel.

If the candidate differs from the deployed SHA, stop. A local commit, `main`,
or a green pull request is not the system under test.

## Device and network matrix

At minimum, cover:

- desktop Chrome on an Argentina network;
- desktop Firefox on a different network;
- physical iPhone Safari;
- physical Android Chrome;
- one restrictive path that proves ICE/TCP or TURN fallback;
- headphones and speaker routing on at least one mobile device.

Record exact browser and OS versions. Emulated mobile projects remain useful
regression evidence but cannot fill a physical-device row.

Run Parts A and B of
[`HUMAN_ROLE_LANGUAGE_REVIEW.md`](../verification/HUMAN_ROLE_LANGUAGE_REVIEW.md)
against the same deployed SHA, and score
[`2026-08-04-quality-rubric.md`](../verification/2026-08-04-quality-rubric.md)
for attendee and staff. These are parallel human-acceptance gates: completing
the media journey does not prove role comprehension, fluent ES/EN copy or the
professional-experience rubric.

## Rehearsal sequence

Run the sequence in order. Do not repair state directly in the database or ask
a developer to manufacture the next screen.

### 1. Waiting room and admission

1. Confirm the test session is absent from the public event list.
2. Enter with all three attendee principals while doors are closed.
3. Open doors from the assigned `FACILITATOR_OP` account.
4. Confirm every attendee reaches the same session and sees their own name and
   role; staff must see their effective capabilities and assigned event.
5. Confirm the independent operator can observe the live session without a
   second attendee connection or loss of cockpit controls.

### 2. Media activation and listening

1. Each attendee activates audio once from an explicit gesture.
2. Listen for at least 60 seconds at personal mix positions `0.25`, `0.50` and
   `0.75`; record Beacon presence, voice intelligibility, glitches and routing.
3. Toggle attendee audio-only mode and verify that microphone and both incoming
   sources continue as designed.
4. Background and foreground each mobile browser once.

This is observation only. Codec, bitrate, sample rate, channels, gain, buffer,
crossfader, routing and `AudioContext` changes require the audio-touching review
path and cannot be improvised during rehearsal.

### 3. Hands, invitations and Stage truth

1. Attendee A raises a hand; both facilitator and operator must see it.
2. Invite A to the Stage. Verify that A remains in the audience until explicit
   accept, then publishes only after accepting.
3. Toggle A's camera off and on; verify that audio continues and the public
   composition names A rather than showing a generic role.
4. On mobile, switch front to rear camera and back without leaving either room
   or interrupting microphone/Beacon.
5. Attendee B raises a hand, receives an invitation and declines. B must never
   appear on Stage.
6. Demote A and verify that Stage, tapestry, hand queue and grant truth converge.

Never use remote unmute as consent. Staff may request media; the participant
must perform the final camera/microphone action.

### 4. Reconnect and stale-state removal

1. Invite A again and accept.
2. Remove A's network for 15 seconds. A must disappear from effective Stage
   truth while disconnected, even if a durable grant still exists.
3. Restore the network and reconnect. A must not reappear on Stage before a
   current invitation/acceptance/publication sequence.
4. Refresh B and verify entitlement, identity and hand state are truthful.
5. Open and close every cockpit tool. Record LiveKit connection count, remote
   track count and DOM media count before and after; none may increase merely
   because a drawer was used.

### 5. Contributions and moderation, when present

Only run this section when the deployed SHA includes the reviewed contributions
UI and its backend contract.

1. Submit one named and one explicitly anonymous contribution.
2. Confirm the audience never sees the anonymous author and staff does.
3. Repeat a request with the same idempotency key and verify one contribution.
4. Exercise the reviewed moderation/withdrawal flow if that capability is part
   of the candidate. Never substitute direct database deletion.

### 6. Session end and next-event isolation

1. End the session from the staff lifecycle control.
2. Confirm every attendee is removed from the experience and cannot obtain a
   fresh Stage or Beacon token for the ended session.
3. Confirm staff views converge to ended with no residual on-stage participant.
4. Open a second test session and verify that no hand, grant, contribution,
   track, audio element or language state leaks from the first session.

## Commercial lane

The full #24 dress rehearsal also requires registration, payment, access email,
refund/review/revoke and provider-failure evidence. Mariano/Sai own that lane.
Record their canonical synthetic evidence by link; do not recreate it with
hardcoded catalog data, real payments or inferred statuses. A non-commercial
team smoke may proceed without this lane, but it cannot close #24 or authorize
opening sales.

## Evidence and decision

For each step record `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Attach:

- deployed SHA, database schema version and rollback SHA;
- session UUID and synthetic role labels (not names/emails/tokens);
- device/browser/network matrix and UTC timestamps;
- sanitized screenshots or recordings only when all testers consent;
- health, restart/OOM and connection/track/DOM counts;
- one issue per failure with owner and deadline.

Abort immediately on health degradation, an unexpected production room,
duplicate audio/media, consent violation, seventh publisher, identity leak, or
inability to end the experience for everyone. Roll back only through the
reviewed deployment path. The go/no-go owner signs the sheet; silence or a
partially completed row is not approval.
