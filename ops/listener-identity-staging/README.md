# Listener identity staging

This stack replaces the disposable `listener-ui-dev` process behind
`earlybirds-staging.harmonicbeacon.com` with an immutable, exact-SHA Listener
and a dedicated PostgreSQL database. It does not share the production Listener
database, volume or database network.

## Frozen topology

- Compose project: `listener-identity-staging`
- App: `listener-identity-staging-app`, loopback `127.0.0.1:13001`
- PostgreSQL: `listener-identity-staging-postgres`, no published port
- Database network: `listener_identity_staging_database`, internal
- Database volume: `listener-identity-staging-postgres`
- Egress network: `listener_identity_staging_egress`, app only
- Existing control-plane networks: `earlybirds_stream_control_internal` and
  `earlybirds_authority_private`, app only
- Image: `harmonic-beacon/listener-identity-staging:<exact-sha40>`
- Protected files:
  - `/etc/harmonic-beacon/listener-identity-staging.deploy.env`
  - `/etc/harmonic-beacon/listener-identity-staging.env`
  - `/etc/harmonic-beacon/listener-identity-staging-database.env`

The active Nginx vhost may predate the three exact Account RP routes. The
lifecycle therefore backs up the active staging vhost, installs the reviewed
version from
`ops/early-birds-preview/nginx/earlybirds-staging.harmonicbeacon.com.conf.template`,
checks its SHA-256, runs `nginx -t`, reloads only Nginx and restores the prior
file automatically if validation, reload or edge smoke fails. The template
sends this hostname to loopback port `13001`; production Listener remains on
`13000`. Account staging is prepared as confidential client
`hb-listener-staging`, but `BEACON_LISTENER_ACCOUNT_ENABLED=0` is an invariant
of this first cutover. Production Account secrets are forbidden in the staging
environment.

The canonical membership authority remains an external service, but this stack
does not reuse its production Listener credential. Before Free/membership
acceptance, provision the dedicated key ID `listener-identity-staging-v1` in
`pmp-myth-api` with a unique outbound token for membership read and invitation
redemption. Provision a second, distinct token under the same ID for authenticated
membership projections into the unique private alias
`http://listener-identity-staging:3000`. Paid-provider flags remain off. The
root-owned application env carries only those staging tokens; copying either
production Listener token is forbidden. Infrastructure health can pass before
this supervised authority seam is exercised, but Free/quota acceptance cannot
be claimed until both directions have been tested.

## Prepare

Use a clean checkout at the exact reviewed commit. Install root-owned copies
of the three example files and replace every placeholder with staging-only
values. Do not copy values from Listener production or Account production.

```bash
sudo install -d -o root -g root -m 0755 /etc/harmonic-beacon
sudo install -o root -g root -m 0600 \
  ops/listener-identity-staging/deploy.env.example \
  /etc/harmonic-beacon/listener-identity-staging.deploy.env
sudo install -o root -g root -m 0600 \
  ops/listener-identity-staging/app.env.example \
  /etc/harmonic-beacon/listener-identity-staging.env
sudo install -o root -g root -m 0600 \
  ops/listener-identity-staging/database.env.example \
  /etc/harmonic-beacon/listener-identity-staging-database.env
```

Set image tag and Git SHA to the same lowercase 40-character commit, build time
to UTC ISO-8601 and schema version to the newest reviewed migration. Listener
itself is enabled for public staging; leave Account, Free For All, payments,
withdrawal and test access off. Mona intentionally has no host Node runtime.
The lifecycle builds the exact reviewed image, verifies its embedded SHA, and
uses that image in a networkless/read-only container to validate all three
root-owned files before it starts PostgreSQL or changes runtime state.

Confirm `earlybirds_stream_control_internal` and
`earlybirds_authority_private` are internal bridges. Capture the current IDs of
`earlybirds-preview-listener-1`, `earlybirds-preview-postgres-1` and all event
containers. The lifecycle script repeats and compares those fingerprints.

## First cutover

Port `13001` is currently owned by the disposable staging-only
`listener-ui-dev`. Keep that container for rollback. The lifecycle script leaves
it serving throughout validation, image build, database startup and backup; it
stops it only at the final reversible boundary immediately before starting the
new app. Any subsequent failure restores it automatically. Do not stop or
recreate the accepted production Listener on `13000`.

```bash
sudo docker inspect listener-ui-dev --format '{{.Id}} {{.Config.Image}} {{.State.Status}}'
sudo scripts/listener-identity-staging/start.sh \
  /etc/harmonic-beacon/listener-identity-staging.deploy.env
```

The start script builds one exact-SHA image, starts only the dedicated database,
creates and verifies a pre-migration custom-format backup, stops the retained
disposable staging process, runs `prisma migrate deploy`, then starts the app
only if migration exits zero. It verifies image and health provenance and proves
protected production/event container IDs did not change. Only after the local
app is healthy does it install the reviewed staging vhost, validate and reload
Nginx, then exercise the public edge. The exact Account login, callback and
front-channel logout routes are unlogged; unknown Account suffixes fail closed.

After cutover, verify from the host and externally:

```bash
sudo scripts/listener-identity-staging/health-smoke.sh \
  /etc/harmonic-beacon/listener-identity-staging.deploy.env
sudo scripts/listener-identity-staging/edge-smoke.sh \
  /etc/harmonic-beacon/listener-identity-staging.deploy.env
```

The public response must report the exact SHA. Readiness must report the
dedicated database and Listener runtime healthy and must not report Account
enabled. The edge smoke proves the three exact Account routes reach the app's
Account-off behavior, an unknown suffix returns 404, and synthetic callback
values do not appear in Nginx access logs. Google, Account, payments and
synthetic login are separate supervised acceptance gates; never turn them on
merely to make this infrastructure smoke pass.

## Rollback

Rollback restores the backed-up staging vhost before changing the staging app
and never downgrades the database. On the first cutover, with no previous
immutable staging image, it stops the new app and restarts the retained
`listener-ui-dev` container.

```bash
sudo scripts/listener-identity-staging/rollback.sh \
  /etc/harmonic-beacon/listener-identity-staging.deploy.env
```

The pre-migration backup path is recorded under
`/var/lib/harmonic-beacon/listener-identity-staging/last-backup`. Restoring data
is a separate explicit staging maintenance operation after stopping only the
new staging app. Never run `compose down -v`, remove the dedicated volume, reuse
`earlybirds_preview_db_internal`, or point these scripts at port `13000`.
