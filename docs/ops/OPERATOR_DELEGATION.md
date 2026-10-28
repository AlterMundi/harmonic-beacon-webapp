# Beacon platform operator delegation

## Authority

On2026-10-28 Nicolás explicitly delegated to Sai all operational freedom needed
for efficient maintenance of `*.harmonicbeacon.com`, without depending on CompAII,
and requested the corresponding permissions, skills and context for Sai/Eko.
This is standing platform operating authority, not a one-deployment exception.
Sai is an operational decision maker; Eko operates under that delegation and Sai's
direction. CompAII is another contributor, never a required approver or secret
custodian in the supported path. Delivery ownership is per target and task.

The scope includes availability, incident response, scheduling/staff operation,
application and media delivery, configuration, TLS/ingress, additive migrations,
backup/restore, storage and the Beacon side of commerce integration. It includes
Live, Account, Listen, media, Analytics and the public Home repository. Preserve
unrelated host services, private data, existing resource grants and each person's
identity. No conversational-bot permission expansion follows from this appointment.
A separate provider or merchant's authority remains with that resource's owner.

Sai's existing human Staff identity retains FACILITATOR_OP: it combines the global
staff capabilities with facilitator treatment on assigned events. Machine Staff
ADMIN profiles remain separate, revocable and audited; never replace a human
identity with a machine credential.

## Independent operating path

The appointed full platform operator uses its existing authenticated SSH route
and host administration, plus repository administration in the two Beacon
repositories. A bounded Staff/API-only operator does not inherit this grant.
No additional CompAII approval, browser cookie, root secret copy or live author
conversation is required. Use the receiving private Beacon binding for exact
connection details; credentials remain in their existing root custody.

Mona's root-owned0440 full-operator policy is deliberately distinct from the
bounded Staff and app helper grants:

```sudoers
%hb-platform-operators ALL=(ALL:ALL) NOPASSWD: NOSETENV: ALL
```

Only the explicitly appointed full operator account belongs to that group.
Validate policy with `visudo -cf` and effective membership/sudo through its real
receiving SSH route. Revocation removes that membership/policy and separately
revokes machine API credentials. This grants technical host administration;
Beacon task scope still governs work on a host that also serves other projects.

Use maintained helpers for operations they express. Their app-only selection,
closed image permits and conservative scheduling guards remain useful defaults.
They are not a prohibition on the appointed full operator's owner/manual path.
If a helper cannot express an authorized dependency, migration, configuration or
recovery change, inspect the owning implementation and perform the scoped owner
procedure, or maintain the helper, with normal source review and relevant checks.
Do not reactivate a disabled generic production runner or run unreviewed PR code
with production credentials.

Before a manual replacement, retain the actual immutable image, effective private
configuration and compatible recovery. Use explicit production env files for
Compose interpolation, exact image IDs, selected-service replacement and named
persistent jobs with log/exit status. Never use `compose down`, rebuild a mutable
rollback tag, overwrite newer business state or delete ledgers to make checks pass.
For schema changes, verify the current backup and actual compatibility/restore
path. Observe real health/readiness and affected behavior; audio requires actual
media evidence. Reuse valid evidence rather than repeating unaffected suites.

Sai may select a deployment window and accept its operational impact directly.
Inspect the real schedule/activity and record the decision with the candidate,
staging/recovery proof and result. The default24-hour avoidance window and bounded
helper's refusal do not require escalation to CompAII or Nicolás. Use the owner
route for an explicit scheduling exception; do not rewrite an active transaction's
wrapper, engine or permit, falsify the agenda, or close a real event to evade a guard.

## Owning sources

Read `deploy/platform-services.json` for discovered services/domains, owning lanes,
health and workflows. A wildcard does not prove that every possible name exists.

| Surface | Maintained source |
| --- | --- |
| Live/Staff API and roles | `release:docs/ops/OPERATOR_ACCESS.md`, `deploy/LIVE_APP_RELEASE.md`, `deploy/README.md` |
| LiveKit, tapestry, playlist and real audio | `release:deploy/LIVE_MEDIA_RELEASE.md`, `docs/ops/LIVEKIT_LOAD_HARNESS.md` |
| Account/auth/provider configuration | `early-birds:ops/beacon-account/README.md`, `DELIVERY_RECOVERY_CONTRACT_V1.md`, `docs/operations/DEPENDENCY_SECURITY.md` |
| Listen and Account integration | `early-birds:ops/listener-account-production/README.md`, `ops/listener-identity-staging/README.md` |
| Analytics | `release:docs/analytics/RUNBOOK.md`, `docs/analytics/DELIVERY_RECOVERY_CONTRACT_V2.md` |
| TLS, Nginx, monitoring and bounded storage | `early-birds:ops/early-birds/runbook/README.md` and the actual root-owned host/service configuration |
| Commerce supplier boundary | `contracts/commerce-entitlement`, `docs/ops/OPS_F_AUTHORITY_PMP_READBACK.md`; supplier repository/authority remain separately owned |
| Public Home | `AlterMundi/harmonicbeacon.com`, `main:docs/ops/home-delivery-contract-v1.md` |

DNSExit changes and real payments still require the human's exact operation
instruction; ordinary deployments are not payment tests. Do not copy provider
secrets, private endpoints or unrelated customer data into issues or skill packages.

## Continuity and acceptance

The current operation and actual source/image/recovery/ownership are recorded in
[issue469](https://github.com/AlterMundi/harmonic-beacon-webapp/issues/469#issuecomment-6467050607).
Read that receipt and the actual target before continuing. Retain uncertain jobs
and completed effects; no blind replay after SSH or output failures.

Use the Beacon Operations skill, Fast Forward Mode and Review Agent from this
repository's maintained distributions. Skill installation, effective host/GitHub
access, own-harness delivery/recovery and human media acceptance are separate
observations. Missing project-local skill discovery is not a reason to defer to
CompAII: read the same versioned contract directly. If a receiving checkout is
older, fetch the owning ref and read it with `git show` while preserving active work.

Mona's existing Prometheus/Alertmanager and source monitoring run independently
of Hermes. Full host administration can inspect their state, delivery config,
metrics, bounded diagnostics and recovery without CompAII's session. Current
notification recipients and durable-incident delivery are observed configuration,
not proof that a newly appointed operator already receives pushed alerts.
