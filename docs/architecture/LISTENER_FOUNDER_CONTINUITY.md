# Listener Founder service-continuity projection

## Boundary

`proyecciones-mito` is the sole authority for Founder service continuity. The
Listener accepts only the private authority membership v3 read and membership
command v2 projection. Both carry the same `founder_continuity` snapshot under
the same monotonic `membership_revision`.

The browser never creates or repairs continuity. Checkout return parameters,
cookies, email, OAuth provider and provider subscription identifiers are not
commercial evidence.

## Local read model

Listener stores the current continuity snapshot in normalized columns on
`early_bird_membership_projections`. Membership and continuity are updated in
one PostgreSQL transaction and protected by one canonical command hash. A retry
of the same revision must be byte-equivalent; older revisions are stale and a
different payload at the same revision conflicts.

The snapshot contains only:

- an opaque continuity episode UUID and revision;
- ACTIVE, CANCELLED_PENDING_END, GRACE or ENDED state;
- the immutable USD 5/month Founder offer revision;
- activation and current service boundary;
- terminal timestamp and reason for an ENDED tombstone.

It contains no PII or provider subscription identifier. `ENDED` is retained
only as an audit/reacquisition tombstone and can never authorize access, price
or a Founder badge.

## Presentation and access

The account menu shows “Founding Listener” only when all of these are true:

1. the canonical membership access decision is currently allowed;
2. its source is PayPal or Mercado Pago;
3. its offer and the continuity offer are the Founder offer;
4. continuity is ACTIVE, CANCELLED_PENDING_END or GRACE.

Once paid-through or grace ends, or a terminal event ends continuity, the badge
disappears. Free, invitation, synthetic preview and Free For All do not create
continuity. A later subscription cannot reuse an ENDED Founder episode; until a
new public offer exists, re-entry fails closed in the authority.

## Experimental migration and rollback

No public subscribers exist. The forward-only migration adds continuity fields
to the membership projection, copies every command.v1 projection into an
audit-only table and clears the runtime projection before accepting command.v2.
This prevents an old command hash at the same membership revision from blocking
the first canonical v2 delivery. It also retires the old positive-only table
under a second audit-only name. Neither archive has a Prisma model or runtime
reader/writer, and neither grandfathers its synthetic rows. Authority v1/v2
contract artifacts remain only as repository history; the runtime has no
dual-read or dual-write compatibility.

Operational rollback first disables Listener/provider writers. A binary
rollback across this migration requires both the prior image and a pre-migration
database snapshot, because the older runtime cannot read the retired tables.
Without that matched pair, recover by rolling forward. An older binary that
understands permanent account eligibility is not a valid standalone rollback
target.
