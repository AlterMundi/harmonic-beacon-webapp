# EarlyBird authority membership read contract v2 — retired experiment

This contract is retained only as historical evidence. No runtime may use
`founder_price_eligibility`; v3 replaces it with continuity and an irreversible ended tombstone.

This additive private read contract exposes two independent facts to Listener:

- the current membership and its server-authoritative `access_allowed` decision;
- the account's durable Founder price eligibility, when one has been earned.

`GET /api/internal/v2/early-bird-memberships/{account_id}` requires the same private
`Authorization: Bearer ...` and `X-HB-Service-Key-Id` credentials as v1. Successful membership
responses and the generic `membership_not_found` response use `Cache-Control: private, no-store`.
Authentication, disabled-service and path-validation failures retain FastAPI's existing generic
error handling. The browser must never call this endpoint.

`founder_price_eligibility: null` means that the existing account has not earned Founder pricing.
A non-null object records the immutable canonical USD 5/month offer earned by a confirmed paid
activation. It does not mean that a membership is active, that a payment succeeded recently, or
that access is allowed. Only `access_allowed` authorizes listening. Cancellation, expiry, refund or
revocation can therefore coexist with retained Founder price eligibility.

Free access, welcome access, invitations, Free For All, checkout redirects and incomplete or
terminal provider events without a prior confirmed activation never create eligibility.
`membership_revision` continues to version membership/access state; it is not an eligibility
revision. The response contains no name, email, OAuth material, payment history, provider event or
subscription identifier, stream URL or secret.

Every membership/access writer must either take the account row lock or update the account revision
before commit. The v2 read takes a shared account lock so membership and eligibility cannot be
observed across different committed writer states, while concurrent reads remain possible.

The v1 membership endpoint remains available unchanged for rollback. Invitation redemption and
checkout creation remain on the v1 authority contract; this directory versions only the read
shape added by v2.
