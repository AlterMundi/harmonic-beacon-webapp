# Production dependency security gate

Baseline on 2026-08-02: `npm audit --omit=dev` reported 19 production-tree
findings: 2 critical, 11 high, 5 moderate and 1 low.

The dedicated remediation updates Next.js to 16.2.12 and the Prisma client,
adapter and CLI together to 7.9.1. The unused NextAuth/Auth.js runtime is removed
instead of retaining a pre-release authentication package with no callers.
Prisma 7.9 supports Node 22.12 or newer, and one bundled Prisma package requires
Node 22. The production image and every Node-based CI/deploy gate are therefore
pinned to the Node 22.22 LTS line; this avoids accepting an engine warning in the
same image that executes production migrations.

Next.js 16.2.12 still declares old nested PostCSS and Sharp ranges. The lockfile
overrides those two transitive packages to PostCSS 8.5.25 and Sharp 0.35.3, the
first audited versions available in the registry at review time. The application
has no `next/image` imports, but the production build and a native Sharp JPEG
round trip remain required gates because the Sharp override crosses a major.
Remove the overrides once a stable Next.js release declares fixed ranges.

`npm run audit:production` is the root pull-request and deploy gate. It parses
the structured npm audit report and fails on every high or critical finding.
The former temporary Prisma/deepmerge exception was retired early: the root
lockfile now overrides Prisma's compatible transitive range to
`deepmerge-ts@8.0.1`, and the guard contains no advisory allowlist.

The prior production `tsx` chain now resolves to `tsx@4.23.12` and patched
`esbuild@0.28.2` within the already-declared compatible range.

Prisma 7.9.1 also pins `mysql2@3.15.3` directly and reaches `fast-uri` through
its bundled development tooling. New advisories published after the original
review made both resolved versions fail the production gate. The root lockfile
therefore overrides them to the first patched compatible releases reviewed on
2026-09-03: `mysql2@3.24.3` and `fast-uri@3.1.6`. Harmonic Beacon uses
PostgreSQL rather than MySQL, but the bundled package remains part of the
installed production tree and is not exempted. Prisma generation, the full
production build and the complete test suites remain required while these
upstream pins are overridden. Remove each override once Prisma declares a
patched version itself.

Every independently deployed Node package is audited, not only the repository
root. The tapestry service is pinned to Sharp 0.35.3 after its prior 0.34 line
reported a high-severity inherited libvips advisory. CI and release now run
separate production audits for the root, `services/tapestry` and
`services/playlist-bot` lockfiles; both services currently report zero findings.

Rollback is one commit plus image rebuild: restore the root and tapestry
`package.json`/`package-lock.json` pairs, run both clean installs, rebuild the
standalone and tapestry images, and redeploy. There are no schema, migration,
session-cookie or environment changes in this dependency update.
