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
reads the exact remote ref and both workflow runs from fixed HTTPS GitHub API
endpoints. It requires typed evidence that binds the target, source SHA, CI
run/attempt, reviewed configuration-contract SHA-256, delivery operation, and
current delivery run/attempt. It never
invokes Git in the runner checkout, consumes runner Git configuration/remotes,
or executes a runner-workspace file.

Staging and production have distinct protected environments and runner labels:
`account-staging` and `account-production`. The runner identity has no Docker,
shell, Git, or general sudo authority. Its only privileged interface is the six
verbs in `beacon-account-runner.sudoers`; every invocation carries a validated
target, source SHA, CI run/attempt, delivery run/attempt, operation, and exact
configuration-contract hash. Third-party Actions are immutable SHA-pinned, and
the privileged jobs do not check out repository bytes.
There is no generic runner, direct Compose, SSH, or manual fallback.

## Existing mechanisms retained

The helper uses only the independently installed lifecycle source at
`/usr/local/libexec/hb-account-delivery/current/source`. Its root-owned
`source.sha` must equal the requested reviewed commit, and its sorted
`manifest.sha256` must exactly enumerate every regular source file. Every
invocation checks the full trusted ancestor chain, directory/file ownership and
non-writability, regular one-link files, closed inventory, and exact bytes. The
installed helper must also equal the helper inside that source. Symlinks,
special files, extras, writable ancestors, and byte drift fail closed.

Only after those checks does the helper source the installed `lib.sh` and invoke
the installed `start.sh`, `rollback-app.sh`, health validator, receipt validator,
Compose contract, and build source. The runner checkout is never their source.
The existing migration checks, role provisioning, image provenance, health
smoke, worker checks, signal traps, and no-database-downgrade behavior remain
authoritative. The helper's lock is a no-follow regular `0600` file inside the
validated root-owned `0700` state directory; every state and receipt ancestor
back to `/` is also root-owned and non-writable by group/other. Installed
lifecycle scripts reuse that held lock rather than opening a
runner-influenced `/run/lock` pathname.

Before deployment, preflight makes a fresh encrypted target backup and fully
restores it into a network-isolated ephemeral PostgreSQL volume. Successful
restore and deletion of its container and volume are mandatory. A list-only
`pg_restore --list` result is insufficient. Missing Docker capacity, backup
mount/key/env files, exact images, or cleanup proof closes the gate.

## Receipts and recovery

Only a schema-valid `account-delivery-receipt.v1` may leave the helper. It binds:
candidate source SHA; exact current artifact source plus local image ID and digest (or literal
`unavailable-local-build`); non-secret config-contract SHA-256; previous and
explicit candidate/restored current identity; encrypted
backup hash and isolated-restore/cleanup proof; health, worker, and smoke;
CI and delivery workflow/run/attempt/head SHA; the delivery target, operation,
CI dependency and configuration hash; and rollback result. Receipts reject
secret-like keys and absolute private paths.

Normal failure retains `start.sh` automatic restoration and the workflow calls
the bounded rollback verb when a preflight state exists. Before any rollback
side effect, the helper durably compare-and-swaps the request to
`rollback-pending`. Recovery from that phase performs only positive runtime and
health verification; it never repeats the destructive rollback. Verified
completion is terminal (`rolled-back`): an identical request returns success
from the already-bound receipt without repeating rollback, while any conflict
fails closed. Preflight state and receipts use create-or-compare publication;
neither can overwrite a conflicting object. Lost return after receipt
publication converges by comparing the exact receipt before the terminal state
CAS. Status emits evidence only when receipt and terminal state agree. A
successful smoke receipt likewise advances `deployed` to terminal `delivered`
before the request can be reused for rollback.
Rollback restores only the previous Account app/worker image state and never
downgrades the database. Receipts have exactly one of three mutually exclusive
states: successful candidate deployment, verified restoration, or verified
synthetic interruption/restoration.

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
2. from an independently reviewed exact commit, create a hook/filter-free
   source archive, omit symlinks, generate the complete sorted SHA-256 manifest,
   and install the source, `source.sha`, and manifest beneath the root:root
   non-writable `/usr/local/libexec/hb-account-delivery/current` ancestor chain;
3. install the matching reviewed helper root:root `0755`, sudoers root:root
   `0440`, and validate the latter with `visudo -cf`; a repository checkout or
   commit cannot perform either installation;
4. create root:root `0700` state/receipt directories and install the existing
   Account deploy env/backups/keys/networks;
5. for production, install root:root `0600`
   `/etc/harmonic-beacon/account-production-activation` containing exactly
   `account-production-protected-environment-v1` only after environment
   protection is verified; and
6. for a staging drill, separately install root:root `0600`
   `/etc/harmonic-beacon/account-staging-synthetic-fixture` containing exactly
   `synthetic-non-product-v1` after confirming no product input is used.

Until all applicable gates exist, the helper fails closed. This commit performs
no installation, dispatch, staging drill, or production operation.
