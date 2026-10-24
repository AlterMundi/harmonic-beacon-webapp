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

## Remaining OAuth-provider finding

The moderate [GHSA-p2fr-6hmx-4528](https://github.com/advisories/GHSA-p2fr-6hmx-4528)
remains reported for OAuth-provider 1.6.30. Account uses the upstream workaround:
no custom `validAudiences`, so only its default base URL and OIDC userinfo
resource are accepted. Authorization-code flow, opaque userinfo access tokens,
and separately verified ID tokens remain unchanged. The PostgreSQL handler
regression must reject an unrelated resource. This is a workaround, not a patched
package or proof that RFC 8707 grant binding is fixed. Provider 1.7 requires a
schema migration and changed resource semantics; deliver that as a separate
identity change.

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
