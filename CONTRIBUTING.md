# Contributing

## License and the DCO

This repository is licensed under the [Apache License 2.0](./LICENSE), and
contributions are accepted under the same license. Apache-2.0 §5 says so in the
license text itself, so a pull request is licensed inbound on the same terms as
the project is licensed outbound. There is **no CLA** — nothing to sign, no
copyright assignment.

What we do ask is a **Developer Certificate of Origin** sign-off on each commit:

```bash
git commit -s -m "your message"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

That line is you asserting the [DCO](https://developercertificate.org/) — in
plain terms, that you wrote the patch or have the right to submit it, and that
you are contributing it under this project's license. It is a statement about
provenance, not a transfer of anything.

## What the license does not cover

The Apache license covers **code**. It does not cover audio content, and it does
not grant trademark rights — see [NOTICE](./NOTICE) for the full statement. If
your contribution includes audio, or anything that would ship as content rather
than as code, say so in the pull request, because it is governed by a different
agreement.

## Before you open a pull request

```bash
npm test              # 400+ tests, and they should stay green
npx tsc --noEmit      # zero errors, and it is worth keeping that way
npm run lint
```

`tsc` was at zero as of July 2026 after a cleanup, which is what makes it usable
as a signal. A type error introduced now is visible; a hundred are not.

There is a pre-commit hook (husky + lint-staged) that runs eslint on staged files
and the full test suite. If you need to bypass it for a work-in-progress commit,
`--no-verify` exists, but the checks above should pass before review.

## Conventions worth knowing

These are the ones that cause review comments if missed:

- **4-space indentation**, named exports, `NextResponse.json` in API routes.
- **API routes using Prisma need `export const dynamic = 'force-dynamic'`**, or
  the build tries to pre-render them and fails.
- **`session.user.id` is the Zitadel subject, not the database UUID.** Look users
  up with `prisma.user.findUnique({ where: { zitadelId: session.user.id } })`.
  This is the most common bug in this codebase.
- **Use the `requireAuth()` / `requireRole()` tuple pattern** from
  `src/lib/auth.ts` rather than calling `auth()` directly in a route.
- **Never log a caught error raw.** Route it through `redactErrorDetail` from
  `src/lib/redact.ts`. A `pg` authentication failure carries the database
  password in its message, and stdout is shipped off-host. There is a test that
  scans every `console.*` call for PII-bearing fields and fails on a match.
- **Shell out with `execFile` and an argument array, never a shell string.** See
  `src/lib/audio-duration.ts` and `src/lib/ffmpeg-mix.ts`.

## Documentation is part of the change

A policy change ships with a docs change — `docs/README.md` says so and it is
enforced by review rather than by tooling.

If you build something the documentation currently describes in the future tense,
**remove its tag in the same pull request**. The corpus uses
`**[Planned — Phase N]**` markers for anything not yet built, per
[docs/README.md](./docs/README.md#describing-what-is-not-built-yet). A tag left
behind after the code lands is the same defect as a tag missing before it — the
documentation stops matching the system, in the direction that is easier to
overlook.

## Reporting a security issue

Do not open a public issue. Contact AlterMundi directly. See
[docs/TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md) for the disclosure
posture.
