# Central Beacon Account — Live/Ops RP

Live is a confidential OAuth 2.1/OpenID Connect relying party. The feature is
additive and default-off until the central issuer and exact callbacks exist.
The issuer authenticates people; Live remains authoritative for event tickets,
invitations, local staff roles and LiveKit room access.

## Runtime contract

| Environment | Issuer | Client | Callback |
| --- | --- | --- | --- |
| production | `https://account.harmonicbeacon.com` | `hb-live` | `https://live.harmonicbeacon.com/api/account/callback` |
| staging | `https://account-staging.harmonicbeacon.com` | `hb-live-staging` | `<exact Live staging origin>/api/account/callback` |

Both clients are confidential server-side clients. They require
`client_secret_basic` **and** PKCE S256. Register the exact front-channel logout
URI `<Live origin>/api/account/frontchannel-logout`. Staging pins its public
origin with the existing `TICKET_LOGIN_URL_PREFIX`; redirects never trust an
arbitrary Host value.

Runtime variables are:

- `BEACON_ACCOUNT_ENABLED=false`
- `BEACON_ACCOUNT_ISSUER_URL`
- `BEACON_ACCOUNT_CLIENT_ID`
- `BEACON_ACCOUNT_CLIENT_SECRET` (server-side only, at least 32 characters)

The RP discovers `/.well-known/openid-configuration` and requires same-origin
authorization, token, JWKS, introspection and end-session endpoints. Callback
validation includes signature/JWKS, exact issuer, audience, expiry, issued-at,
nonce, one-use state, PKCE and one server-side access-token introspection.
Provider tokens are discarded after callback and never enter PostgreSQL, logs,
cookies or browser JavaScript.

When local validation reaches 15 minutes, Live calls the fixed issuer endpoint
`POST /api/account/session-status` with `client_secret_basic` and an
`application/x-www-form-urlencoded` body containing only opaque `sid` and
`sub`. Active responses must be `200`, `no-store`, and match exact
`{active:true,iss,sub,sid}`. Inactive, malformed, mismatched or unavailable
responses fail closed for the new transition. Concurrent checks for one
issuer/subject/SID are coalesced in-process; successful timestamps are updated
conditionally on the exact local session row.

## Local authority

The host-only `hb_session` stores only a random credential digest in the DB.
Its row records central `iss`, stable opaque `sub`, and device-session `sid`.
Account validation may be at most 15 minutes old for a new protected transition;
a stale identity is revalidated through the token-free status backchannel, and
an unavailable Account fails closed. Already-issued bounded LiveKit tokens are
not recalled merely because Account discovery/status is unavailable.
Readiness therefore reports `checks.account=unavailable` while remaining ready
as long as the local database is healthy.

`TicketEntitlement.accountIssuer/accountId` is a bind-once authorization key.
One Account may own several tickets. Existing `boundEmail` remains only a
Ticket Tailor/provider audit snapshot and is never consulted in Account mode.
Promo redemption derives a non-PII digest from issuer plus subject. The event
alias defaults from the Account profile, remains editable, and is captured when
the participation is first materialized.

Staff access uses `StaffAccountBinding`: one explicit central issuer/subject per
existing local `User`. No email matching occurs. Roles, disabled state and event
policy remain local authority. Seed-time subjects are supplied through the four
`STAFF_*_ACCOUNT_SUBJECT` variables; successful staff Account login writes an
audit entry. There is no MFA claim or MFA policy in this slice.

## Routes and rollout

- `GET /api/account/login?flow=attendee|staff&next=<local path>`
- `GET /api/account/callback`
- `GET /api/account/frontchannel-logout?iss=<exact issuer>&sid=<exact sid>`
- existing `POST /api/auth/logout` revokes locally and returns the issuer
  end-session URL; `?scope=all` first revokes every local SID for the subject.

Apply the forward-only migration with the feature disabled, seed and review the
four staff bindings, register exact clients/callbacks, verify discovery and
front-channel logout, then enable staging. Rollback is the flag: legacy columns
and code remain untouched while the migration is experimental. Enabling the
flag deliberately rejects legacy email/password sessions and ticket-email
matching; there is no implicit account/email migration.
