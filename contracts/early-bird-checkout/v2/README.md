# EarlyBird checkout command v2

This private contract is separate from the byte-vendored `early-bird-authority` membership-read
family. It adds the Mercado Pago checkout input required by
`POST /api/internal/v2/early-bird-checkouts` without changing authority v1 or v2.

Mercado Pago requires a normalized `payer_email`. Its plaintext is transient: the backend sends
it only in the provider request and excludes it from authority responses, checkout bindings,
provider events, jobs and logs. The durable intent hash includes only keyed HMAC evidence, so a
retry with another payer fails closed without making the address recoverable. Keep the previous
signing key until pending checkout intents have completed or expired before rotating it.
The command is restricted to
`provider=mercado_pago`; PayPal continues to use the authority v1 checkout command.

The route remains protected by the private EarlyBird authority credentials and the independent
paid-checkout gate. Provider configuration is TEST-only and disabled by default.
The authority v1 checkout route fails closed for Mercado Pago because it cannot carry the required
transient payer email; PayPal remains on v1 without semantic changes.
