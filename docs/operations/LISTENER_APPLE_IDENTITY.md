# Listener Sign in with Apple

> **Legacy cutover note:** this document describes the direct Listener provider
> runtime that remains relevant only until the central Account production
> cutover or for its rollback. Do not create new direct-Listener Apple clients
> from it. New staging and production provider setup belongs to the central
> Account authority and must follow
> `docs/operations/BEACON_ACCOUNT_SOCIAL_PROVIDERS.md`.

Apple identity is provider-neutral, fail-closed and default-off. Google keeps
its explicit account chooser. No provider may implicitly link itself to an
existing Listener account merely because an email address matches.

## Runtime contract

- `BEACON_LISTENER_APPLE_ENABLED=1` is the only enable switch. Apple has no
  legacy aliases: this new, unreleased integration starts canonical-only.
- The switch, Services ID and client-secret JWT must come from one complete
  environment generation. Partial or mixed bundles fail readiness.
- Readiness requires an HTTPS auth base and a structurally valid, unexpired
  ES256 Apple client-secret JWT scoped to the configured Services ID. Apple is
  still the cryptographic verifier during the token exchange.
- Missing credentials, an expired JWT or the switch at `0` removes Apple from
  the public provider list. Google and magic link remain independent.
- The Apple Services ID must admit both reviewed web domains and exact return
  URLs:
  - `listen.harmonicbeacon.com` →
    `https://listen.harmonicbeacon.com/api/early-birds/auth/callback/apple`
  - `earlybirds-staging.harmonicbeacon.com` →
    `https://earlybirds-staging.harmonicbeacon.com/api/early-birds/auth/callback/apple`
- OAuth state is one-use, database-backed and paired with an HttpOnly signed
  state cookie. Provider linking and implicit email linking remain disabled.
- Apple may supply name only on first consent and may omit email later. The
  Apple subject identifies the provider account; missing profile fields map to
  a neutral name and a deterministic, non-deliverable opaque local address.

## One-time Apple setup

An Apple Developer Program Account Holder or Admin with 2FA must create or
confirm:

1. the primary App ID with Sign in with Apple enabled;
2. a Services ID used as `BEACON_LISTENER_APPLE_CLIENT_ID`;
3. both Listener web domains and exact callbacks above;
4. Team ID, Key ID and a Sign in with Apple private `.p8` key;
5. an ES256 client-secret JWT whose `iss` is the Team ID, `sub` is the Services
   ID, `aud` is `https://appleid.apple.com`, `kid` is the Key ID and lifetime is
   no longer than six months.

Generate the JWT outside the repository from the Team ID, Key ID, Services ID
and `.p8`. Install only the Services ID and generated JWT
through the root-owned Listener environment or approved secret manager. Never
paste the `.p8`, JWT, IDs or 2FA material into chat, GitHub, logs or client-side
variables. Keep `BEACON_LISTENER_APPLE_ENABLED=0` while installing them.

## Cutover and supervised acceptance

1. Confirm the secret file is root-owned, mode `0600`, and not mounted into an
   event or Live service.
2. Install the complete canonical Apple bundle in the Listener release
   environment with `BEACON_LISTENER_APPLE_ENABLED=0`, then restart only the
   isolated Listener container and verify `/api/health/ready`.
3. Start the disposable staging Listener with Free For All disabled and
   `LISTENER_UI_PREVIEW_APPLE_ENABLED=1`. The preview launcher always overwrites
   the inherited Apple gate, so a future public enablement can never turn Apple
   on in staging accidentally. Verify readiness again.
4. Complete the staging acceptance first, then a first production Apple
   consent, logout, repeat consent (where name may be
   absent), and “Use another account” recovery after an intentionally failed
   callback. Confirm Google still displays its account chooser.
5. Confirm no email-match linking occurred and only one Listener provider
   account was used across the repeated Apple consent.

Staging rollback is restarting the preview without
`LISTENER_UI_PREVIEW_APPLE_ENABLED=1`. Production rollback is
`BEACON_LISTENER_APPLE_ENABLED=0` followed by recreating only the Listener
container. This hides Apple without changing Google, sessions, audio,
membership, payments or events. If credentials are not yet available, their
safe installation plus the supervised browser acceptance above are the only
human actions remaining.

Rotate before JWT expiry by generating a replacement from the same reviewed
Team ID, Key ID, Services ID and protected `.p8`, replacing the root-owned JWT
atomically, recreating Listener and confirming readiness before removing the
superseded JWT from its old environment location. Keep the `.p8` protected (or
revoke its Apple key deliberately); never discard it as part of routine JWT
rotation. A separate staging client secret is not required unless
Apple account policy explicitly mandates it; each runtime keeps its own
independent `APPLE_ENABLED` gate.
