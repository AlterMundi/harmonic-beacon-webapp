# Listen delivery and recovery contract v1

Status: **implemented but inactive**. This contract is not production authority.

This is the canonical operational entry point for the isolated Listen service.
It supersedes mutable delivery commands and evidence claims in
`docs/operations/LISTENER_LAUNCH_NOW.md` and
`docs/operations/FOUNDING_LISTENER_RELEASE_CANDIDATE.md`. Those documents stay
as historical context. In particular, historical Telegram delivery prose is
not current alert-recipient proof. `ops/listener-account-production/README.md`
continues to define the underlying production Account-RP cutover primitive; it
is wrapped here and is not modified or generalized.

## Fixed service boundary

- Repository: `AlterMundi/harmonic-beacon-webapp`.
- Integration and delivery lane: `early-birds`, unchanged.
- Service: Listen only. Account, Home, analytics and Authority/PMP adapters are
  independent.
- Candidate image namespace:
  `harmonic-beacon/earlybirds-preview-listener:<exact-lowercase-sha40>`.
- Production primitives, in their existing order:
  `prepare.sh`, `preflight.sh`, `activate.sh`, `health-smoke.sh`; recovery uses
  only the root-owned activation pointer accepted by `rollback.sh`.
- Staging wraps `scripts/early-birds-preview/start.sh`, its health smoke and its
  Listener-only rollback behavior. There is no generic runner or direct
  Compose fallback.

The adapter never changes product code, database schema, payment/OIDC behavior,
public copy, the stream origin, withdrawal worker, event services, or Account
adapter paths. Production rollback restores the previous image, environment and
Account mode and does not downgrade the database.

## Actions binding

`.github/workflows/listener-delivery.yml` has two shapes:

1. Pull requests to `early-birds` run unprivileged adapter, existing production
   primitive, and synthetic-preview contract tests on `ubuntu-latest`.
2. Manual dispatch names an exact target, bounded operation, exact lowercase
   source SHA, successful EarlyBirds CI run ID and exact CI attempt. Dispatch
   rejects a non-commit, foreign, stale, dirty or non-head source before a
   dedicated runner is selected. The CI run must be a completed successful
   `push` run of `.github/workflows/early-birds-fast-forward.yml` for that same
   SHA and lane.

Staging requires environment `listener-staging` and runner labels
`[self-hosted, mona, listener-staging]`. Production requires environment
`listener-production`, labels `[self-hosted, mona, listener-production]`, and
its environment marker `listener-production-v1`. Concurrency is per target and
never cancels an in-flight delivery. Permissions are only `contents: read` and
`actions: read`.

## Root helper contract

The tracked `listener-delivery-root` is installed externally as root-owned
`/usr/local/sbin/hb-listener-delivery` mode `0755`; its byte digest must match
the digest-pinned `listener-delivery.sudoers.example`. The root-owned checkout
must be `/srv/harmonic-beacon/early-birds`, mode `0755`, clean, at the exact
source SHA and at the exact `origin/early-birds` head. The workflow runner may
invoke only:

```text
hb-listener-delivery OPERATION TARGET SOURCE_SHA RUN_ID RUN_ATTEMPT CI_RUN_ID CI_RUN_ATTEMPT CHECKPOINT_MODE
```

`OPERATION` is exactly `probe`, `status`, `preflight`, `deploy`, `smoke`, or
`rollback`; `TARGET` is exactly `staging` or `production`; checkpoint mode is
`deliver`, except that staging deploy may use `interrupt`. All identifiers are
validated again inside the helper. A nonblocking root lock rejects concurrent
operations. No caller-selected executable, path, Docker argument, shell text,
Git argument, Compose file, environment file, or rollback state is accepted.
The helper invokes only fixed reviewed scripts and derives rollback state from
root-owned pointers.

The sudoers example grants no `docker`, `git`, shell, editor, file-copy or
package-manager command. Its globs are defense in depth only; the helper is the
argument validator. Install and validate it with `visudo -cf` only during the
separate privileged provisioning ceremony.

## Current evidence gates

Every probe, preflight, deploy, smoke, or rollback fails closed unless checked-in
Authority inventory verification passes and these externally produced,
root-owned `0600` JSON proofs exist under the helper's state root:

```json
{"schema_version":"authority-contract-proof.v1","membership_contract_sha256":"<lowercase-sha256>","status":"matched","expires_at":"<UTC RFC3339>"}
```

```json
{"schema_version":"alert-recipient-proof.v1","proof_sha256":"<lowercase-sha256>","status":"verified","expires_at":"<UTC RFC3339>"}
```

The Authority hash is the SHA-256 of the checked-in
`contracts/early-bird-membership/v2/SHA256SUMS` after both that inventory and
the Authority v3 inventory verify.
The proof must match that hash and both proofs must be unexpired. The alert proof
contains no recipient identity; its digest refers to independently retained
private evidence. An absent, expired, malformed or mismatched proof is
**unresolved**, not a warning and never inferred from prose. The helper also
reads the public GitHub Actions API and revalidates both supplied run IDs,
attempts, workflow paths, lane and source SHA before any host operation.

## Receipt contract

`receipt.schema.json` defines `listen-delivery-receipt.v1`. Successful delivery
and explicit recovery emit a receipt that binds:

- exact source SHA and source-bound image reference;
- Docker image ID and digest, or a typed explicit digest-unavailable state;
- one deterministic hash combining the tracked contract inventory with the
  exact runtime-config bytes (the bytes themselves never enter the receipt);
- previous and current image and Account mode;
- health and readiness results;
- Authority membership-contract hash and current match status;
- current alert-recipient proof status and proof-file content hash;
- repository, lane, exact delivery workflow, run ID/attempt, exact CI workflow,
  CI run ID/attempt;
- rollback result, restored image/mode, recovery-evidence and cleanup status.

The validator rejects unknown or missing fields, unresolved evidence, uppercase
or abbreviated hashes, absolute paths and secret/private-path field names.
Receipts contain no credentials, recipient identity, private evidence, env
values, rollback-directory paths, host paths or other secret-bearing material.
A successful command without a valid receipt is not delivery evidence.

## Staging interruption checkpoint

`scripts/listener-delivery/staging-preview.sh` arms `EXIT/HUP/INT/TERM` recovery
before starting the candidate through the existing preview launcher. A separate
root-owned candidate env is validated first; the active staging env remains the
prior-state record until the candidate is healthy, then changes atomically. The
adapter records the prior Listener state, verifies the synthetic preview
contract, runs the existing health/readiness smoke, then writes an exact-SHA
interruption checkpoint. A staging-only `interrupt` drill delivers `TERM` at
that checkpoint; the trap restores the exact prior active env and Listener
image/mode (or prior stopped state), keeps the database/origin/withdrawal
operator outside the mutation, and records cleanup status. Tests exercise this
with file-only synthetic fixtures under a disposable directory; no product
data, provider, staging host or real payment is used.

No real staging interruption drill was run while adding this adapter.

## Activation gates still external

Production remains impossible until all of the following are provisioned and
read back outside this commit:

1. `early-birds` and `listener-production` receive the intended GitHub
   protections and required reviewers.
2. Dedicated Mona staging/production runner labels and environment isolation
   exist.
3. The root-owned checkout, exact helper, digest-pinned sudoers entry, active
   staging env and separate exact-SHA staging candidate env are installed and
   pass host-side provenance checks.
4. Current Authority-contract and alert-recipient proof receipts exist.
5. The exact source image exists locally with matching baked provenance and a
   fresh successful EarlyBirds CI run is supplied.
6. A synthetic staging delivery and interruption recovery drill produce valid
   receipts before any production dispatch.

There is no direct Compose, generic-runner, SSH, browser-session, copied
credential or manual-script fallback when any gate is absent.
