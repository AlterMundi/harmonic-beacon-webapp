# Founding Listener email magic-link boundary

Status: Listener side implemented; private mail adapter pending in
`SairaAsua/proyecciones-mito`.

This fallback reuses the deployed Google Workspace/Gmail delivery capability
without copying its OAuth grant into the Listener container. It is additive to
Google sign-in and does not touch event identity, commerce, membership or
audio.

## Listener behavior

- Public request: `POST /api/early-birds/auth/sign-in/magic-link` from an exact
  trusted Listener Origin.
- Fixed callbacks: `/early-birds` or `/early-birds/redeem`; the error callback
  is exactly `/early-birds?authError=1`.
- The response and visible message are generic for unknown addresses,
  throttling and delivery uncertainty.
- The Better Auth token is stored only as a SHA-256 verifier, expires after ten
  minutes and is consumed atomically once.
- Durable HMAC-only buckets limit each address to three attempts and each
  Origin/network-address pair to ten attempts per 15 minutes. Better Auth also
  applies a three-per-minute route limit. Stale buckets are deleted after 24
  hours.
- An address already attached to a social or supervised identity receives no
  magic link and cannot mint a magic-link session. Explicit future account
  linking requires a separate reviewed product flow.
- Verification creates the same `hb_earlybird_session` used by Google and no
  event, staff, LiveKit, payment or Founder capability.

## Required private mail contract

`POST /api/internal/v1/listener-magic-links/deliver`

Headers:

```text
Authorization: Bearer <dedicated service token>
Content-Type: application/json
Idempotency-Key: <opaque HMAC digest>
```

Body (`listener-magic-link.v1`):

```json
{
  "contract_version": "listener-magic-link.v1",
  "purpose": "listener_sign_in",
  "recipient": "listener@example.test",
  "locale": "es",
  "magic_link_url": "https://listen.example.test/api/early-birds/auth/magic-link/verify?token=opaque",
  "expires_at": "2026-08-07T12:10:00.000Z"
}
```

The endpoint must:

1. exist only on the private `earlybirds_authority_private` network under the
   existing `pmp-myth-api` alias;
2. authenticate the dedicated Bearer token in constant time;
3. accept only the schema above, ES/EN locale, an HTTPS
   `listen.harmonicbeacon.com` or staging verification URL and a future expiry
   no more than ten minutes away;
4. persist the idempotency key before queueing exactly one durable email;
5. render the bilingual subject/body inside the mail authority and never log
   the recipient, full URL, token, Bearer value or body;
6. queue through the existing Gmail/Resend `EmailGateway` and worker, retaining
   its current ambiguous-outcome semantics;
7. return a minimal `202 {"status":"accepted"}` for accepted or replayed work.

The current deployed PMP service already owns the Gmail API OAuth grant for the
Google Workspace sender and its worker/durable delivery machinery. It does not
yet expose this purpose/endpoint. That small adapter belongs in
`proyecciones-mito`; mounting the same grant in the Listener would create a
second email authority and is explicitly rejected.

## Configuration and rollout

The Listener feature remains absent unless all are set:

```dotenv
EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL=http://pmp-myth-api:8765/api/internal/v1/listener-magic-links/deliver
EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN=<32-plus random characters>
EARLY_BIRDS_MAGIC_LINK_RATE_SECRET=<32-plus independent random characters>
```

Apply migration `20260807090000_early_bird_magic_link_throttles`, configure the
mail adapter first, then install the three protected Listener values and
recreate only the isolated Listener. Rollback clears the three values and
recreates only that container; existing Google sessions and email-only sessions
remain valid until normal expiry, while no new email request route is exposed.

Browser acceptance uses a fresh address and proves request, receipt, callback,
Free schedule and Listener. Negative checks cover unknown addresses, social
address collision, expiry, alteration, replay, callback injection, throttling,
logout and Google sign-in regression. No test email should contain real
participant data.
