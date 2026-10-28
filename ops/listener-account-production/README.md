# Listener production Account preparation

This package prepares the production Listener relying-party secret without
changing the running Listener or enabling Account. It deliberately precedes
the coordinated Account/Listener cutover.

## Existing owner-operated release path

After the first cutover, these same root helpers support ordinary immutable
Listener releases, including dependency patches. Use only a root-owned clean
release checkout at the exact qualified source; never execute them from a
runner checkout or a development tree writable by application/service users.
Authorization comes from the human's selected operation, not SSH access.

Prove the candidate and rollback/forward on isolated identity staging first.
Both Compose builds use the same root Dockerfile and build-argument contract: retain
the tested image ID and tag that exact image for production instead of rebuilding
it. Verify its baked SHA/schema and non-root access to public assets. Capture
actual prior image IDs and verify their commit-tag references resolve to those
same IDs; preserve them independently. Retain the private activation state for
the explicit rollback helper. No database downgrade or stream/worker restart is
part of an app-only patch.

The separate `listener-delivery/v1` runner contract remains inactive until its
external installation and protected-runner setup are complete. Owner operation
does not install or activate that automation or expand another operator's grants.

For subsequent releases while Account is already enabled, retain the existing
root-owned relying-party bundle and run `preflight.sh <sha40>` followed by
`activate.sh <sha40>`. `prepare.sh` is first-cutover preparation and deliberately
rejects an Account-enabled runtime; do not disable Account to update an app.
When a candidate adds a public route, install its reviewed exact Nginx location
on isolated staging first, test the actual HTTPS boundary, then apply the same
bounded location to production with `nginx -t` and a reload. Keep a copy of the
prior vhost for recovery; app activation does not update host Nginx.

## Preparation and activation

1. Build the exact reviewed `early-birds` SHA as
   `harmonic-beacon/earlybirds-preview-listener:<sha40>`, with
   `EARLYBIRDS_PREVIEW_SCHEMA_VERSION` equal to the exact
   `BEACON_ACCOUNT_SCHEMA_VERSION` production coordinate. Activation rejects a
   correctly tagged image carrying an older schema label.
2. Run `sudo scripts/listener-account-production/prepare.sh <sha40>` on Mona.
   It reads the root-only Account and Listener env files in a networkless,
   read-only candidate container. The resulting two-key bundle is installed at
   `/etc/harmonic-beacon/listener-account-production.env` as root:root 0600.
3. Do not copy the bundle into the running Listener env and do not set
   `BEACON_LISTENER_ACCOUNT_ENABLED=1` yet.
4. After Account production has a reviewed public TLS edge and is fully ready,
   run `sudo scripts/listener-account-production/preflight.sh <sha40>`. It
   exposes only the dedicated RP client secret to a bounded egress probe and
   proves readiness, discovery, JWKS, Basic authentication and session-status.
5. After fresh Listener DB/env backups, run
   `sudo scripts/listener-account-production/activate.sh <sha40>`. It generates
   the Account-on env inside the exact networkless image, atomically installs
   it, recreates only the Listener app, and keeps rollback active through local
   and public login smokes. It does not rebuild/restart the stream origin,
   PostgreSQL, withdrawal worker, payments, LiveKit or event services.
   Subsequent immutable Listener releases use this same command while Account
   is already on. The generator then requires the active production RP secrets
   to match the protected bundle exactly and rejects any reintroduced legacy
   Google, Apple or magic-link credential before replacing the app.
6. The printed root-only activation directory is the only accepted argument to
   `rollback.sh`. Rollback restores the exact prior Account mode, env and image;
   it never downgrades the shared database.

The first Account production migration revokes legacy Listener authentication
sessions. Therefore Account migration, Listener env activation and the public
edge change belong to one maintenance boundary with fresh backups and rollback.
This preparatory package does not perform that boundary and does not require a
DNS record.
