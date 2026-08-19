# Beacon Account authority v1

Status: frozen pre-public implementation contract.

## Boundary

Account is the only interactive credential authority:

- production issuer: `https://account.harmonicbeacon.com`
- staging issuer: `https://account-staging.harmonicbeacon.com`

Production and staging use separate databases/schemas, secrets, cookies,
providers and issuer records. Account cookies are `__Host-`, Secure, HttpOnly,
Path `/`, have no Domain, and never cross into Listener, Live or the public
site. A staging credential cannot resolve or mutate a production account.

The canonical production account ID remains the existing opaque
`early_bird_users.id`; product, membership and payment foreign keys survive the
cutover. Staging materializes a deterministic issuer-bound local ID instead.
Email/provider identity is never staff, event, membership or payment authority.

The reviewed sibling-origin and dangling-record inventory is maintained in
[`docs/security/BEACON_SUBDOMAIN_INVENTORY.md`](../security/BEACON_SUBDOMAIN_INVENTORY.md).
It is a production Account gate. DNS changes remain a human/operator action;
repository automation must never modify DNSExit.

## Fixed access method and Beacon profile

Every account has exactly one access method: `email`, `google` or `apple`.
Linking, implicit email joins, merging and public magic-link login are absent.
The one-identity-per-account invariant is also enforced in PostgreSQL.

`beacon_profiles` is provider-independent and keyed one-to-one by account ID.
Its `display_name` is 1–60 trimmed characters and rejects Cc/Cf, bidi and
zero-width controls in application and database layers. Updates use optimistic
`revision`; the DB trigger guarantees every inserted account gets a sane
profile even if an application hook fails.

`early_bird_users.security_revision` is the account-wide revocation epoch;
sessions snapshot it and are valid only while both match. Password/email
changes, password reset and all-device logout advance the epoch and atomically
revoke sessions plus OAuth access/refresh tokens.

## Browser and mail flows

Public Account pages are `/account`, `/verify-email` and `/reset-password`.
Root `/` leads to Account. The byte-pinned local navigation receives at most a
server-derived boolean session hint; it uses no iframe and exposes no PII or
tokens. `return_to` is an exact product-root allowlist.

Credential signup is two-step. Verification, reset and email-change tokens are
hashed, one-use, at most 15 minutes, and consumed in the same Serializable
transaction as their mutation. Pages capture the query token client-side,
immediately scrub history, and send no referrer. Passwords are 8–128 characters
with no composition or complexity rules and use the single Better Auth scrypt
implementation. Verification-before-access, reauthentication, durable HMAC rate
buckets and session revocation remain independent security boundaries.

Mail uses the byte-pinned `contracts/listener-account-mail/v1` contract and a
durable AES-GCM outbox. Retry reuses the same sealed token and exact 64-lowercase
hex idempotency key. Worker command: `npm run account:mail-worker`. Its least
privilege env is DB/base URL, `BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN`, exact
32-byte unpadded-base64url `BEACON_ACCOUNT_MAIL_OUTBOX_KEY`, git SHA and optional
heartbeat path. The mode-0600 heartbeat is:

```json
{"status":"ok|degraded|error","at":"RFC3339","delivered":0,"gitSha":"sha","pendingCount":0,"oldestPendingSeconds":0,"consecutiveErrors":0,"maintenanceStatus":"ok|error","lastSuccessAt":"RFC3339|null"}
```

## OIDC relying-party contract

Better Auth and `@better-auth/oauth-provider` are pinned to `1.6.30`. Dynamic
registration is disabled. Static clients are confidential server-side clients,
`client_secret_basic` only, authorization code only, PKCE S256 required,
scopes exactly `openid profile`, public=false, subject type public, consent
skipped and end-session enabled:

| client | redirect | signed front-channel |
| --- | --- | --- |
| `hb-listener` | `https://listen.harmonicbeacon.com/api/account/callback` | `https://listen.harmonicbeacon.com/api/account/frontchannel-logout` |
| `hb-listener-staging` | `https://earlybirds-staging.harmonicbeacon.com/api/account/callback` | `https://earlybirds-staging.harmonicbeacon.com/api/account/frontchannel-logout` |
| `hb-live` | `https://live.harmonicbeacon.com/api/account/callback` | `https://live.harmonicbeacon.com/api/account/frontchannel-logout` |
| `hb-live-staging` | `https://live-staging.harmonicbeacon.com/api/account/callback` | `https://live-staging.harmonicbeacon.com/api/account/frontchannel-logout` |

Discovery is `/.well-known/openid-configuration`; JWKS is
`/.well-known/jwks.json`. Allowed provider endpoints are exact GET authorize,
GET UserInfo, GET end-session and POST token/introspect/revoke. The auth
catch-all also permits only email/social starts and Google/Apple callbacks;
Better Auth profile/link/session/password/email alternatives are 404.

ID tokens contain `iss/sub/aud/exp/iat/nonce/sid`; RPs verify JWKS, claims,
nonce/state/PKCE and exact redirect, introspect once, discard Account/provider
tokens and retain only issuer/sub/sid in a host-only local session. Private
`POST /api/account/session-status` uses client-secret Basic and exact
form-encoding; active responses contain only `active,iss,sub,sid`.

Current-device logout revokes its central session and OAuth tokens, then emits
signed two-minute front-channel URLs to every RP for that environment.
All-device logout revokes all sids. RP-initiated end-session requires a signed
ID-token hint, exact client/state/registered return and is wrapped in the same
signed front-channel contract. A central outage does not interrupt media
already issued, but new identity/authorization and lease renewal fail closed.

## Runtime and provider configuration

### Production database boundary

Production shares the canonical `earlybirds_preview` database so existing
opaque account and product foreign keys survive, but it does not share the
database owner's credential. The lifecycle derives a short-lived migration
connection from the already-running PostgreSQL container, confines that
connection to the internal DB network, and removes it after migration, backup
or verification. The long-running application and mail worker use the
non-owner `account_prod` role. Deployment creates or rotates that role only
after the reviewed migration and grants it CRUD on the explicit Account/auth
table inventory; it has no role membership, DDL, superuser, membership,
commerce or event-table access.

The first production authority migration intentionally invalidates legacy
browser sessions and one-use auth artifacts. It must therefore be deployed as
the coordinated Account → Listener identity cutover, with the encrypted
pre-migration backup already verified. Starting an internal Account container
early is not a harmless preview and is forbidden. A retry may accept the exact
target migration as already applied, but never an unknown pending/applied
migration or schema downgrade.

The dedicated Account container requires `BEACON_ACCOUNT_RUNTIME=1` and the
exact issuer Host; all non-Account routes and direct Docker Host access are 404.
Readiness uses `BEACON_DATABASE_SCHEMA_VERSION` and returns
`{status,gitSha,schemaVersion,checks:{database,mail,issuer,jwks,clients,providers}}`.
It checks the exact enabled client inventory and provider configuration.

Listener central Account is a separate default-off cutover:

- `BEACON_LISTENER_ACCOUNT_ENABLED`
- `BEACON_LISTENER_ACCOUNT_ENVIRONMENT=production|staging`
- `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET`
- `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING`
- `BEACON_LISTENER_ACCOUNT_STATE_SECRET`
- `BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING`

The root-owned deployment policy validates all four secrets are at least 32
characters and each production/staging pair differs. A runtime receives only
the two values selected by its marker: port 13000 gets production, while the
disposable 13001 launcher loads staging values from the exact root:root 0600
`/etc/harmonic-beacon/listener-account-staging.env` and strips production
values. Host/marker mismatch fails closed. Listener readiness validates only local configuration;
deployment smoke checks Account discovery/session-status egress separately so
an Account outage never creates a playback restart loop.

Google and Apple are independent. Apple is default-off.
`BEACON_ACCOUNT_APPLE_CLIENT_SECRET` is the short-lived client-secret JWT,
never the `.p8`; generate/rotate it outside Git from Team ID, Key ID, Services
ID and `.p8`. Exact callbacks are
`https://account.harmonicbeacon.com/api/account/auth/callback/apple` and
`https://account-staging.harmonicbeacon.com/api/account/auth/callback/apple`.
The exact Google/Apple registration, staging activation, human acceptance,
rollback, and rotation procedure is
`docs/operations/BEACON_ACCOUNT_SOCIAL_PROVIDERS.md`. The older direct-Listener
provider runbook is not the central Account contract.
The raw one-use Account action token exists only in its exact HTTPS mail action
URL; that surface is `no-referrer` and scrubs the query client-side before any
submission. Secrets, provider tokens and raw action tokens never enter Git,
application logs, analytics or metrics, and PII is excluded from operational
logs and telemetry.
