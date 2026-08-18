# Team smoke readiness — 2026-08-05 (post-release)

Issue: https://github.com/AlterMundi/harmonic-beacon-webapp/issues/24

Status: **RELEASE READY — ACCESS SETUP AND HUMAN EXECUTION PENDING**

This is a small functional rehearsal for the team. It does not replace the
deferred 150-person capacity rehearsal or the full paid-event dress rehearsal.

## Release checkpoint

| Field | Value |
|---|---|
| Deployed candidate | `3473397f0d7acd316b42230e197d932aa36d31e3` |
| Release run | [31058398689](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/31058398689) — PASS |
| Database schema | `20260805230000_move_english_session_to_august_9` |
| Public health/readiness | PASS |
| App restart/OOM after deploy | `0` / `false` |
| Test dashboard | disabled (`/api/test-login` returns `404`) |
| Rollback | immutable image preserved by the successful deploy workflow |

The release matrix passed the fixture restore, clean migration chain, Chromium,
Android, Firefox, iPhone/WebKit media, commerce contract and public/private
boundary gates before deployment.

## Isolated rehearsal session

| Field | Value |
|---|---|
| Session UUID | `30000000-0000-4000-8000-202608050001` |
| Room | `pmp-internal-testing-20260805` |
| State | `LIVE`, `isTest=true` |
| Assigned facilitator role | `FACILITATOR_OP` |
| Capacity / publisher cap | 150 / 6 |
| Active attendee entitlements at checkpoint | 0 |
| Present participants at checkpoint | 0 |

The session is hidden from public discovery. Do not enable the production test
dashboard. An authenticated `FACILITATOR_OP` or `ADMIN` must issue three
synthetic `COMP` tickets through Admission, with a non-PII reason such as
`team rehearsal 2026-08-05`. Keep the one-time codes outside this repository and
revoke them after the rehearsal through the same audited interface.

## People and devices

- facilitator/operator: assigned `FACILITATOR_OP`, desktop Chrome;
- independent operator: `OPERATOR` or `ADMIN`, desktop Firefox on another network;
- attendee A: desktop Chrome;
- attendee B: physical iPhone Safari;
- attendee C: physical Android Chrome;
- one person records results without operating the facilitator browser.

## Twenty-minute sequence

Use [WEEKEND_REHEARSAL.md](../WEEKEND_REHEARSAL.md) as the authoritative script,
but keep this smoke to:

1. enter all three attendees and confirm displayed name/role/session;
2. activate Stage + Beacon once and listen continuously for 60 seconds;
3. raise hand, invite, accept, decline, demote and verify public/staff truth;
4. switch front/rear camera on both physical phones without losing microphone or Beacon;
5. disconnect/rejoin one attendee and confirm no stale on-stage tile;
6. let the independent operator observe without a duplicate media mount;
7. end the session for everyone and verify token denial and state convergence.

Abort on duplicate audio/media, consent violation, wrong session, health
degradation, a seventh publisher or inability to end the experience.

## Deferred evidence

The corrected six-host capacity run reached exact Stage/Beacon connection,
publisher and cleanup counts, with zero reported Beacon audio loss, but failed
the VP8 quality gate. Further large-load work is intentionally deferred to #99
and must use a disposable LiveKit target outside `mona`. This does not block a
small human functional smoke; it does block claiming 150-person capacity.

## Human result

| Journey | Chrome desktop | Firefox/operator | iPhone Safari | Android Chrome |
|---|---|---|---|---|
| Entry and identity | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Stage + Beacon listening | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Hand/invite/accept/decline/demote | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Front/rear camera continuity | N/A | N/A | NOT RUN | NOT RUN |
| Disconnect/rejoin and stale-state removal | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| End session for everyone | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

Go/no-go owner: PENDING  
Execution timestamp: PENDING  
Decision: PENDING HUMAN EXECUTION
