# Listener Account Mail private contract v1

This contract lets the Account service enqueue email verification, authenticated email-change verification, and password-reset messages in the isolated Listener mail sidecar. Account remains the sole token and reauthentication authority. The sidecar validates and delivers an exact action URL; it never creates, hashes, consumes, or introspects a token.

## Endpoint

`POST http://listener-mail-api:8765/api/internal/v1/listener-account-mail/deliver`

The endpoint exists only on the private Compose network. It requires:

- `Host: listener-mail-api:8765` and no forwarding headers;
- `Authorization: Bearer <issuer-specific delivery token>`;
- `Idempotency-Key: <64 lowercase hexadecimal characters>`;
- `Content-Type: application/json`.

An accepted request returns HTTP 202 and the body in `accepted.schema.json`. An exact replay is accepted without creating another delivery. Reusing a key with different request content returns HTTP 409.

## Request variants

- `email-verification.schema.json`: `listener-email-verification.v1` / `verify_email` / `/verify-email`.
- `email-change.schema.json`: `listener-email-change.v1` / `change_email` / `/verify-email`.
- `password-reset.schema.json`: `listener-password-reset.v1` / `reset_password` / `/reset-password`.

All three variants accept only HTTPS URLs on `account.harmonicbeacon.com` or `account-staging.harmonicbeacon.com`, the exact purpose path, and a single `token` query parameter. Userinfo, fragments, explicit ports, extra parameters, and expiries beyond 15 minutes are rejected. Recipient addresses must be normalized lowercase ASCII-control-free values. Locale is exactly `es` or `en`.

The sidecar requires two distinct secrets:

- `PMP_MYTH_LISTENER_ACCOUNT_MAIL_PRODUCTION_DELIVERY_TOKEN` authorizes only `account.harmonicbeacon.com` action URLs;
- `PMP_MYTH_LISTENER_ACCOUNT_MAIL_STAGING_DELIVERY_TOKEN` authorizes only `account-staging.harmonicbeacon.com` action URLs.

Both must be present, at least 32 characters, and different. Missing/reused secrets disable the endpoint. Unknown bearer values return 401 and cross-issuer action URLs return 403. The derived issuer is part of the request digest and durable idempotency namespace. There is no legacy shared token.

The worker sends from the already authorized sender address with display name `Harmonic Beacon`. Provider timeouts with an ambiguous outcome are terminal and observable; they are never automatically replayed. On success, permanent failure, ambiguity, crash recovery, or exhausted retries, the durable Job removes the action URL and retains only delivery ID, purpose, contract version, request digest, and a scrub marker.

`SHA256SUMS` covers the schemas and fixtures byte-for-byte.
