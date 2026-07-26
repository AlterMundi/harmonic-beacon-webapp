# Staying on a pre-release NextAuth, and pinning it exactly

*Decided 2026-07-26.*

## Decision

Authentication stays on `next-auth@5.0.0-beta.30`, and the dependency is **pinned
to that exact version** — no caret, no range.

## Why this needed a decision at all

[PRODUCT_PRINCIPLES.md](../PRODUCT_PRINCIPLES.md) §9 prefers stable dependencies
over bleeding-edge ones, and the whole authentication layer — the trust surface
that section is most about — runs on a beta. That is a divergence between a
stated principle and the lockfile, and an undocumented divergence is the thing
the principle is supposed to prevent.

## Why we stay

There is nowhere to go. Verified 2026-07-26: npm's `latest` tag for `next-auth`
is **4.24.15**, so v5 has never shipped stable. The options were a pre-release, or
a migration back to v4 — which is its own migration, against an older API, to
arrive somewhere we would have to leave again.

So the divergence is accepted. What was not acceptable was leaving it silent.

## Why the exact pin matters more than the version choice

The range was `^5.0.0-beta.30`. Under semver that caret resolves to
`>=5.0.0-beta.30 <6.0.0` — it accepts **any later beta**, and betas carry breaking
changes by definition. An install that does not honour the lockfile (a fresh CI
runner, a Docker build with a changed cache key, someone running `npm update`,
a dependency refresh) could land a different authentication implementation with
no diff to review and no signal that anything changed.

For most dependencies that risk is an inconvenience. For the one that decides who
is signed in and with what role, a silent swap is a security event. The pin costs
nothing and removes it.

## Trigger for revisiting

When `next-auth@5` reaches stable, move to it deliberately: read the changelog
from beta.30 forward, run the auth tests, and check the Zitadel provider and the
`jwt`/`session` callbacks in [`src/lib/auth-config.ts`](../../src/lib/auth-config.ts)
specifically, since those are where the v5 API churned most. Until then, upgrading
between betas is a deliberate act with a diff to review, not something an install
does on its own.

## What this does not fix

Pinning protects against an unintended upgrade. It does nothing about the beta's
own defects, and there is no support commitment behind a pre-release. If a
security issue surfaces in beta.30, the response is to move forward to whatever
beta fixes it — deliberately, which is the point.
