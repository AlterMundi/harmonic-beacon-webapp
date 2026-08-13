# Listener consumer-withdrawal requests

This is the bounded operator flow for the public **BOTÓN DE
ARREPENTIMIENTO**. It receives and tracks a request; it never calls PayPal,
Mercado Pago or the membership authority and it never cancels or refunds by
itself.

## Runtime boundary

- Apply migration `20260813190000_listener_withdrawal_request` before exposing
  the route.
- Generate a dedicated random value of at least 32 bytes for
  `LISTENER_WITHDRAWAL_SECRET`. Install it only in the isolated Listener env,
  owned by root and mode `0600`. Do not reuse OAuth, auth, payment, mail or event
  secrets.
- The public API fails closed with `503` when the secret is absent. Public paid
  checkout stays independently OFF until the complete launch gate is accepted.
- The table contains the minimum contact data needed to find the transaction:
  email, provider and optional approximate date. It
  stores only a digest of the public receipt and HMAC-keyed network throttles;
  no raw IP, card data or provider transaction ID is accepted.

## Queue procedure (within 24 hours)

Run the CLI only from a root-owned shell with the Listener `DATABASE_URL` in a
root-only environment. Terminal capture/history must be treated as private
because `show` reveals the contact email.

```bash
npx tsx scripts/listener-withdrawal-operator.ts list 50
npx tsx scripts/listener-withdrawal-operator.ts show REQUEST_UUID
npx tsx scripts/listener-withdrawal-operator.ts acknowledge REQUEST_UUID operator-code
```

Then, outside this application:

1. correlate the email/provider/date against the canonical provider and
   membership authority;
2. contact the requester when evidence is insufficient;
3. perform the authorized provider cancellation/refund, if applicable, using
   its normal audited procedure;
4. confirm canonical membership convergence;
5. record only the bounded result in this queue:

```bash
npx tsx scripts/listener-withdrawal-operator.ts resolve REQUEST_UUID operator-code CANCELLED
```

Allowed terminal codes are `CANCELLED`, `REFUNDED`,
`CANCELLED_AND_REFUNDED`, `DUPLICATE` and `NOT_APPLICABLE`. The CLI requires an
acknowledged request, uses compare-and-set transitions and is idempotent for an
already-acknowledged row. It intentionally has no public read/status endpoint.

The operational alert should count `RECEIVED` requests older than 20 hours as
warning and any non-resolved request older than 24 hours as critical. Adding
that private metric/alert is a deployment operation; do not expose request
details or receipt codes in metrics or logs.

## Rollback

Hide the link and route or deploy the previous Listener image. Keep the
additive tables: dropping them would destroy open consumer requests. The queue
can continue to be processed with this commit's root-only CLI. No event or
payment-provider rollback is involved.
