# Beacon Account deployment

The Account authority uses one immutable application image with separate,
root-owned production and staging configuration. The production lifecycle is a
deliberate maintenance boundary: the first migration installs the Account
authority in the protected Listener database and revokes legacy Listener auth
sessions. It never changes DNS.

## Production preparation

Before requesting DNS, all of these gates must be green:

1. the exact reviewed SHA is checked out cleanly on the host;
2. `harmonic-beacon/account:<sha40>` and
   `harmonic-beacon/earlybirds-preview-listener:<sha40>` have baked provenance
   matching that SHA;
3. `ops/beacon-account/validate.mjs` accepts the five root-owned env files in a
   networkless candidate container;
4. `scripts/listener-account-production/prepare.sh <sha40>` produces the dormant
   two-key Listener RP bundle while the active Listener remains Account-off;
5. `account_check_production_migrations before` reports exactly the reviewed
   pending migration list;
6. staging email/password, provider, profile, switching and RP acceptance gates
   required for the release are recorded.

## DNS and certificate boundary

DNSExit is a human-operated critical system. Repository scripts must not change
it. Only after the operator is explicitly asked, create exact A/AAAA records for
`account.harmonicbeacon.com` pointing at the reviewed Mona addresses. Do not add
a CNAME or wildcard.

While the certificate is absent, install only
`nginx/account-acme-bootstrap.conf.template`. It serves the ACME webroot and
returns 503 everywhere else; it contains no proxy or TLS listener. Run
`nginx -t`, reload, obtain the certificate through the existing certbot webroot,
and verify the certificate SAN is exactly `account.harmonicbeacon.com`.

Then install `nginx/account.harmonicbeacon.com.conf.template`, run `nginx -t`
and reload. Until the application starts, upstream failures are normalized to
503. The new hostname therefore never routes to another product and never
becomes a partially working sign-in authority.

## Coordinated activation

1. Capture protected runtime fingerprints and fresh, verified database/env/nginx
   backups.
2. Run `scripts/beacon-account/start.sh production /secure/deploy.env`. It
   checks migrations, creates and verifies the encrypted backup, migrates,
   provisions the least-privilege database role and static clients, then starts
   Account and its mail worker with rollback on failure.
3. Require Account readiness, exact issuer/discovery/JWKS, Basic-only clients,
   mail-sidecar readiness, navigation asset hash and negative-route smokes.
4. Run `scripts/listener-account-production/preflight.sh <sha40>` against the
   public Account authority.
5. Activate only the production Listener RP through its reviewed lifecycle.
   Do not re-enable direct Listener Google, Apple or magic-link identity.
6. Run human Account-to-Listener acceptance before exposing the production
   Account control in the shared navigation or enabling Live/Ops consumers.

Rollback never downgrades the database. Restore the previous application/env
state, leave the Account edge at a truthful 503 if the authority is unavailable,
and keep all RP feature flags off until readiness and acceptance pass again.
