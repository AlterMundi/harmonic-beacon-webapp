# Harmonic Beacon production deployment

The production-shaped stack is the root `docker-compose.yml`: Next.js,
PostgreSQL, LiveKit, playlist fallback, tapestry and the durable commerce media
reconciler. Host Nginx terminates TLS for `live.harmonicbeacon.com` and proxies
only the public application and LiveKit signaling ports.

## Immutable OCI candidate and promotion lane

OPS-D adds an opt-in, fail-closed lane alongside the existing release path:

1. `.github/workflows/oci-candidate.yml` runs only for integrated `main` source
   and only when `HB_OCI_CANDIDATES_ENABLED=true`. Hosted CI builds each
   first-party image once for `linux/amd64`, pushes it, emits BuildKit SBOM and
   SLSA provenance, signs the exact `repository@sha256:...` reference with
   GitHub OIDC, and qualifies those same references with `--no-build`.
2. `scripts/ci/release-manifest.mjs` seals canonical JSON that binds source SHA
   and tree, dependency lock, build definitions, runtime policy/config hashes,
   migrations, exact first-party and external image digests, evidence hashes,
   qualification expiry, the current base manifest, and a complete rollback
   digest set. Any unknown field or mismatch fails closed.
3. `.github/workflows/oci-promote.yml` accepts only a successful candidate run
   from this repository's `main`, an operator-supplied manifest SHA-256, and a
   typed `shadow` or `production` target. The Mona job is disabled until
   `HB_OCI_PROMOTION_ENABLED=true`; production additionally uses the protected
   `production` environment. Candidate files are parsed as data and are never
   executed with Mona/production credentials.
4. The root-owned `hb-deploy` route remains mandatory. Its typed
   `artifact-*` commands verify the installed verifier, manifest, evidence,
   source/tree, current-base CAS, target config, signatures, SBOMs and
   provenance before pulling or replacing. Compose invocations always use the
   OCI overlay, exact digest references, `--no-build`, and `--pull never`.

The existing `.github/workflows/deploy.yml` build-on-Mona lane is a **shadow fallback**
only during rollout and now requires `HB_LEGACY_MONA_FALLBACK_ENABLED=true`.
It is not a second promotion mechanism and must be disabled after the OCI lane's
staging recovery drill. Direct Docker or Compose access by the Actions user is
never an authorized direct-Compose fallback; `/usr/local/sbin/hb-deploy` is the
sole privileged route.

Before either OCI workflow can leave its disabled state, an owner/operator must:

- grant the candidate workflow narrowly scoped GHCR package write/attestation
  capability and provision the named repository variables with exact digest
  values (never tags);
- protect the `shadow` and `production` environments and initialize
  `/var/lib/harmonic-beacon/releases/current-manifest.sha256` from audited live
  state;
- install reviewed copies of `deploy/hb-deploy-root`,
  `deploy/hb-artifact-verify.mjs` (as `hb-artifact-verify`), and
  `scripts/ci/release-manifest.mjs` root-owned under the paths encoded in the
  helper; provision `/etc/harmonic-beacon/registry.env` as `0600 root:root`;
- install and independently pin `cosign`, then complete a shadow qualification
  and rollback drill before enabling production promotion.

This repository change does not perform any of those owner or host mutations.

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

## Legacy shadow fallback path

While `HB_LEGACY_MONA_FALLBACK_ENABLED=true`, the versioned
[Deploy workflow](../.github/workflows/deploy.yml) remains the temporary
build-on-Mona fallback for the `release` branch. It qualifies that same commit
through the reusable E2E workflow, verifies the dedicated `beacon-runner` and
installed helper bytes, preserves immutable rollback images, builds
commit-tagged images, quiesces writers, applies migrations, replaces the
approved services, waits for bounded readiness, verifies the public revision
and private boundary, and rolls back automatically after a failed
post-preservation step. It must not be invoked as an alternative after the OCI
promotion lane is enabled for production.

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
