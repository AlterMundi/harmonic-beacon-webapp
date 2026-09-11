# OPS-F Authority / PMP runtime readback

Status: partial, fail-closed operational evidence
Observed at: 2026-09-11T07:35:04Z
Target: the PMP / commerce-authority runtime on Mona

This record supersedes the catalog's earlier assumption that the canonical repository was only `SairaAsua/proyecciones-mito`. It records facts read directly from the clean production checkout and the running containers. It does **not** grant repository mutation authority or claim a successful delivery, alert-recipient test, restore exercise, or staging drill.

## Source and ownership

- Production checkout: `/opt/PMP-myth-bot`, owned by the unprivileged `debian` account.
- Checkout state: clean `main` at `52528ef9ab840133da6c8105312be3f3f58c3bb1`.
- Canonical `origin`: `Mar-IA-no/PMP-myth-bot`.
- Secondary remote: `SairaAsua/proyecciones-mito`.
- CompAII's GitHub machine identity cannot currently resolve either private repository. The existing least-privilege access request remains the mutation gate; the readable production checkout is evidence, not a substitute for repository authorization.

## Delivery and artifact identity

The checkout contains CI at `.github/workflows/ci.yml` and a Compose/systemd operations surface under `ops/`. No repository delivery workflow was present at the observed HEAD. The CI workflow used floating `actions/checkout@v4` and `actions/setup-python@v5` references, so it is not accepted as an immutable privileged-delivery graph.

Running application containers were healthy and carried source revision `272b7ed65a45b0da5c05f6fa783066a62bcb5aa5`:

| Container | Local immutable image identity |
| --- | --- |
| `pmp-myth-api` | `sha256:cdec9ee659ed047b16f9f1eb930457f18614c4ccacea3a11368a553da3263b43` |
| `pmp-myth-worker` | `sha256:9a867f4066c97c1c61ed13b31287cb239954959e5d49a1ad366513ef3c8c4d53` |
| `pmp-myth-worker-secondary` | `sha256:a8e810f208fbd75d569a3f48f15579c50ba8900a3fadb63c088f4b52c801d3ba` |

The checkout HEAD is newer than the deployed application revision because later commits include documentation and operational changes. A future delivery must bind source, every service image, workflow run and recovery receipt explicitly; the local image IDs above do not constitute registry provenance or an attestation.

## Monitoring and alerts

- `pmp-myth-monitor.timer`: enabled and active; last observed trigger `2026-09-11 07:26:53 UTC`.
- `pmp-myth-monitor.service`: last result `success`, exit status `0`.
- The monitor verifies required Compose services, API readiness, shared-RAG health, root/data disk thresholds, encrypted-backup freshness and checksum, recent failed jobs, Luna retries, and retention failures.
- The generic monitor had no `OnFailure` recipient route. A different Luna-specific probe had an `OnFailure` notification unit, but that is not evidence that general PMP failures reach an external recipient.

Therefore the service monitor is verified, while external recipient delivery remains unresolved.

## Backup and recovery

- `pmp-myth-backup.timer`: enabled and active.
- Last observed backup service execution: `2026-09-11 02:39:02 UTC`, result `0`.
- Latest encrypted backup: `pmp-myth-backup-20260911T023915Z.tar.zst.age`, 225136077 bytes; checksum verification passed.
- Backup encryption is configured with exactly two distinct age recipients.
- Retention is seven days.
- The backup currently has no configured remote replication target and no explicit required-mount setting. The monitor's default `/mnt/beacon-data` check still proves that the local backup disk is mounted separately from `/`, but this is not off-host durability.
- The repository contains checksum verification and isolated-restore tooling. No current encrypted-backup restore receipt was found. The only discovered restore-named evidence concerned an older commerce smoke fixture, not a disaster-recovery exercise.

The recovery target is documented and mechanically available, but recovery proof remains unresolved until a separately isolated decrypt/restore/verification drill produces a sanitized receipt.

## Read-only commands used

The readback used bounded commands only: `git remote -v`, `git rev-parse`, `git status --porcelain`, selected `git show`, `systemctl is-enabled/is-active/show`, filtered `docker ps`, whitelisted `docker inspect` fields, file metadata, recipient count, and checksum verification. It did not print environment values, credentials, recipient identities, participant data, database content, or message content. It made no host, service, repository, registry, or production mutation.

## Remaining fail-closed gates

1. Grant the `compaii` machine account least-privilege read/write access to the canonical private repository; do not copy personal credentials or sessions.
2. Establish an immutable, exact-head delivery workflow and explicit source/image/run binding.
3. Prove delivery of a synthetic monitor failure and recovery notification to an external recipient.
4. Configure and verify off-host encrypted backup replication.
5. Run an isolated decrypt/restore/health exercise and publish a sanitized receipt.
6. Establish an isolated sandbox/staging lane and execute the payment contract only with canonical sandbox fixtures; no real-money operation.
