# Provider-neutral EarlyBird membership

*Accepted 2026-08-06 for the EarlyBirds milestone.*

## Decision

`proyecciones-mito` is the canonical authority. Free invitations, PayPal,
MercadoPago and future app-store providers emit one ordered, idempotent
membership projection. The web app never trusts a success redirect or provider
payload as access truth.

The founder offer is an immutable USD 2/month offer revision. The right to that
price is granted only after the first canonical paid activation and remains
attached for life to the opaque Listener account, independently of email or
identity provider. Voluntary cancellation ends active access after paid-through
time but does not remove the account's founder-price eligibility; a later
reactivation uses the founder offer again. Involuntary payment failure receives
14 days of grace. Refund, dispute and administrative revoke end access
immediately without using a browser redirect as commercial truth.

Founder-price eligibility, active membership, current listening authorization
and payment/reconciliation history are separate durable concepts. A checkout
start, success redirect, failed attempt or unconfirmed provider event grants
none of them.

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
