# EarlyBird authority membership read contract v3

`GET /api/internal/v3/early-bird-memberships/{account_id}` returns membership access and one atomic
`founder_continuity` snapshot under the account lock. The object is `null` before a paid Founder
activation. `ACTIVE`, `CANCELLED_PENDING_END`, and `GRACE` preserve the USD 5 monthly category only
inside `service_through`. `ENDED` is the irreversible tombstone for this offer and never authorizes
access, price, or a badge. A later checkout requires a different public offer; absent one, authority
fails closed with `PUBLIC_OFFER_UNAVAILABLE`.

The same object is embedded byte-exactly in `early-bird-membership.command.v2`. Neither contract
contains PII, provider subscription IDs, redirects, OAuth material, or payment history. Browser
redirects, Free, invitations, promotions, and Free For All never create continuity.

Cross-field invariants are enforced by the parser because JSON Schema cannot compare sibling
values. `source` and `provider` must pair as `PAYPAL`/`paypal`,
`MERCADO_PAGO`/`mercado_pago`, or `FREE`/`null`; an unset source also requires a null provider. A PayPal continuity snapshot requires
`current_price` to equal its canonical USD 5 price exactly. Mercado Pago continuity keeps the
canonical Founder price in USD while requiring a positive ARS `current_price` derived from the
approved exchange-rate provenance.
