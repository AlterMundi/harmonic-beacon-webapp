# Durable stage grant effects

`SessionParticipant` is the database authority for whether a principal may
publish. LiveKit is an external projection of that state. Every change to an
existing participant's publication grant must call
`transitionParticipantGrant()` inside the transaction that changes the
business state.

That primitive locks the participant, advances its monotonic `grantVersion`,
sets `grantReconcileNeeded=true`, and inserts one `StageGrantEffectOutbox` row
for the exact revision. No caller applies the remote effect before this commit.

The only exception is first materialization of an authorized staff participant
in `resolveRoomPrincipal()`: no older remote participant or grant revision
exists, and the first token is derived from the newly persisted state. All
subsequent transitions use the outbox.

## Processing contract

- Workers claim with `FOR UPDATE SKIP LOCKED` and a time-bounded lease.
- A newer revision is ineligible while any older revision for the participant
  is incomplete.
- Every LiveKit call has a five-second application timeout. Completion and
  retry updates require the exact random claim token, so a stale worker cannot
  clear another worker's lease.
- A demotion attempts the permission update and every published-track mute
  independently. Ambiguity in either path keeps the job pending.
- Disconnect jobs remove the exact stage and Beacon-bed identities repeatedly
  through the last known token horizon.
- `grantReconcileNeeded` is cleared only after the participant's queue is empty
  and the completed revision still equals the participant's current revision.
- Token authorization is fail-closed while the marker is set. If a participant
  is absent, the remote projection is considered converged and a later token is
  still derived exclusively from the durable state.

The application worker drains these jobs before the legacy commerce-media
queue. The latter remains temporarily because the commerce v1 response exposes
historical per-entitlement removal counters; its identities are versioned and
cannot target a later commerce grant.

## Writers

The common transition is used by staff promotion/demotion, commerce credential
rotation or revocation, administrative admission revocation, promotion-code
revocation, and the retired-event stabilization script. Staff promotion also
revalidates attendee ticket and commerce state under the session transaction.

Direct force-mute is intentionally separate: it changes a track's muted state,
not the participant's publication grant. Session termination and the legacy
commerce reconciler may remove identities but do not write grant state.

## Operations

The worker is safe to run in more than one process. Monitor pending jobs by
`next_attempt_at`, oldest age, `attempts`, and `last_error_code`. A growing or
old queue means LiveKit convergence is degraded; do not clear participant
markers manually.

Before deployment, run `prisma migrate deploy`. The additive migration
backfills one job for every pre-existing participant whose reconciliation
marker is already set.

Rollback is application-first: restore the previous application while leaving
the additive table and enum in place. Do not drop the table while jobs or
markers remain. A forward repair should drain or supersede every pending job,
verify no participant has `grant_reconcile_needed=true`, and only then remove
the schema in a later reviewed migration if it is no longer needed.
