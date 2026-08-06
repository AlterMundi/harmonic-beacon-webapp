# Team rehearsal readiness — 2026-08-05

Issue: https://github.com/AlterMundi/harmonic-beacon-webapp/issues/24

Status: **PREPARED — NOT EXECUTED / NO-GO for updated-candidate rehearsal**

This sheet records readiness without claiming that human checks occurred. Use
`docs/ops/WEEKEND_REHEARSAL.md` when the entry gate becomes green.

## Candidate

| Field | Value |
|---|---|
| Intended candidate | `916f456ed76ab34dff8813c983023f5db5f20e6a` |
| Public production at preparation time | `c240810d840c747b6828236c40116a461455753b` |
| Release run | [31056937508](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/31056937508) — FAIL before deploy |
| Rollback | Current deployed SHA above; no deployment attempted |
| Contributions UI | PR #187, not part of candidate; changes requested |

The release gate failed while restoring the clean fixture database after the
English-session date migration. Production remained on the prior healthy SHA.
Testing production now is valid only as a regression check of that older SHA;
it is not evidence for the updated candidate.

## Entry-gate status

| Gate | Result | Evidence/owner |
|---|---|---|
| Public health ready | PASS for current production | `/api/health` reported `status=ok` on the deployed SHA |
| Candidate equals deployed SHA | FAIL | Candidate is eight commits ahead of production |
| Candidate release matrix | FAIL | Fixture restore rejected an absent historical source row; Sai owns the schedule migration |
| Corrected distributed VP8 diagnostic | RUNNING | #99 / Actions 31057895944 |
| Dedicated `isTest=true` session selected | NOT RUN | Select only after the candidate deploys |
| Staff assignment and role matrix | NOT RUN | Must be checked against the selected UUID |
| Physical device/network roster | NOT RUN | Team coordination required |
| Commercial synthetic evidence | EXTERNAL | Mariano/Sai; not executed by Nico/Codex |

## Human result matrix

| Journey | Desktop Chrome | Firefox/other network | iPhone Safari | Android Chrome | Overall/issue |
|---|---|---|---|---|---|
| Waiting room and admission | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| One-gesture Stage + Beacon | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Hand → invite → accept/decline → demote | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Front/rear camera with media continuity | N/A | N/A | NOT RUN | NOT RUN | |
| Disconnect/rejoin and stale Stage removal | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Operator preview without duplicate media | NOT RUN | NOT RUN | N/A | N/A | |
| End session for everyone | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| Second-session isolation | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |

## Go/no-go

Decision: **NO-GO for the updated-candidate human rehearsal** until the release
fixture invariant is corrected, the full release gate passes and public health
reports that exact candidate. This decision does not classify the older
production build as unhealthy.

Go/no-go owner: PENDING  
Timestamp: PENDING  
Follow-up issues: #41 (release/schedule invariant), #99 (capacity evidence),
#24 (human rehearsal umbrella).
