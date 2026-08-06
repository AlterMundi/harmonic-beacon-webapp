# Provider-neutral EarlyBird membership

*Accepted 2026-08-06 for the EarlyBirds milestone.*

## Decision

`proyecciones-mito` is the canonical authority. Free invitations, PayPal,
MercadoPago and future app-store providers emit one ordered, idempotent
membership projection. The web app never trusts a success redirect or provider
payload as access truth.

The founder offer is an immutable USD 2/month offer revision. Involuntary
payment failure receives 14 days of grace. Voluntary cancellation remains active
through paid-through time and then loses founder terms. Refund, dispute and
administrative revoke end access immediately.

Free invitations are signed, single-use, EarlyBird-scoped, auditable, revocable
and indefinite until used or revoked. They work in staging and production. A
Free-to-paid transition consumes the free grant.

MercadoPago displays USD 2 and the ARS equivalent from BCRA A3500, locks the
renewal amount 72 hours before collection and retains the previous valid amount
when the rate source is unavailable. Unknown or incomplete provider state fails
closed.

## Integration and rollback

All provider delivery is idempotent, ordered and reconciled. Sandbox lifecycle
tests cover duplicates, reordering, retry, grace, cancellation, refund, dispute
and revoke before any real charge is enabled. Rollback disables new checkout
and media lease issuance; durable membership evidence is preserved.
