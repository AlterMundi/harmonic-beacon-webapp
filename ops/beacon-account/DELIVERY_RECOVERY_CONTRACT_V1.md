# Beacon Account delivery and recovery contract v1

Status: tracked adapter contract; **not activated**.

This contract supersedes direct execution instructions in the former
`ops/beacon-account/README.md`. Account remains in the `early-birds` lane. It
does not change Account identity, OIDC, payment, schema, or Listener semantics.

## Authority and immutable binding

`.github/workflows/account-delivery.yml` validates Account changes from pull
requests on GitHub-hosted capacity. A manual delivery accepts only the current
40-character lowercase `early-birds` tip plus the exact successful
`early-birds-fast-forward.yml` run ID and attempt. The dedicated root helper
re-fetches that remote ref, rejects stale/foreign/dirty checkouts, and verifies
both the CI run and current delivery run against the public Actions API.

Staging and production have distinct protected environments and runner labels:
`account-staging` and `account-production`. The runner identity has no Docker,
shell, Git, or general sudo authority. Its only privileged interface is the six
verbs in `beacon-account-runner.sudoers`; every invocation carries a validated
target, source SHA, CI run/attempt, delivery run/attempt, and operation.
There is no generic runner, direct Compose, SSH, or manual fallback.

## Existing mechanisms retained

The helper sources `scripts/beacon-account/lib.sh` only after exact source/CI
validation. It delegates deployment to `start.sh`, rollback to
`rollback-app.sh`, and backups to the existing encrypted backup functions. The
existing migration checks, role provisioning, image provenance, health smoke,
worker checks, locks, signal traps, and no-database-downgrade behavior remain
authoritative.

Before deployment, preflight makes a fresh encrypted target backup and fully
restores it into a network-isolated ephemeral PostgreSQL volume. Successful
restore and deletion of its container and volume are mandatory. A list-only
`pg_restore --list` result is insufficient. Missing Docker capacity, backup
mount/key/env files, exact images, or cleanup proof closes the gate.

## Receipts and recovery

Only a schema-valid `account-delivery-receipt.v1` may leave the helper. It binds:
source SHA; local image ID and digest (or literal `unavailable-local-build`);
non-secret config-contract SHA-256; previous/current revisions; encrypted
backup hash and isolated-restore/cleanup proof; health, worker, and smoke;
CI and delivery workflow/run/attempt; and rollback result. Receipts reject
secret-like keys and absolute private paths.

Normal failure retains `start.sh` automatic restoration and the workflow calls
the bounded rollback verb when a preflight state exists. Rollback restores only
the previous Account app/worker image state and never downgrades the database.

## Deterministic interruption drill

`interruption-checkpoint` is accepted only for staging and only when the
root-owned staging fixture marker says `synthetic-non-product-v1`. The checkpoint
fires after candidate app/worker cutover and before readiness, forcing the
existing trap to restore the captured previous SHA. The helper then proves the
previous app SHA, readiness, exact worker presence/SHA, smoke result, and removal
of isolated-restore resources before issuing a synthetic-interruption receipt.
Production rejects this operation.

## Activation gates

Activation is external to this change. An administrator/operator must:

1. protect the `account-staging` and `account-production` environments, restrict
   each dedicated runner group to this repository/workflow, and provision the
   exact environment contract variables documented in the workflow;
2. install the reviewed helper root:root `0755`, sudoers root:root `0440`, and
   validate the latter with `visudo -cf`;
3. create root:root `0700` state/receipt directories and install the existing
   Account deploy env/backups/keys/networks;
4. for production, install root:root `0600`
   `/etc/harmonic-beacon/account-production-activation` containing exactly
   `account-production-protected-environment-v1` only after environment
   protection is verified; and
5. for a staging drill, separately install root:root `0600`
   `/etc/harmonic-beacon/account-staging-synthetic-fixture` containing exactly
   `synthetic-non-product-v1` after confirming no product input is used.

Until all applicable gates exist, the helper fails closed. This commit performs
no installation, dispatch, staging drill, or production operation.
