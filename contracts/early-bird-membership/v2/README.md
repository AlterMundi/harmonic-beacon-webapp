# EarlyBird membership projection contract v2

`PUT /api/internal/v2/early-bird-memberships/{account_id}` atomically projects membership and the
Founder continuity snapshot for one `membership_revision`. The command uses RFC 8785/JCS and
SHA-256 exactly like v1. Listener applies both facts in one transaction; it must never infer
Founder from redirects, provider IDs, cookies, email, Free, invitations, or FFA.

An `ENDED` episode is an irreversible audit tombstone and removes the Founder badge and price.
The result contract remains `early-bird-membership.result.v1` because acknowledgement semantics do
not change.

Cross-field invariants are enforced by the parser because JSON Schema cannot compare sibling
values. `source` and `provider` must pair as `PAYPAL`/`paypal`,
`MERCADO_PAGO`/`mercado_pago`, or `FREE`/`null`; an unset source also requires a null provider. A PayPal continuity snapshot requires
`current_price` to equal its canonical USD 5 price exactly. Mercado Pago continuity keeps the
canonical Founder price in USD while requiring a positive ARS `current_price` derived from the
approved exchange-rate provenance.
