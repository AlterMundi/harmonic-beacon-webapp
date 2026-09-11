# Analytics delivery and recovery contract v2

- **Contract ID:** `hb.analytics.delivery-recovery.v2`
- **Receipt ID:** `hb.analytics.delivery-recovery-receipt.v2`
- **Build provenance ID:** `hb.analytics.build-provenance.v1`
- **Owner:** Harmonic Beacon analytics (`services/analytics`, `ops/analytics`)
- **Delivery lane:** exact current head of `release`

This contract supersedes v1 for every new analytics delivery. Historical v1
receipts remain audit history, but historical receipts are not current evidence
and cannot authorize or validate a v2 operation.

## Release and image provenance chain

1. `CI` runs on a `push` to `release` and must succeed for that exact source SHA
   and run attempt.
2. `Analytics OCI Build` starts only from the completed successful CI
   `workflow_run`. GitHub loads that workflow definition from the default
   `main` branch, so its keyless signer identity is the exact build workflow at
   `refs/heads/main`, while the checked-out and published source remains the
   exact `release` SHA. The workflow checks out that exact SHA, publishes the
   analytics image by SHA and immutable digest, includes BuildKit `mode=max`
   provenance and SBOM, emits a GitHub build-provenance attestation, and signs
   an attempt-specific provenance object with GitHub OIDC through cosign.
3. Manual `Analytics Delivery` accepts the exact source SHA, image digest, CI
   run ID/attempt, build run ID/attempt, operation, target, and—only for
   rollback—the deployment run ID/attempt being reversed. It retrieves both
   attempt-specific GitHub run records, verifies the signed build object and OCI
   attestation, and rejects any mismatched workflow path, event, branch, source,
   conclusion, run, attempt, repository, or digest.
4. Workflow-dispatch values enter shell scripts only through step `env` keys.
   Every scalar is format checked and passed as one quoted argument. The
   privileged process receives no workspace path and performs no Git operation.

The workflow's `packages: read` permission exists solely for OCI attestation
verification. The build workflow alone has `packages: write`, `id-token: write`,
and `attestations: write`.

## Installed privileged bundle

Production mutation is available only through
`/usr/local/sbin/hb-analytics-delivery`. The helper and all executable/config
inputs are installed separately as root-owned, non-writable files:

- helper: `/usr/local/sbin/hb-analytics-delivery` (`root:root 0555`);
- bundle: `/usr/local/libexec/harmonic-beacon/analytics` (`root:root 0755`),
  scripts `0555`, Compose files `0444`;
- external approved manifest:
  `analytics-delivery-bundle.sha256` (`root:root 0444`).

Every invocation checks owner, mode, link count, parent directories, exact
manifest inventory, and every SHA-256 before taking the delivery lock. Root
never reads a runner workspace, runs Git, or uses workspace Compose/scripts.
The repository files are inert installation candidates; merging this contract
does not install or activate them.

The sudoers boundary admits only that helper. The public verbs are `observe`
for non-mutating `probe|status` and `transaction` for `deploy|rollback`.
There is no independently sudoable preflight, migration, Compose, smoke, or
rollback primitive that can be reordered.

## Durable transaction and replay rules

`transaction` holds an exclusive kernel `flock` for the complete operation.
The root-owned state tree contains an attempt journal keyed by exact delivery
run ID and attempt. Every state transition is an atomic write, file fsync,
rename, and directory fsync with a generation/phase compare-and-swap check.

A replay with the same complete identity resumes from the recorded phase or
returns the exact committed receipt. A replay that changes any source, digest,
CI/build/delivery ID or attempt, target, operation, workflow identity, or
reversal identity fails closed. A terminal failed/compensated attempt cannot be
re-fired under the same identity.

Before any mutation, the transaction captures and verifies the live previous
source SHA, image ID, digest, exact Compose bytes, Compose SHA-256, and health
contract compatibility. Candidate Compose bytes are copied from the verified
installed bundle into the transaction. If a post-migration deploy step fails,
the journal records compensation intent before restoring the exact previous
image/config and verifying its saved health contract. A hard crash leaves a
phase that the next exact replay can resume; no success is inferred from
process exit alone.

## Backup, isolated restore, and migration gate

Before migration, the state machine selects one current encrypted dump, rejects
symlinks/hardlinks/empty or stale files, hashes its exact bytes, and requires an
exact two-space checksum sidecar for that selected filename. It then invokes
the installed restore verifier with the selected checksum and exact candidate
image.

The verifier decrypts to a root-private staging directory and restores only to
an attempt-specific Compose project using `compose.synthetic.yml`. Its database
name/user/network/volume/project are synthetic; the network is internal and the
file contains no production bind mount, external network, container name, or
production database role. It validates the custom dump, restores, runs the
candidate migration against the restored database, measures the expected
schema catalog, removes the project and volume, and reports cleanup
observation. Migration cannot begin before this receipt is durably journaled.

## Exact rollback

A rollback must name the exact committed deployment run ID and attempt. The
state machine verifies that deployment is still live, then restores the saved
prior Compose bytes—not the currently installed candidate Compose—and checks
the saved `previousConfigSha256`. It restores the prior image ID/digest/source
and uses the saved health-contract compatibility mode. The rollback receipt
preserves the attempted artifact as `deployment.previous` and records the
distinct restored state as `deployment.current`.

## Measured receipt bundle

A successful deploy or rollback emits one closed receipt plus six
content-addressed JSON evidence objects: health, readiness, selected backup,
isolated restore, monitor process, and durable notification state. Each object
is SHA-256 checked and binds exact target, operation, delivery run ID/attempt,
and observation time. The validator rejects stale, missing, duplicated,
mutated, foreign-attempt, secret-shaped, private-path, or self-attested proof.
The receipt binds CI, build, and delivery attempts plus the OCI subject digest.

HTTP health and readiness facts come from direct response bodies after
replacement. Backup bytes/age/checksum, restore table count/cleanup, monitor
exit/output digest, and notification phase come from direct local
observations. Labels such as `proofId` or caller-supplied booleans do not count
as evidence.

## Synthetic interruption/recovery drill

`synthetic-delivery-drill.mjs` uses only the installed isolated synthetic
Compose target. It first observes the exact prior image on that target, replaces
it with the candidate, waits until candidate health/provenance is observed,
then the parent process sends the worker a real external `SIGKILL`. A second
locked worker resumes from the fsynced journal, restores and observes the exact
prior image/config, removes the synthetic containers/network/volume, and writes
a measured result. Root execution cannot select the file test driver. The drill
must never address the production Compose project, production database, data
mount, network, or container names.

## Durable failure and recovery notifications

Monitor failure/recovery state lives under
`/var/lib/harmonic-beacon/analytics-monitor-notification`, not `/run`. Before
posting a failure the notifier persists `failure-pending` with one stable
`startsAt`; after acceptance it persists `failure-sent`. Recovery first
reconciles a pending failure, then persists `recovery-pending` with a stable
`endsAt`, posts the matching resolved alert, and finally persists `healthy`.
Replays post the same Alertmanager identity/timestamps, allowing Alertmanager
deduplication across crash windows. Calls serialize with `flock`.

An accepted local Alertmanager HTTP response proves route acceptance, not an
external recipient. Recipient delivery remains unproven until independently
observed outside this repository and is reported honestly as `unproven` in the
v2 receipt. Notification failure must not block or alter product traffic.

## Provisioning and hosted limits

Provisioning the GitHub environment, branch protections, default-branch build
workflow, dedicated runner with a GitHub CLI version that provides
`gh attestation verify`, root bundle/manifest, sudoers, state directories,
initial exact current-state record, backup identity, Alertmanager receiver, and
registry permissions is an external operator action. It must use separately
reviewed bytes and record the installed manifest digest. This repository does
not self-install, dispatch, publish, deploy, migrate, start services, or modify
those controls.

Local CI can validate parsers, schemas, workflow syntax, adversarial replay and
notification/drill behavior with non-root isolated drivers. It cannot prove
host ownership/modes, GitHub environment protection, hosted workflow execution,
OCI publication/attestation retrieval, production backup contents, production
migration, external recipient delivery, or live rollback. Those remain explicit
hosted acceptance gates.
