# Authenticated Live visits for operator cohort selection

Request `pmp-cohort-launch-20260923`; authorized by Mariano through the paired
Account/PMP coordination. Base: release a5e83033. Scope: Live app only, not
Account, enrolment, payments, credits, media or participant profile changes.

## Plan

1. Record authenticated, visible-page observations on `/` and `/session/...`,
   including waiting rooms and existing cookies, using a same-origin POST.
   A mounted browser observer sends once and every60s while visible. The server
   resolves the existing Account session; client identity/time are never accepted.
2. Use existing AuditLog rows, isolated action and deterministic minute bucket
   IDs. No migration. Store only issuer/subject and surface, with server time;
   no token, email, private real name, narrative or enrolment permission.
3. The campaign cutoff is 2026-09-23T21:00:00Z (18ART), not19ART. Earlier
   observations are not recorded. This is app activity, not attendance duration
   or proven LiveKit connection. A previously open visible page is included by
   its next heartbeat; hidden pages are not evidence of active arrival.
4. Export a private v2 snapshot of observed subjects, deduplicated and enriched
   from Account by issuer+subject only. Keep first/last recorded observation,
   surfaces, snapshot time, cutoff, source release and verified coverage start.
   Until deployment is verified, coverage is null/status not_deployed. Never
   substitute historical Account registrations. Mariano selects explicitly.
5. Test origin/auth rejection, server identity/time, cutoff, replay/dedup,
   visible-page lifecycle, waiting-room navigation and failure isolation.
6. Qualify exact release candidate via CI/PR and service-owned delivery. Replace
   app only if impact permits, retain previous image/config, refuse live-event
   interruption. Verify health/provenance and endpoint boundary after deploy.

Recording failures do not block the participant UI. An export read failure
must not replace prior snapshot or fabricate a fresh empty list. Browser JS and
network delivery are required; this is best-effort observed activity, not an
exhaustive census. No observer is injected into already loaded old assets;
the target is deployment before cutoff, and such tabs should reload before the
group. If verified deployment occurs after cutoff, coverage is explicitly partial.

## Private exchange contract

`beacon-live-observed-accounts.v2`:
`generated_at`, `cutoff`, `coverage_started_at` (null until deployment verified),
`source {service,origin,status,release_sha}`, `selection_required: true`,
`accounts [{issuer,subject,name,preferred_name,email,email_verified,
profile_complete,first_seen_at,last_seen_at,surfaces,review_flags}]`.

Path agreed with PMP: `.runtime/beacon-auth/operator-import/beacon-live-observed.json`,
root0600 beneath0700 parents, excluded from Git/backup. Receipt contains no PII.
Consumer and human selection belong to PMP. No automatic enrolment.

Operator refresh: `python3 scripts/export-live-cohort.py --coverage-receipt PATH`.
The private root0600 receipt records `release_sha` and `coverage_started_at` only
after successful deployment verification. The tool checks current runtime SHA,
reads Live observations and only the corresponding Account subjects using each
service's existing read-only transaction. It atomically writes the agreed file;
stdout contains counts and a digest, never identities. No scheduler is installed.
