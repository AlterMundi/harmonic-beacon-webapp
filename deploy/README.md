# Harmonic Beacon production deployment

The production-shaped stack is the root `docker-compose.yml`: Next.js,
PostgreSQL, LiveKit, playlist fallback, tapestry and the durable commerce media
reconciler. Host Nginx terminates TLS for `live.harmonicbeacon.com` and proxies
only the public application and LiveKit signaling ports.

## Immutable OCI candidate and promotion lane

OPS-D adds a fail-closed artifact lane without replacing the existing release path during shadow:

1. `.github/workflows/oci-candidate.yml` runs only for integrated `main` source
   and only when `HB_OCI_CANDIDATES_ENABLED=true`. Hosted CI builds each
   first-party image once for `linux/amd64`, pushes exact digests, wraps the
   BuildKit SPDX/SLSA outputs in image-subject statements, signs the image and
   both evidence blobs with GitHub OIDC, and verifies those signatures. It then
   pulls every exact first-party/external digest, starts and health-checks
   isolated Postgres/LiveKit dependencies, migrates app and analytics schemas,
   starts the analytics profile and all qualified services with `--no-build`
   and `--pull never`, verifies actual container image IDs and behavior, and
   only then writes a bounded qualification receipt.
2. `scripts/ci/release-manifest.mjs` seals canonical JSON that binds source SHA
   and tree, exact candidate workflow path/ref/run/attempt, dependency/build,
   migration, Compose/overlay/public-profile bytes, image digests, signed
   evidence bytes, qualification receipt and expiry, and the current prior
   manifest hash. Rollback references are never accepted from candidate data;
   they are derived from the root-owned prior current state.
3. `.github/workflows/oci-promote.yml` pins the exact candidate workflow path
   and repository workflow ID, exact current-main checkout/SHA/tree, candidate
   run and attempt, manifest byte hash, and target profile digest. Candidate
   files are parsed only as data and never executed with Mona credentials.
4. The root-owned `hb-deploy` route remains mandatory. Every `artifact-*`
   command first verifies a root-owned implementation digest list covering the
   helper, verifier and imported manifest module. `artifact-prepare` copies
   once into a root-owned transaction, verifies those copied bytes and the
   root-owned prior state, and later commands consume only that transaction.
   Production transactions are single-active, phase checked and CAS-bound to
   the unchanged prior manifest. Compose always uses exact refs, `--no-build`
   and `--pull never`.
5. Production status verifies configured references, actual image IDs,
   running/health state for every Live service, local and public source/image/
   profile provenance, readiness, and the private network boundary before one
   atomic `current-state.json` replaces the prior state. A failed migration or
   replacement rolls back from the untouched prior state only, after the same
   grant quiescence and compatibility gates.

`HB_RELEASE_LANE_STATE` is the sole lane selector. `legacy-shadow` keeps the
existing `.github/workflows/deploy.yml` Mona/helper release path enabled while
OCI can only shadow. `oci-production` is a guarded transition state: it may be
set only after the named shadow, rollback and forward-repair evidence has been
reviewed and the host's root-owned current state has been initialized. There
are no independent enable/disable booleans that can silently select both or
neither production mutation path. Direct Docker or Compose access by the Actions user is never an authorized direct-Compose fallback.

Owner prerequisites before any real run:

- provision exact immutable first-party/external references and protect both
  environments;
- install reviewed copies of `deploy/hb-deploy-root`,
  `deploy/hb-artifact-verify.mjs` (as `hb-artifact-verify`), and
  `scripts/ci/release-manifest.mjs` at their encoded root-owned paths;
- create `ops-d-implementation.sha256` as `0600 root:root`, containing exactly
  the SHA-256 and absolute installed path of those three files, and provision
  `/etc/harmonic-beacon/registry.env` as `0600 root:root`;
- initialize `/var/lib/harmonic-beacon/releases/current-state.json` as one
  `0600 root:root` object containing the audited current manifest plus its
  bound Compose, overlay and selected public profile bytes. A legacy hash-only
  marker is insufficient because it cannot safely reconstruct rollback;
- independently pin `cosign`, verify production public settings against
  `deploy/runtime-public-config/production.json`, and complete a real shadow,
  rollback and forward-repair exercise before selecting `oci-production`.
  Production prepare also requires four `0600 root:root` files under
  `/var/lib/harmonic-beacon/releases/transition-evidence`: `shadow.json`,
  `rollback.json`, `forward-repair.json`, and `authorization.json`. The latter
  binds the exact current/candidate manifest hashes and SHA-256 of the three
  closed-schema receipts; absent, stale, malformed or mismatched evidence fails
  before any pull or runtime mutation. Root ownership and hashes make the
  accepted evidence immutable to the runner; they do not prove the drills by
  themselves, so the receipts still require the documented human review.

This repository change performs none of those GitHub, registry, host, drill or
production mutations. Until they are separately evidenced, the OCI lane is
code and test coverage rather than proof of a successful real deployment.

## Host prerequisites

- Docker Engine and Compose v2.
- `/etc/harmonic-beacon/production.env`, root-owned mode `0600`, based on
  `deploy/production.env.example`.
- `/etc/harmonic-beacon/commerce.env`, root-owned mode `0600`, based on
  `deploy/commerce.env.example`. Only `beacon-app` loads this file.
- `/etc/harmonic-beacon/livekit.yaml` and `/etc/harmonic-beacon/keys.yaml`.
- Persistent directories below `/mnt/beacon-data` for PostgreSQL, records and
  verified backups.
- The private cross-project network created once with:

  ```bash
  sudo -n docker network create --driver bridge --internal pmp_beacon_internal
  ```

  Its only permitted members are `beacon-app`, `pmp-myth-worker`, and
  `pmp-myth-worker-secondary`.

## Automated release deploy

A push to `release` runs `.github/workflows/deploy.yml` on the managed host. It:

1. runs the exact release commit through the reusable browser E2E workflow on
   a throwaway Postgres + LiveKit stack, including synthetic attendee access;
2. runs contract, unit, type and lint gates;
3. verifies both root-owned env files and the private network membership;
4. preserves the currently running app and tapestry images under independent
   immutable rollback tags;
5. builds commit-tagged app and tapestry images;
6. verifies no session is `LIVE`, stops request-serving writers, and repeats
   that check after the stop to close the check/use race;
7. applies additive Prisma migrations, drains every current grant marker with
   the candidate implementation, and verifies migration status;
8. replaces only app, commerce reconciler and tapestry; and
9. waits for app readiness plus reconciler and tapestry health.

On failure after a successful migration it first stops application writers,
drains and preflights durable stage-grant effects, stops the compatible worker,
verifies that the previous image implements the durable grant contract, and
only then restores app and worker together. An incompatible or non-quiescent
rollback fails closed rather than restarting legacy writers. A failure before
migration leaves the untouched running app in place. Tapestry is restored
independently. The helper
never uses `compose down`, deletes data or pretends that rebuilding the same tag
is a rollback.

### Runner isolation

The deploy job requires both the standard `self-hosted` label and the dedicated
`mona` label, then verifies that `hostname -s` is exactly `mona` before checkout
or any privileged command. Never register mona as an unrestricted generic
self-hosted runner: pull-request workflows also use self-hosted capacity, and
unreviewed PR code must not execute on the production host.

An organization administrator must place the mona runner in a runner group that
is restricted to this repository and the `Deploy` workflow. Keep it offline
until that restriction exists. Run the service as the dedicated
`beacon-runner` system identity: it must not belong to `docker`, `sudo`, or an
interactive-login group. The only sudo command available to that identity is
the root-owned `/usr/local/sbin/hb-deploy` entrypoint. That entrypoint validates
the exact Actions workspace, commit SHA, run id, service allowlists and every
other argument before performing the fixed release operations. It never accepts
an arbitrary command, path, container or environment value, and it pins Compose
to the tracked `docker-compose.yml` so an untracked override cannot broaden the
deployment.

Install the reviewed helper and sudo policy from an exact release checkout:

```bash
sudo install -o root -g root -m 0755 \
  deploy/hb-deploy-root /usr/local/sbin/hb-deploy
sudo install -o root -g root -m 0440 \
  deploy/beacon-runner.sudoers /etc/sudoers.d/harmonic-beacon-runner
sudo visudo -cf /etc/sudoers.d/harmonic-beacon-runner
```

When migrating an already registered runner, stop its generated service before
changing ownership, create the non-login identity, reinstall the service for
that identity, and then start it again:

```bash
cd /opt/actions-runner
sudo ./svc.sh stop
sudo ./svc.sh uninstall
sudo useradd --system --home-dir /opt/actions-runner \
  --shell /usr/sbin/nologin beacon-runner
sudo chown -R beacon-runner:beacon-runner /opt/actions-runner
sudo ./svc.sh install beacon-runner
sudo ./svc.sh start
```

Confirm both sides of the boundary: the helper preflight succeeds, while a root
shell and direct Docker access are denied.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-deploy preflight \
  /opt/actions-runner/_work/harmonic-beacon-webapp/harmonic-beacon-webapp \
  <exact-commit-sha>
! sudo -u beacon-runner sudo -n /usr/bin/id
! sudo -u beacon-runner sudo -n /usr/bin/docker ps
```

If the dedicated runner or root-owned helper is unavailable or differs from the
tracked `deploy/hb-deploy-root`, stop. There is no authorized direct-Compose or
generic-runner production fallback.

## Existing dedicated release path during shadow

While `HB_RELEASE_LANE_STATE=legacy-shadow` (and also if the state is absent),
the versioned [Deploy workflow](../.github/workflows/deploy.yml) remains the
production release path for the `release` branch; it is the shadow fallback if
the OCI experiment is abandoned, not a generic alternate command path. It
qualifies the same commit through the reusable E2E workflow, verifies the
dedicated `beacon-runner` and installed helper bytes, preserves immutable
rollback images, builds commit-tagged images, quiesces writers, applies
migrations, replaces the approved services, waits for bounded readiness,
verifies the public revision and private boundary, and rolls back automatically
after a failed post-preservation step. OCI may only observe/prepare shadow in
this state. The dedicated path can be suppressed only by the single
`oci-production` state after its separate recovery evidence gate; it is never
controlled by an independent boolean.

Do not reproduce those mutable commands in this runbook. Follow the workflow
steps and their logs for the current candidate. A deployment is successful only
when the exact `release` SHA has a completed successful Deploy run and the
public `/api/health` response reports that same `gitSha`; a green PR head or
local health response is not a deployment receipt.

For commerce rollout, also execute the synthetic ACTIVE/replay/stale/rotation/
revoke fixtures from the PMP worker and prove public GET and PUT under
`/api/internal` both return `404` before enabling real Ticket Tailor events.

## Rollback

Use an image tag/digest captured before deploy. For commerce incidents, first
put PMP in mock mode so no new commands enter. Stop the app so no grant writers
remain, keep the compatible reconciler running until pending jobs reach zero
and target identities are absent, run the stage-grant rollback preflight, then
stop the reconciler. Restore app and reconciler together only if the target
image contains both the durable stage-grant implementation and rollback
preflight. Otherwise leave writers stopped and roll forward to a compatible
image. The additive migration may remain; never drop commerce or grant tables
during an incident because they contain command ledgers and unfinished effects.

## Useful diagnostics

```bash
sudo -n docker compose --project-name app \
  --env-file /etc/harmonic-beacon/production.env ps
sudo -n docker logs --tail 200 beacon-app
sudo -n docker logs --tail 200 beacon-commerce-reconciler
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/health/ready
```

Never print production env files, authorization headers, ticket codes, email
addresses or raw request bodies while troubleshooting.
