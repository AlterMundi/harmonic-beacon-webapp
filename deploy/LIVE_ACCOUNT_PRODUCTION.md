# Live production — central Beacon Account activation

This is a separate, reversible feature cutover after both products already run
their reviewed immutable releases. It does not build an image, run a migration,
recreate PostgreSQL, LiveKit, playlist, tapestry or commerce, or enable Apple.

## Preconditions

1. Deploy the reviewed Account production authority first. Require exact
   readiness/provenance, discovery, JWKS, mail delivery and the confidential
   `hb-live` client. Apple remains disabled until its external developer
   material exists.
2. Deploy the reviewed Live production release with Account **off**, including
   its ordinary database backup/migration and event/audio/payment regression
   gates. The running `beacon-app` image and `BEACON_GIT_SHA` must equal the
   exact release SHA before this activation begins.
   Before advancing `release`, install the exact reviewed
   `deploy/hb-deploy-root` as `/usr/local/sbin/hb-deploy` with root ownership
   and mode 0755, then require `cmp` byte equality; the deploy workflow refuses
   a stale privileged helper.
3. The live vhost must still equal the reviewed pre-Account SHA-256 pinned in
   `activate-account.sh`. A different hash is operator drift and requires a new
   review; never overwrite it by hand.
4. Run outside an event. Capture the existing protected container IDs/images,
   current Live DB counts and a fresh verified custom-format PostgreSQL backup.

The Account authority environment stays root:root 0600. Do not print, source or
copy its values through chat, shell arguments, issue comments or CI logs.

## Prepare the app-only RP bundle

From a clean checkout of the exact running Live SHA, after its exact image is
present:

```bash
sudo scripts/live-production/prepare-account.sh "$LIVE_SHA"
```

The fixed-path POSIX script reads the root-only Account file locally and copies
only the dedicated `hb-live` client secret; no container receives the full
authority environment. It writes exactly four keys to
`/etc/harmonic-beacon/live-production-secrets/account.env`, root:root 0600:
the enable flag, exact issuer/client ID and the `hb-live` client secret.
`docker-compose.yml` mounts this optional
bundle only into `beacon-app`; no other service inherits it. Merely preparing
the file does not change the already-running container. Preparation shares the
activation lock and refuses an already Account-enabled app; rotating a live RP
credential is deliberately a separate reviewed operation.

The production deploy helper uses a dedicated `migrate` service. It has only
the shared database environment and receives neither the Account bundle nor
the commerce bundle. Every future deploy boundary rejects Account secrets in
PostgreSQL, LiveKit, playlist, tapestry and the commerce reconciler.

## Activate

Record the exact Account readiness coordinates, then run:

```bash
sudo scripts/live-production/activate-account.sh \
  "$LIVE_SHA" "$ACCOUNT_SHA" "$ACCOUNT_SCHEMA"
```

The command fails before mutation unless:

- the checkout, image and already-running Live app all equal `LIVE_SHA`;
- the current app is healthy and Account-off;
- Account readiness equals `ACCOUNT_SHA`/`ACCOUNT_SCHEMA`;
- discovery is exact, only S256 + client_secret_basic are advertised, the Ed25519
  JWKS is usable and the hb-live secret authenticates session-status;
- the current Nginx vhost is the reviewed pre-Account file.

It then installs the exact no-log Account edge, reloads Nginx, and recreates
**only** `beacon-app` from the same image. Public readiness must report Account
ok; login must redirect only to Account production with `hb-live`, the exact
Live callback and PKCE S256. Callback/frontchannel method, suffix and access-log
negative smokes run before success. Protected container fingerprints must be
byte-identical. Evidence is stored root-only below
`/var/lib/harmonic-beacon/live-account-production/`.

## Human acceptance

Use a normal non-incognito browser and one production test account. Check
participant sign-in, explicit Team sign-in for a pre-bound staff identity,
canonical profile/nav, Account link, current-device logout and frontchannel
logout. Do not enter a room or exercise payments during identity acceptance.
Record no email, subject, sid, OAuth code/state, cookie or token.

## Rollback

```bash
sudo scripts/live-production/rollback-account.sh
```

The successful activation also prints a durable command inside its root-only
evidence directory. Prefer that copy if the Actions workspace has since moved
or been cleaned; its Compose, candidate Nginx and checksum manifest are stored
beside it.

Rollback moves the app-only bundle into the root-only activation evidence,
recreates only the same exact `beacon-app` with Account absent/off, verifies
readiness, then restores and reloads the prior vhost. The dormant bundle is not
deleted and production data is never downgraded or removed.
