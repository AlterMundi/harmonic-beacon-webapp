# Provider-neutral EarlyBird membership

*Accepted 2026-08-06 and amended 2026-08-10 for the EarlyBirds milestone.*

## Decision

`proyecciones-mito` is the canonical authority. Free invitations, PayPal,
MercadoPago and future app-store providers emit one ordered, idempotent
membership projection. The web app never trusts a success redirect or provider
payload as access truth.

The founder offer is an immutable USD 5/month offer revision. "Lifetime" means
that price remains guaranteed only while the canonical Founder subscription is
active and uninterrupted; it is not a permanent account entitlement. A pending
cancellation keeps access and Founder status through paid-through time and may
be reversed before service ends without breaking continuity. Once service
actually ends, Founder status and price eligibility end. Any later signup uses
the then-current public offer. Involuntary payment failure receives the approved
grace period, but terminal failure, refund, chargeback, dispute, fraud or
administrative termination does not preserve Founder status. Browser redirects
remain incapable of creating or erasing commercial truth.

Founder pricing, active membership, current listening authorization and
payment/reconciliation history remain separate canonical concepts, but Founder
pricing is continuity-bound rather than an immutable positive-only account
grant. A checkout start, success redirect, failed attempt or unconfirmed
provider event grants none of them.

Free invitations are signed, single-use, EarlyBird-scoped, auditable, revocable
and indefinite until used or revoked. They work in staging and production. A
Free-to-paid transition consumes the free grant.

MercadoPago displays USD 5 and the ARS equivalent from BCRA A3500, locks the
renewal amount 72 hours before collection and retains the previous valid amount
when the rate source is unavailable. Unknown or incomplete provider state fails
closed.

## Integration and rollback

All provider delivery is idempotent, ordered and reconciled. Sandbox lifecycle
tests cover duplicates, reordering, retry, grace, cancellation, refund, dispute
and revoke before any real charge is enabled. Rollback disables new checkout
and media lease issuance; durable membership evidence is preserved.
