# Analytics delivery and recovery contract v1

> Historical contract. Superseded for all new operations by
> [DELIVERY_RECOVERY_CONTRACT_V2.md](./DELIVERY_RECOVERY_CONTRACT_V2.md).
> A v1 receipt is audit history only and cannot satisfy a current delivery.

**Contract ID:** `hb.analytics.delivery-recovery.v1`
**Receipt ID:** `hb.analytics.delivery-recovery-receipt.v1`
**Owner:** Harmonic Beacon analytics (`services/analytics`, `ops/analytics`)
**Delivery lane:** exact head of `release`

This is the canonical, versioned analytics delivery contract. It preserves the
existing `harmonic-beacon-analytics` Compose project, systemd monitor/backup
timers, additive migrations, and the rule that analytics must not block product requests.
It does not authorize or activate a production deployment.

## Immutable identity

A candidate is one tuple:

1. exact 40-character source SHA at `refs/remotes/origin/release`;
2. successful `CI` Actions run whose `head_sha` is that source SHA;
3. OCI RepoDigest and image ID in `sha256:<64 lowercase hex>` form;
4. OCI `org.opencontainers.image.revision` equal to the source SHA;
5. SHA-256 of the tracked analytics Compose/systemd configuration set;
6. repository, workflow ref, run ID, and run attempt.

No item is inferred from an image tag, branch name, historical issue, mutable
file path, or operator statement. A mismatch is a hard rejection.

`/health` and `/ready` retain their existing `status` fields and add
`provenance` with schema `hb.analytics.provenance.v1`. Provenance is verified
only when the baked image revision agrees with the expected runtime revision and
all artifact/config hashes have strict forms. Otherwise every identity value is
reported as the literal `unknown`; invalid input is never reflected.

## Bounded delivery adapter

`.github/workflows/analytics-delivery.yml` is manual-dispatch only. It accepts
only `probe`, `status`, `preflight`, `deploy`, `smoke`, or `rollback`, and binds
the exact source, digest, successful CI run, workflow ref, release ref, run ID,
and run attempt. It calls only `/usr/local/sbin/hb-analytics-delivery`; it never
grants a runner Docker access, arbitrary Compose arguments, a root shell, or a
caller-selected executable.

The checked-in helper and sudoers file are installation examples, not active
host state. Production is impossible until an operator separately provisions:

- the protected `analytics-production` Actions environment;
- a dedicated runner carrying `self-hosted`, `mona`, and `analytics-delivery`;
- the reviewed helper as root-owned `0755` and sudoers file as root-owned `0440`;
- root-owned `0600` analytics environment and root-owned `0700` delivery state;
- exact OCI package access and the candidate digest on the host.

The helper preserves PostgreSQL and the Compose/systemd lifecycle. It migrates
additively, recreates only collector/worker, never runs caller-provided Compose,
and records a root-owned previous image/source/digest bound to the attempt.
Rollback accepts only that bound state and does not reverse the database.

## Receipt and current-evidence rule

`contracts/analytics-delivery/v1/receipt.schema.json` is the closed
machine-readable schema. `services/analytics/src/delivery-receipt.mjs` enforces
the cross-field and freshness rules that JSON Schema cannot express. A current
receipt includes:

- source SHA, OCI image ID/digest/revision, and config SHA-256;
- previous and current source/digest;
- provenance-verified health and readiness observations;
- backup checksum, age, and observation time;
- proof that the same backup was restored in `analytics-synthetic` isolation;
- monitor proof and both Alertmanager failure/recovery recipient proof IDs;
- repository/workflow/CI/run/attempt binding; and
- rollback requirement, result, and previous digest.

Validation requires caller-supplied expected source, image ID, digest, config hash,
CI run, workflow run, attempt, and a bounded current clock. Missing, stale,
historical, foreign, or mismatched current evidence is rejected. Secret-shaped
keys/values and absolute private paths are rejected recursively.
Historical receipts remain history and are not current evidence, even when their
old checks were valid.

## Alerts

The existing monitor still owns mount, container, source, dead-letter, backup,
checksum, storage, and quality checks. A failed systemd run posts a generic
`HarmonicBeaconAnalyticsMonitorFailed` alert to the loopback Alertmanager v2
API. The first later successful run posts resolution with identical labels.
No receiver, credential, raw payload, source row, path, or failure output is
included. Alertmanager remains responsible for its existing recipient route.

The local render and unit contract prove Alertmanager integration only. Actual
recipient delivery remains unproven until an externally observed failure and
recovery drill supplies current opaque proof IDs. A receipt claiming otherwise
is invalid.

## Synthetic interruption and recovery

`ops/analytics/compose.synthetic.yml` is a separate
`harmonic-beacon-analytics-synthetic` project/profile with a distinct database,
internal-only network, named disposable volume, exact image digest, and an
ephemeral loopback port. It has no external source network, production mount,
container name, or production database credential.

`ops/analytics/synthetic-delivery-drill.mjs` is a deterministic local state
harness. It accepts only a direct `analytics-synthetic-*` directory under the
system temporary directory, rejects symlinks and production Compose markers,
uses an exclusive create lock, and supports one interruption point after
candidate activation. On interruption it restores the exact previous
source/digest and removes attempt/lock state. This harness must not be presented
as a real staging or recipient drill; those remain activation evidence.

## Supersession and non-goals

This contract supersedes mutable/manual analytics image-delivery instructions.
Older deployment and restore receipts are preserved unchanged as historical
evidence. `docs/analytics/RUNBOOK.md` remains the operating entry point and
links here instead of duplicating mutable commands.

No Account, Listen, payment, Authority, audio, public-copy, DNS, product-traffic,
or dependency behavior is changed by this contract.
