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

`npm audit --omit=dev --audit-level=high` is a pull-request gate. At this
baseline it reports one low-severity esbuild issue limited to the Windows
development server; production runs Linux standalone output and does not expose
the esbuild development server. Review or remove that exception by 2026-09-01.

Rollback is one commit plus image rebuild: restore `package.json` and
`package-lock.json`, run `npm ci`, rebuild the standalone image, and redeploy.
There are no schema, migration, session-cookie or environment changes in this
dependency update.
