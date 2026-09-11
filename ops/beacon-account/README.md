# Beacon Account deployment

Account is the browser identity/session authority described by
[`BEACON_ACCOUNT_AUTHORITY.md`](../../docs/architecture/BEACON_ACCOUNT_AUTHORITY.md).
It remains on the `early-birds` lane and uses one immutable Account image with
separate root-owned production and staging configuration.

## Current delivery entry point

[`DELIVERY_RECOVERY_CONTRACT_V1.md`](DELIVERY_RECOVERY_CONTRACT_V1.md) is the
canonical versioned delivery and recovery contract. It **supersedes direct
operator execution of `scripts/beacon-account/start.sh` and
`rollback-app.sh`** for OPS-F delivery. Those scripts, encrypted backup
functions, migration checks, worker/readiness probes, and rollback traps remain
the underlying mechanisms invoked only by the installed root-owned helper.
There is no direct Compose, generic-runner, SSH, or manual production fallback.

Pull requests are validated by `.github/workflows/account-delivery.yml` on
GitHub-hosted capacity. Manual staging/production dispatch is inert until the
protected environments, dedicated runner labels, exact independently installed
root-owned lifecycle source/manifest and matching helper, sudoers policy, state
directories, and target-specific activation markers in
the v1 contract are externally provisioned. This repository change does not
perform that activation.

Each dispatch names the exact source SHA, prerequisite CI run and attempt,
delivery run and attempt, operation, target, and reviewed configuration-contract
SHA-256. Privileged jobs do not check out repository bytes; the helper executes
only the independently installed root-owned bundle and publishes immutable,
state-bound receipts through create-or-compare CAS.

## Production boundary retained

Production still requires the exact reviewed SHA, commit-tagged images with
matching baked provenance, root-owned env files, known Account-only migrations,
a fresh encrypted backup, and full isolated restore proof. The first authority
migration remains a coordinated identity cutover and is never a preview.
DNSExit and certificate issuance remain human/operator boundaries; repository
automation never changes DNS.

Rollback restores the prior Account app/worker image and env state without
downgrading the database. A failed or unavailable authority remains a truthful
503 and relying-party flags remain off until readiness and acceptance pass.

Receipt shape and the synthetic, staging-only interruption checkpoint are
specified and executable-tested under [`delivery/`](delivery/). The checked-in
receipt is contract data only, not evidence of a staging or production run.
