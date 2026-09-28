# Production dependency security gate

## Account/Listener remediation #564 (reviewed 2026-09-28)

This document describes the candidate and its exposure assessment. Exact staging
and production delivery/rollback receipts belong to #564/#590; a changed lockfile
is not proof that a running image has been patched. Deliver this candidate through
`early-birds`, independently for Account and Listener. Do not merge this lane
wholesale into Live.

The candidate pins Next.js and eslint-config-next to 16.3.6 and overrides Next's
Sharp to 0.35.5 (previously 16.2.12 / 0.35.3). Keep PostCSS 8.5.25. The confirmed
upstream fixes are Next >=16.3.3 for
[GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), and
Sharp >=0.35.4 for
[GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
The affected image-processing dependency is present even without `next/image`
imports. Before delivery, both production containers report Linux x64, Next
16.2.12, Sharp 0.35.3 and libheif 1.23.1. The Windows-specific advisory
[GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36)
does not match those platforms.

A benign request without parameters to `/_next/image` returns 400 (missing url)
on Account, proving the optimizer route is reachable. Listener's public nginx
returns 404; this does not prove every internal/vhost path is unreachable. The
Next config permits HTTPS Google user-content hosts; local paths are not disabled.
No malicious payload or exploit attempt is part of verification. Require the
production build, native Sharp roundtrips, Account OIDC regression and Listener
identity/audio/membership checks, followed by exact artifact/health readback.

Compatible transitive patches also update fast-uri to 3.1.8, mysql2 to 3.24.4,
Vitest/coverage to 4.1.11, and the existing Undici/YAML ranges to patched releases.
MySQL2 is inherited by Prisma/optional peers; production uses PostgreSQL. Pin its
compatible 3.x fix rather than accepting npm's suggested Prisma major downgrade.
Vitest's mock-server issue is not a public application endpoint; patch it anyway.
Prisma client, PostgreSQL adapter and CLI stay at 7.9.1, with no schema migration.

## Reviewed remaining findings

`npm run audit:production` rejects every unreviewed high/critical production-tree
finding. Its sole temporary exception remains
[GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), advisory
1145093, for exactly deepmerge-ts 7.1.5 through @prisma/config 7.9.1 and Prisma
7.9.1. Re-review confirmed `prisma.config.ts` constructs only repository-owned
configuration during trusted build/migration commands; it does not merge request
or user objects. Prisma still pins the vulnerable dependency, its fixed version
is a major upgrade, and Prisma 8 remains a prerelease. The guard checks advisory
identity, exact versions/paths and dependency edges; any additional high/critical
finding fails. The prior September 15 review deadline had expired; after this
review the exception expires closed on **2026-10-27**. Remove it earlier when a
supported compatible Prisma release adopts the fix.

The moderate OAuth-provider advisory
[GHSA-p2fr-6hmx-4528](https://github.com/advisories/GHSA-p2fr-6hmx-4528) remains
reported for 1.6.30. Account already uses the upstream workaround: no custom
`validAudiences`, so the provider permits only its own default base URL and OIDC
userinfo resource, not other relying parties. It enables authorization-code only,
uses opaque access tokens for userinfo and verifies ID tokens separately. The
PostgreSQL handler regression exercises a real authorization code with an unrelated
resource and requires rejection. Do not describe this as a patched package or
claim RFC 8707 grant binding is fixed. Upgrading the provider to 1.7 introduces a
schema migration and changed resource semantics; that migration is a separate
identity change, not an incidental dependency bump.

## Reproduction and recovery

Run `npm ci`, `npm audit --omit=dev --json`, and `npm run audit:production` from
the exact candidate. The clean install must agree with the committed lockfile.
The lockfile's Vitest peer resolution was generated with npm 11 after npm 10's
Arborist failed; npm 10 clean installation passed in hosted qualification.
Prisma 7 requires Node >=22.12; production/CI retain the Node 22.22 LTS line.

Independently deployed tapestry/playlist packages have separate lockfiles and
owning lanes. Audit them independently; this Account/Listener candidate does not
claim to remediate their images or prove they have zero findings.

Preserve exact prior images and delivery records before replacement. Rollback
uses those retained images and the service's reviewed helper; it does not depend
on rebuilding an old commit. There are no schema, cookie or environment changes
in this candidate. A rollback can reintroduce the dependency findings, so record
that explicitly and retain the forward-fix candidate.
