# Listener Founder price continuity projection

> **Product amendment — 2026-08-10:** the positive-only lifetime eligibility
> implementation described below is superseded and must not be enabled for
> production commerce. "Lifetime" now means only the uninterrupted lifetime of
> an active Founder subscription. Once paid-through/grace continuity ends,
> Founder status and USD 5 eligibility end; later signup uses the current public
> offer. This document retains the deployed design history so migration and
> rollback can be reviewed, but the authority and Listener projections require
> a coordinated forward-only correction before provider activation.

## Boundary

PMP Myth Bot is the only authority that can project Founding Listener price continuity. Its private
membership read v2 is versioned in `contracts/early-bird-authority/v2` and was introduced by backend
merge `3febc1d525adf150bfdd75fd2b98b04771cb79b7`.

The historical implementation stores a positive-only projection of that evidence in
`early_bird_founder_eligibility_projections`. This row is deliberately separate from the v1
membership projection:

- it has no membership revision and never participates in stream authorization;
- its hash covers only the canonical eligibility object;
- RFC 3339 timestamps are normalized to UTC millisecond precision before hashing and storage;
- the first positive value is immutable;
- `null` never deletes or downgrades an existing positive value;
- Free, welcome access, invitations and Free For All never create the row.

The existing membership push route, public page, access resolver, leases and presentation remain
unchanged. Founder eligibility alone cannot grant listening access or produce a Purchase event.

## Reconciliation

An authenticated server-side caller may request:

```text
POST /api/internal/v1/early-bird-founder-eligibilities/{account_id}/reconcile
Authorization: Bearer <Listener membership service token>
X-HB-Service-Key-Id: <current key id>
```

The route authenticates and verifies the local opaque account before contacting the authority. It
then performs a bounded, no-store GET of the private v2 membership document and applies only
`founder_price_eligibility` transactionally.

Successful outcomes are:

- `ABSENT`: the authority returned `null` and no local positive evidence exists;
- `APPLIED`: the first canonical positive evidence was stored;
- `REPLAYED`: the exact evidence already exists.

Conflicting positive evidence, positive-to-null transitions and an authority 404 for an existing
local account return 409 and preserve local state. Authority timeout, authentication failure, 5xx,
oversized or malformed bodies and account mismatches return a generic 503 without mutation.
Unknown local accounts return 404 before outbound I/O. Unexpected database failures return a
generic 500 and roll back the transaction.

The endpoint is not invoked by page rendering, OAuth, stream lease creation or the v1 push route.
Automation can be added later as an operations worker without changing the evidence semantics.
`observed_at` records the first successful local observation and is intentionally unchanged on replay.

## Migration and rollback

The migration is forward-only and additive. Deploying code before the migration is prohibited;
deploy applies the migration before selecting an image. Rolling the application image back is safe
because older code ignores the new table. The table is retained during rollback so positive
eligibility evidence is never destroyed.

This subsystem belongs only to the isolated Listener product. It does not modify weekend events,
LiveKit, event tickets, tapestry, event audio or Proyección del Mito.
