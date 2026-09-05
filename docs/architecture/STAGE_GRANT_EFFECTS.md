# Durable stage grant effects

`SessionParticipant` is the database authority for whether a principal may
publish. LiveKit is an external projection of that state. Every change to an
existing participant's publication grant must call
`transitionParticipantGrant()` inside the transaction that changes the
business state. Every caller acquires locks in the same order: session,
entitlement/campaign or staff principal, then participant.

That primitive locks the participant, advances its monotonic `grantVersion`,
sets `grantReconcileNeeded=true`, and inserts one `StageGrantEffectOutbox` row
for the exact revision. No caller applies the remote effect before this commit.

Room JWTs never carry publication authority, including for assigned
facilitators. After connecting as a subscriber, a client with a durable grant
calls the publication activation endpoint. That endpoint locks and rereads the
session, principal and exact current participant identity, then applies the
LiveKit permission while those authority locks remain held. A captured JWT can
therefore reconnect only as audience and cannot replay a retired publisher
grant.

## Processing contract

- Workers claim with `FOR UPDATE SKIP LOCKED` and a time-bounded lease.
- A newer revision is ineligible until every older revision has applied its
  grant change. An older identity-fence job may then remain pending until its
  recorded token horizon without blocking the current identity.
- Every LiveKit call uses the SDK transport's aborting five-second timeout;
  mutating Promises are never detached behind an application-only timer.
  Completion and retry updates require the exact random claim token, so a
  stale worker cannot clear another worker's lease.
- A demotion attempts the permission update and every published-track mute
  independently. Ambiguity in either path keeps the job pending.
- Every demotion or revocation rotates the participant's durable LiveKit
  identity. Disconnect jobs remove the previous stage and Beacon-bed
  identities repeatedly through the last returned token horizon. Those sweeps
  are defense in depth for connections minted by an older release; current
  room JWTs remain subscribe-only before, between and after the sweeps.
- Token return is finalized transactionally after minting: the endpoint locks
  session, entitlement/staff and participant, checks exact current identity and
  effective grant, then records the token horizon. A concurrent revocation
  either invalidates the candidate or inherits its complete horizon.
- `grantReconcileNeeded` is cleared only after every current grant change has
  converged and the applied revision and resulting identity still equal the
  participant's current state. Long-lived old-token fences remain visible in
  the outbox and Ops Health after that marker clears.
- Token authorization is fail-closed while the marker is set. If a participant
  is absent, the remote projection is considered converged and a later token is
  still derived exclusively from the durable state.

Before claiming a job, the worker repairs one uncovered legacy mutation. It
supersedes unleased stale effects and appends the current desired state as a
new revision; this is the forward-deploy fence after a legacy rollback. A
legacy participant that ever held publication is conservatively marked with a
four-hour token horizon by the migration. Revoked legacy participants receive
a negative identity-rotation transition. Still-active legacy publishers first
receive the same negative fence and then a positive transition on the rotated
identity, preserving their durable grant without leaving the old JWT epoch
usable.

The application worker drains these jobs before the legacy commerce-media
queue. The latter remains temporarily because the commerce v1 response exposes
historical per-entitlement removal counters; its identities are versioned and
cannot target a later commerce grant.

## Writers

The common transition is used by staff promotion/demotion, commerce credential
rotation or revocation, administrative admission revocation, promotion-code
revocation, both seed entrypoints, and the retired-event stabilization script.
Staff promotion also revalidates attendee ticket and commerce state under the
session transaction.

Direct force-mute is intentionally separate: it changes a track's muted state,
not the participant's publication grant. Session termination and the legacy
commerce reconciler may remove identities but do not write grant state.

## Operations

The worker is safe to run in more than one process. Ops Health exposes pending
count, oldest age, maximum attempts and the latest sanitized error code. A
growing or old queue changes the report to degraded/red while the worker
liveness heartbeat remains independent. Retry and forward-repair logs are
structured and contain only opaque internal identifiers. Do not clear
participant markers manually.

Before deployment, verify no session is `LIVE`, stop the request-serving app,
and repeat the check after the stop. Then run `prisma migrate deploy` and the
bounded `stage-grants:forward-drain` command before starting the new app. The
additive migration keeps legacy participant state intact; the candidate
implementation discovers every marked pre-outbox debt and appends fresh
versioned effects. It also detects a state/revision mismatch against an
existing outbox tail after a forward deploy. It never creates a same-identity
negative backfill that could preserve an old editor JWT.

The staff reconciliation action follows the same rule for the selected
participants: it repairs uncovered legacy debt and retries queued effects, but
an already-consistent participant is a strict no-op. In particular, reconciling
healthy audience members does not rotate their identity or disconnect them.
When a real negative transition does fence an active connection, the attendee
client treats LiveKit `PARTICIPANT_REMOVED` as a reauthorization boundary: it
fetches a fresh token and returns as audience. Room deletion/closure remains
the terminal session signal.

Application-first rollback to an arbitrary legacy image is **not supported**.
The automated rollback stops application writers, lets the compatible worker
drain, performs a final stable preflight, stops that worker, and verifies that
the previous image contains this durable grant contract before restoring app
and worker together. If the queue cannot quiesce or the previous image is
legacy, rollback fails closed with writers stopped. For a manual rollback use
the same ordering and run `npm run stage-grants:rollback-preflight`; it fails
closed if any session is LIVE, any effect is pending/processing, or any
participant marker remains. Keep the additive schema and the last compatible
worker image available.

On the next forward deploy, `repairNextUncoveredGrantEffect()` runs before old
jobs. If legacy code changed durable grant fields during the maintenance
window, the worker supersedes stale unleased work and appends the current state
as a new revision before contacting LiveKit. The PostgreSQL integration suite
covers `current job -> legacy unversioned mutation -> forward repair`. Never
drop the table or enum during application rollback; schema removal requires a
separate reviewed migration after a zero-backlog verification.
