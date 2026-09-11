# Listen delivery adapter v1

This directory defines the **inactive, fail-closed** Listen delivery contract for
`early-birds`. It does not deploy anything merely by being merged. Account,
product, payment, OIDC, and public-copy surfaces are outside this contract.

## Trust boundary

The self-hosted runner may invoke only:

```text
sudo -n /usr/local/sbin/hb-listener-delivery \
  OPERATION TARGET SOURCE_SHA DELIVERY_RUN_ID DELIVERY_RUN_ATTEMPT \
  CI_RUN_ID CI_RUN_ATTEMPT deliver|interrupt
```

The helper accepts only the six named operations (`probe`, `status`,
`preflight`, `deploy`, `smoke`, `rollback`) and the two named targets
(`staging`, `production`). It never executes Git, repository scripts,
repository Compose files, repository configuration, or a caller-selected
command. Its only privileged child is the exact installed
`/usr/bin/node /usr/local/libexec/hb-listener-delivery/v1/lifecycle.mjs ...`.
The installed lifecycle can invoke only reviewed, target-and-phase-specific
systemd unit names. There is no generic shell, Compose, Docker, Git, or
systemctl capability in sudoers.

A checkout cannot install or activate this adapter. There is deliberately no
installer. A separate protected operator ceremony must independently provision:

- `/usr/local/sbin/hb-listener-delivery`, root:root `0755`, with the exact digest
  carried in the reviewed sudoers file;
- `/usr/local/libexec/hb-listener-delivery/v1`, root:root `0500`, and its closed
  five-file lifecycle bundle, root:root `0500`;
- `bundle.manifest.json`, root:root `0400`, whose exact digest is compiled into
  the helper and independently stored in the protected GitHub environment
  variable `LISTENER_DELIVERY_BUNDLE_MANIFEST_SHA256`;
- `/var/lib/harmonic-beacon/listener-delivery`, root:root `0700`, its root:root
  `0600` lock, proof/evidence files, transaction directories, and unit-result
  outbox;
- `/etc/harmonic-beacon/listener-delivery/{staging,production}.json`, root:root
  `0600`, with the closed `listen-delivery-host-config.v1` schema;
- reviewed `hb-listener-delivery-TARGET-PHASE@.service` templates that consume
  only transaction IDs and publish no-replace measured result files;
- `/etc/sudoers.d/hb-listener-delivery`, root:root `0440`, only after
  `visudo -cf` succeeds.

The provisioning authority must obtain the helper and bundle through its own
reviewed artifact channel, compare every byte with `bundle.manifest.json`, and
record the helper and manifest digests outside the repository/runner. Copying
from a workflow checkout is forbidden. Updating the repository therefore
cannot replace installed privileged bytes or activate the contract.

At each real invocation the helper verifies every fixed ancestor is an actual
root-owned non-writable directory; verifies the bundle, manifest, state root,
and lock are non-symlink regular objects with exact owner/mode/link count;
checks the closed inventory and every compiled SHA-256; and acquires the
pre-provisioned lock before executing the lifecycle.

## GitHub and CI admission

The lifecycle uses the GitHub HTTPS API, never privileged Git. It binds the
exact source SHA to the current `listener-delivery.yml` workflow-dispatch run
and attempt and to the exact completed `early-birds-fast-forward.yml` push run
and attempt. The CI run is accepted only when the closed expected set is
present in both jobs and check runs, every entry belongs to the exact attempt,
and every entry is completed, successful, and non-skipped. The Listen adapter
paths trigger the early-birds fast-forward workflow. Every external Action in
both workflows is pinned to a reviewed 40-hex commit.

## Durable transaction and resume contract

Deploy and rollback use an fsynced journal keyed by:

- target and operation;
- source SHA;
- workflow-dispatch run and attempt;
- fast-forward CI run and attempt;
- protected configuration SHA-256;
- checkpoint intent.

Identity indexes, receipts, and unit results are created with no-follow,
`O_EXCL`/no-replace semantics and fsynced with their parent directory. Journal
phase transitions are revision-and-phase compare-and-swap replacements. An
exact committed replay returns the immutable receipt. Reusing a dispatch slot
with any changed binding is rejected. A completed rollback replay does not
repeat its external unit.

Before staging mutation, the snapshot unit records and the journal durably
preserves the original listener runtime, protected environment digest, and
withdrawal-operator state. Retry resumes from that journal; it never snapshots
the candidate as the previous preview. Interrupt compensation restores all
three resources and can report cleanup as proved only from a measured unit
result.

## Private Authority and recipient evidence

Authority and alert-recipient proofs are retained only under the root-owned
state directory. The installed parser accepts a small flat closed JSON object,
rejects duplicate/unknown fields and non-UTF-8 or oversized bytes, enforces the
exact purpose and status, validates real canonical UTC RFC3339 `issued_at` and
`expires_at` values, applies a two-hour maximum age/validity window, and
recomputes the retained evidence SHA-256. Receipts contain only the membership
contract digest and proof content address; they never contain member identity,
recipient address, credentials, or retained evidence.

## Receipt semantics

`receipt.schema.json` and the installed runtime validator close the same
matrix. They couple:

- real canonical UTC observation time;
- success to both measured probes passing;
- successful deploy to candidate/current image and requested/current config
  equality;
- stopped runtime to a null image;
- digest status to nullable digest evidence;
- rollback result to restored current runtime and recovery evidence;
- cleanup proof to successful compensation.

The receipt writer receives probe observations from the protected unit-result
outbox. It does not synthesize or hard-code passing probes. Receipt creation is
a durable CAS; an existing different result is a conflict.

## Workflow lifecycle

1. Pull requests run only the Listen, Account, and preview checks.
2. Dispatch is accepted only from `early-birds` and binds immutable source and
   exact run/attempt evidence.
3. `staging` uses its protected runner and environment. `interrupt` is allowed
   only for staging deploy and proves restoration.
4. `production` additionally requires the external protected-environment
   marker. Interruption is forbidden.
5. The root helper emits the immutable receipt; the workflow uploads only that
   non-secret file.

## Deliberate limits

- This repository does not provision helper bytes, bundle bytes, systemd units,
  host configuration, sudoers, runner labels, environments, or proof evidence.
- Local tests use explicit non-root `/tmp` fixtures and never mutate host or
  production state.
- A GitHub-hosted runner cannot prove Mona labels, protected environment rules,
  or host ownership/modes. Those remain external activation prerequisites.
- This adapter does not change Account behavior, product/payment semantics,
  OIDC, public copy, dependencies, or the existing early-birds lane.
