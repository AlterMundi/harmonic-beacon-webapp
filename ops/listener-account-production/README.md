# Listener production Account preparation

This package prepares the production Listener relying-party secret without
changing the running Listener or enabling Account. It deliberately precedes
the coordinated Account/Listener cutover.

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
6. The printed root-only activation directory is the only accepted argument to
   `rollback.sh`. Rollback restores the Account-off env and exact prior image;
   it never downgrades the shared database.

The first Account production migration revokes legacy Listener authentication
sessions. Therefore Account migration, Listener env activation and the public
edge change belong to one maintenance boundary with fresh backups and rollback.
This preparatory package does not perform that boundary and does not require a
DNS record.
