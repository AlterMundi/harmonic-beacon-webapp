# Retired: staying on a pre-release NextAuth

*Decided 2026-07-26.*
*Superseded 2026-08-02.*

## Decision

The original decision pinned `next-auth@5.0.0-beta.30` while Zitadel/OIDC still
provided application identity. It is no longer active. The weekend product
replaced that runtime with durable `WebSession` records for ticket-bound
attendees and seeded staff credentials, and no source file imports NextAuth or
`@auth/core`. The unused package was removed on 2026-08-02.

## Why this needed a decision at all

[PRODUCT_PRINCIPLES.md](../PRODUCT_PRINCIPLES.md) §9 prefers stable dependencies
over bleeding-edge ones, and the whole authentication layer — the trust surface
that section is most about — runs on a beta. That is a divergence between a
stated principle and the lockfile, and an undocumented divergence is the thing
the principle is supposed to prevent.

## Why it was reasonable then

There is nowhere to go. Verified 2026-07-26: npm's `latest` tag for `next-auth`
is **4.24.15**, so v5 has never shipped stable. The options were a pre-release, or
a migration back to v4 — which is its own migration, against an older API, to
arrive somewhere we would have to leave again.

So the divergence is accepted. What was not acceptable was leaving it silent.

## Why the exact pin mattered

The range was `^5.0.0-beta.30`. Under semver that caret resolves to
`>=5.0.0-beta.30 <6.0.0` — it accepts **any later beta**, and betas carry breaking
changes by definition. An install that does not honour the lockfile (a fresh CI
runner, a Docker build with a changed cache key, someone running `npm update`,
a dependency refresh) could land a different authentication implementation with
no diff to review and no signal that anything changed.

For most dependencies that risk is an inconvenience. For the one that decides who
is signed in and with what role, a silent swap is a security event. The pin costs
nothing and removes it.

## Retirement invariant

Do not re-add NextAuth merely to preserve an old architecture diagram. A future
identity-provider migration needs a new decision, a stable supported dependency,
explicit role mapping and the complete staff/ticket authorization matrix. The
current authority remains `src/lib/principal.ts`; `src/auth.ts` is only a narrow
legacy-call-site adapter and does not import NextAuth.
