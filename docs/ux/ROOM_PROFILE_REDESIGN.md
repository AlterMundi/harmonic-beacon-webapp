# Live room and personal profile

Owner: Eko, appointed by Sai on 2026-10-26. Workstream: #469; staff feed: #460.
Base: `release`, separate locked worktree `feat/room-profile-eko-20261026`.

## Audit and direction

Reference: `Mar-IA-no/PMP-GPT`, `psicopompo/frontend/src/App.jsx` and
`styles.css`, plus the facilitator/participant evidence screenshots. Reuse its
clear audio strip, separate participant/facilitator workspaces and contextual
tool rail. Retain Beacon's own Cormorant/Inter, warm black, bone and gold.
No PMP assets, therapeutic content, runtime or AI services are imported.

Observed problems: room controls follow the chat on mobile; the cockpit embeds
a scrolling room inside another scrolling page; staff chat is read-only; the
participants list and stage actions are hidden in a modal; small operational
labels are often 10–12px. FACILITATOR is restricted to assigned events and only
the assigned facilitator initially receives publication. Profile information,
event discovery, measured time and membership live on separate surfaces.

## Implementation plan

1. Keep the existing media lifecycle. Recompose scene, essential controls,
   listening mixer and contextual chat/participants; no control should require
   discovering an inner page scrollbar. Preserve room instances across panels.
2. Make staff tools a persistent workspace with named panels, visible state,
   shared links, participants and chat. Keep focus, errors, confirmations,
   lifecycle checks and stage capacity/revision fencing.
3. Apply Sai's explicit role decision to every enabled staff role for room and
   event tools. Keep actual facilitator assignment as attribution, keep account
   and analytics authority separate, and never turn an attendee into staff.
4. Enable named staff contributions using the same authenticated, idempotent,
   bounded feed. Anonymous participant messages retain their privacy contract.
5. Add a private Live profile: verified identity/role, event creation for staff,
   upcoming published events with share links, server-observed participation
   time. Distinguish Live event time from Listen listening time. Membership
   must come from the owning service; an event ticket is never a subscription.
6. Verify role/admission isolation, feed replays/privacy, overlapping time,
   desktop/320px layouts, keyboard, media continuity and selected impact gates.
   Qualify an immutable candidate and recovery before any production promotion.

## Acceptance

- Participant mic/camera/hand/leave controls remain together before chat.
- Staff can reach every room tool regardless of assignment; actual assignment
  remains visible without becoming a substitute permission check.
- Panel changes do not remount media or request capture permissions.
- Readable 16px controls/body and at least 14px supporting text; 44px targets.
- Unknown, failed and loading data never become zero hours or a free plan.
- Use real canonical records; no new payment offer or payment execution.
- Physical phone audio/camera/thermal acceptance remains separate from browser
  emulation. Deployment is not claimed from local source or CI alone.

## Implemented boundaries

All enabled staff may operate any event, create/edit future events, manage stage
capacity and perform reasoned lifecycle actions. Existing admission/commerce and
account/analytics authority remains unchanged. Assignment remains attribution;
only the assigned facilitator receives an initial publication grant. Other staff,
including existing subscribe-only rows, use an explicit self-publication action
through the same capacity, audit, revocation and reconciliation path.

Staff may publish named chat; participant anonymity and private staff reading
remain distinct. Panel reopening catches up immediately and feeds sort by the
canonical timestamp/id order. The room iframe reports its intrinsic height only
to its same-origin parent, which checks source and session before resizing.

Profile authentication uses the ordinary Account subject/issuer or legacy valid
principal. A separate Listener-lane change supplies a private, no-store summary
only to the corresponding Live origin, authenticated as the Listener user. Live
must match its own current subject binding before rendering a summary; snapshots
are also bound to identity and origin during render to prevent account-switch
leaks. Missing/failed/unknown paid projections never become a Free badge.

Live meeting hours and Listener listening hours are displayed separately and
union overlapping devices within each meter. Closed/open spans are capped by
last observed heartbeat plus grace. Closure preserves the heartbeat from this
change forward. Historical overwritten observations cannot be reconstructed.

PMP reference inspected at bb52ef5b396963f4d1d2c8751e78d316ec507aec.

## Verification and delivery

Local production builds, TypeScript and ESLint passed. The full unit run passed
1,783 tests with 56 opt-in integration cases skipped; subsequent focused runs
cover the additional account-origin and legacy-profile changes. Ten real
PostgreSQL contribution cases passed. All 18 durable grant/recovery cases passed
on a separate empty test database; an initial run against the browser fixture
correctly exposed unrelated preexisting reconciliation debt in that fixture.

Real local PostgreSQL, LiveKit and tapestry back browser checks with synthetic
devices and identities. Chromium and Android media continuity, iPhone WebKit
without capture, role isolation in both languages and room/cockpit accessibility
passed. Final journeys cover two-way identified staff chat, participant search,
explicit staff self-publication without automatic capture, profile event creation
and sharing, profile accessibility, and 320/390/1440px layouts.

The Listener summary is maintained separately in PR #643 on `early-birds`.
Its local 20-case suite, type check and lint passed; its nine PR checks passed
before integration. The corresponding protected-lane run still qualifies the
merged source. There are no schema changes or new payment operations.

Production delivery remains a separate acceptance: selected hosted gates,
exact images, staging apply/rollback/forward, schedule checks and behavior
readback through the existing service helpers. Eko's Staff API broker does not
admit images. Physical phone audio/camera acceptance remains outstanding.
