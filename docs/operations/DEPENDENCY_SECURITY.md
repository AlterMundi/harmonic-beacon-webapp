# Production dependency security gate

## October remediation (#636)

Account and Listen deliver independently from `early-birds`. A dependency commit
is source qualification; exact staging, recovery and production receipts belong
in the owning issue. A Live release does not update these services. Never merge
this lane wholesale into Live.

The candidate pins Next.js 16.4.3 and retains Sharp 0.35.5 and PostCSS 8.5.25.
This covers the October Next advisories GHSA-2464-fhr4-w9xw,
GHSA-p3m5-59mp-jv5r and GHSA-673q-mjm6-r5xr. The image-processing dependency
exists even without `next/image` imports; an ingress denial alone is not proof
that every internal/vhost path is inaccessible. Use benign probes, not exploit
payloads, for verification.

The candidate also fixes production-tree transitive findings with deepmerge-ts
8.0.1, Vite 8.2.4, Zod 4.6.7 and Undici 7.30.1, plus fast-uri 3.1.9 and
Vitest/coverage 4.1.12.
Prisma client, adapter and CLI remain 7.9.1. The deepmerge override follows the
already qualified Live dependency closure; require Prisma generation and the real
Account/Listen database matrices to establish this lane's compatibility.

The temporary Prisma/deepmerge exception is retired. `npm run audit:production`
now rejects every high or critical production-tree advisory without exceptions.
Do not renew an expiry or suppress a new advisory to qualify an artifact.

## OAuth-provider migration (#640)

This separate identity candidate pins Better Auth and OAuth Provider to 1.7.14,
with the matching core/adapters and verified npm lock. It supersedes the 1.6.30
package workaround for [resource binding](https://github.com/advisories/GHSA-p2fr-6hmx-4528)
and includes the upstream [Magic Link](https://github.com/advisories/GHSA-965c-763c-88jm)
and [OAuth Proxy](https://github.com/advisories/GHSA-r4xp-prcw-77qf) fixes. Package
matching alone does not establish that the previous deployed configuration was
exploitable. Keep this migration separate from the Live app-only room delivery.

Apply `20261028100000_account_oauth_provider_17` and
`20261028100500_account_jwt_key_metadata` before selecting the new Account
and Listener images. Their transactions add storage without dropping or rewriting
historical clients, sessions, token verifiers or consent. New resource/client
link tables start empty; no resource or permission is backfilled. Existing
session-deletion cascades, confidential static clients, PKCE, grant selection and
the exact public endpoint allowlist stay enforced. The updated Account role
provisioner grants only its explicit runtime table inventory, including the
three new provider tables; it does not grant general/default table access.
JWT metadata starts null for prior keys. The existing configured EdDSA/Ed25519
fallback retains their bytes and IDs rather than generating replacement keys.

Qualify ordinary authorization-code/opaque-userinfo/ID-token flows and reject
ungranted resource indicators with `invalid_target`. Test the new resource
constraints and partial-DDL failure, preserved pre-upgrade signed sessions and
opaque tokens, revocation, and Listener's dual-cookie bridge on real PostgreSQL.

### Magic Link cutover

The upstream namespace is now `magic-link:<custom SHA256 hex>`, with a typed
`magic-link` payload. Retain the existing custom hash and delivery idempotency;
do not enable global identifier hashing for Listener or restore an untyped
cross-purpose fallback. Upgrade every server sharing verification storage in
one coordinated cutover. Existing authenticated sessions and token verifiers
remain intact. Pending pre-upgrade Magic Links must be requested again, as
specified by the [upstream release guidance](https://github.com/better-auth/better-auth/releases/tag/v1.7.7).
Their current lifetime is ten minutes. Announce this bounded interruption and
verify the application's invalid/expired-link recovery. Preserve old records
until ordinary expiry; do not rewrite them into trusted typed records, replay
queued mail, or resend links automatically. Restart incomplete OAuth/SAML sign-in
flows when required by that guidance.

### Recovery

Prove backup/restore and exact-image recovery on the isolated staging services.
Rollback selects the retained prior application images while keeping the additive
columns/tables and new evidence; never drop the new storage or restore a stale
database over later sessions. Old-style writes remain compatible, but reverting
the auth image reintroduces its old package advisories. Retain the qualified
forward candidate and the coordinated verification-storage cutover record.
Only the owning operator's actual staged and production receipts establish
delivery; a clean source audit is not a runtime claim.

## Qualification and recovery

Run `npm ci`, `npm audit --omit=dev --json`, `npm run audit:production`, the
production build, native Sharp codec roundtrips, and the owning Account OIDC and
Listen identity/audio/membership matrices. CI and production retain Node 22.22.
The Vitest peer update used npm 11.21.1 because npm 10.9.9 Arborist crashed with
`edgesOut`; npm 10 clean-install lock validation passes. No global npm change is
needed.
Read back the actual image, baked revision, installed package versions, health,
and affected user behavior in each target. Do not equate a clean lockfile with
a patched running container.

Preserve exact prior images, private configuration, backup/restore evidence and
service delivery transactions before replacement. Use Account's protected
workflow/helper and Listen's reviewed delivery contract; do not revive historical
manual scripts as a bypass. Rollback restores the exact prior compatible image
without downgrading the database. It can reintroduce dependency findings, so
retain the forward fix and record that limitation.

Tapestry and playlist have separate lockfiles and owning releases. Audit them
independently; this candidate makes no claim about their installed packages.
