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
The blocked-audio action now precedes the scene and stays inside the first
viewport at every reference width. Fifteen intentional visual baselines cover
that room, the persistent tools and the staff event hub at five widths. The
tools-only visual fixture pins its hidden iframe height so connection timing
cannot change the reference image.

The Listener summary is maintained separately in PR #643 on `early-birds`.
Its local 20-case suite, type check and lint passed; its nine PR checks passed
before integration. The corresponding protected-lane run still qualifies the
merged source. There are no schema changes or new payment operations.

Production delivery remains a separate acceptance: selected hosted gates,
exact images, staging apply/rollback/forward, schedule checks and behavior
readback through the existing service helpers. Eko's Staff API broker does not
admit images. Physical phone audio/camera acceptance remains outstanding.

The conservative impact report retains its full selected verification matrix.
A local esbuild input inventory of the commerce worker found eight source
modules, all byte-unchanged from the observed Live source
`ac21c51df9f9ff32a21505c327928d38253a30b0`; the dependency manifests and Prisma
schema/migrations are unchanged too. This supports worker compatibility review
for the admitted owner-operated app delivery path; current host/image custody
and its actual permit still need readback. Existing Mona sudo grants expose only
the staging and production Staff API brokers, with no image-admission command.

## Follow-up: hands, camera and voluntary return

The staff sidebar has adjacent **Hands / Stage / Chat** tabs, with the queue
count always visible. Hands shows waiting people and pending invitations; Stage
shows publishers and the audience. One Spotlight tree, chat draft and room iframe
remain mounted across tab changes. Other operational tools stay reachable.

The participant's raised-hand button uses a decorative ✋ and an accessible
pressed state. Camera controls sit beside the microphone: outside the stage they
control video-only tapestry snapshots, explicitly labelled **Tapestry camera**;
after accepting, they control **Stage camera**. The existing default-on tapestry
policy is preserved; raising a hand never changes camera/microphone consent.
Microphone and **Leave the scene** remain visible and disabled until applicable.
**Leave room** stays available independently. Explicit scene exit also keeps the
tapestry camera off until the person turns it on again.

Staff can voluntarily release their own stage slot, including the assigned
facilitator, while continuing to receive audio and operate the event. This uses
the existing locked grant revocation/outbox path, an exact grant version, and an
own-row lookup from the authenticated staff principal. Ordinary staff demotion
still protects the assigned facilitator. Delayed exit responses cannot replace a
newer confirmed grant or misreport its devices. The private staff grant snapshot
never publishes or acquires devices by polling.

Real-browser exit qualification observes the existing security fence: revoking a
grant rotates the room identity and renews both receiving transports. Scene exit
is distinct from leaving the room page or logging out, but it is **not gapless
audio**. The confirmation explains a possible brief audio pause. Keep this fence;
do not weaken revocation to satisfy a zero-reconnect assertion. Browser coverage
checks the changed identity, resumed room, devices staying off, and explicit
re-entry for both assigned facilitators and unassigned operators.

Follow-up qualification: the five production-build PostgreSQL/LiveKit journeys
passed, including both staff roles, private profile/share behavior, preserved
chat drafts, invite/decline/reload/accept/return, and staff-panel overflow checks
at 1440/390/320px. Ten affected visual cases rendered at all five reference
widths. The broad local unit suite passed 1,796 cases; the added staff-version
regression and the final 101-case authority/room group also passed. Hosted
qualification and image delivery remain separate requirements.

## Follow-up: one place for each room tool (2026-10-27)

Sai's review identified duplicated information between the five top signal cards,
the extra header buttons and the staff sidebar. The room also started too far
down the page; on narrow screens the entire staff tool panel preceded personal
media controls.

| Finding | Resulting interaction |
| --- | --- |
| Repeated counts and tool entry points | Remove the top signal strip and extra tool header. Hands, Stage and Chat each have one tab in the sidebar. Counts live in those tabs. |
| Event tools mixed with frequent queue work | Doors, system health, tapestry composition and admission support have one compact menu beside the room. Capacity and manual synchronization belong in Stage. |
| Long instructions before the waiting queue | Keep the queue and invitations first; disclose the existing privacy and queue explanation on demand. |
| Ambiguous state and close controls | Translate health levels, distinguish loading from a confirmed warning, and name panel closure accurately. Escape works from both the panel and its tabs and restores the relevant trigger. |
| Staff controls follow a long tool panel on phones | Show the room first below 900px, with same-document shortcuts between personal controls and staff tools. Keep both columns at 1024px. |
| Both exits share the same warning treatment | Use a neutral secondary action for leaving the scene and a distinct danger treatment for leaving the room. Keep confirmations and grant/device boundaries intact. |

The same iframe, chat composer and Spotlight tree survive navigation, locale
changes and mobile shortcuts. Utility buttons expose their expanded state and
controlled region. Stage attention uses a visible marker and an accessible
description as well as color. The default hands view retains every queued
person; moving administration into Stage removes no action or authorization.

Verification targets: one entry per tool; readable 16px controls and 14px support;
44px or larger interaction targets; no horizontal overflow at 320, 390, 768,
1024 and 1440px; reachable long labels; keyboard focus/closure; accessible room
panels; preserved chat drafts and real LiveKit continuity. Screenshots and browser
emulation provide review evidence. Physical-device and human acceptance remain
separate, and source qualification does not establish production delivery.
