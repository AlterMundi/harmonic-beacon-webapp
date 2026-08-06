# HUMAN-QA-02 — Post-August-2 human acceptance sheet — 2026-08-06

Issue: https://github.com/AlterMundi/harmonic-beacon-webapp/issues/204

**Status: PREPARED — NOT EXECUTED**
**Decision: PENDING DEPLOYED SHA + HUMAN EXECUTION**

This sheet is **additive**. The canonical protocol is
[`../WEEKEND_REHEARSAL.md`](../WEEKEND_REHEARSAL.md) — entry gate, role
discipline, synthetic-identity rules, device matrix minimums and the rehearsal
sequence all apply unchanged. This document only adds what landed after the
August 2 free event: public questions-and-emotions contributions
(NAMED/ANONYMOUS), the cockpit contributions drawer, the second-session A→B
leakage check, and the bilingual SessionGuidance surface. Nothing here
rewrites the protocol.

No result in this sheet may be filled by delegation, by CI, or by reading the
code. Every row requires a human executing against the deployed candidate and
recording what they observed.

## 1. Candidate identity

| Field | Value |
|---|---|
| `origin/main` SHA at preparation | `341c15c` |
| Deployed SHA (`/api/health` `gitSha`) | `3473397f0d7acd316b42230e197d932aa36d31e3` |
| Database schema (deployed) | `20260805230000_move_english_session_to_august_9` |
| Gap between main and deployed | `main@341c15c` is **19 commits ahead** of deployed `3473397` (`git rev-list --left-right --count` → `0 19`) |
| Rollback SHA | PENDING — record from the deploy workflow before execution |
| URL / environment | `https://live.harmonicbeacon.com` (production event stack) |
| Test session UUID | PENDING — derive from the canonical catalog/cockpit at execution time; never copy from historical docs |
| Execution date/time (UTC) | PENDING |

Verified facts at preparation time (2026-08-06) — `/api/health` and
`/api/health/ready` plus `git merge-base --is-ancestor <sha> 3473397f…`,
where **exit code 0 means "contained" and exit code 1 means "not
contained"**:

- `89f77991` (PR #161, contributions contract/backend) → **exit 0**:
  production contains the contributions backend.
- `388fe8f` (PR #187, attendee/staff UI) → **exit 1**: not deployed.
- `671cde8` (final contribution hardening) → **exit 1**: not deployed.
- `d547e96` (PR #192, E2E fixes) → **exit 1**: not deployed.
- `341c15c` (PR #206, SessionGuidance) → **exit 1**: not deployed.
- `git rev-list --left-right --count 3473397f… origin/main` → `0 19`:
  main is 19 commits ahead of the deployed SHA.

**Fail-closed rule:** production contains the contributions
contract/backend of PR #161, but not yet the attendee/staff UI of
PR #187, its final hardening, the PR #192 fixes, or SessionGuidance of
PR #206. If `/api/health` at execution time does not show a candidate
containing PRs #187, #192 **and #206**, mark every row **BLOCKED** and
attribute no result to the new design. Execution is equally blocked
until real humans fill every role in §2 — a prepared sheet is not an
executed rehearsal.

## 2. Roles (synthetic codes only)

Never record names, emails, tickets or tokens in this sheet. Use only these
codes:

| Role code | Responsibility | Account/capability |
|---|---|---|
| GO-NOGO-OWNER | Go/no-go signature and abort authority | — |
| FACILITATOR-01 | Facilitates the session | Assigned `FACILITATOR_OP` |
| OP-01 | Independent operator | `OPERATOR` or `ADMIN` |
| ATT-CHROME | Attendee, desktop Chrome | Synthetic `COMP` ticket |
| ATT-FIREFOX | Attendee, desktop Firefox, different network | Synthetic `COMP` ticket |
| ATT-IPHONE | Attendee, physical iPhone Safari | Synthetic `COMP` ticket |
| ATT-ANDROID | Attendee, physical Android Chrome | Synthetic `COMP` ticket |
| RECORDER-01 | Reads the script, records evidence, never coaches | No production credentials |

## 3. Device and network matrix

| Tester code | Role | Device | OS/version | Browser/version | Network | Headphones/speaker | Result | Evidence |
|---|---|---|---|---|---|---|---|---|
| ATT-CHROME | Attendee | PENDING | PENDING | Chrome PENDING | AR network | PENDING | NOT RUN | PENDING |
| ATT-FIREFOX | Attendee | PENDING | PENDING | Firefox PENDING | Different network | PENDING | NOT RUN | PENDING |
| ATT-IPHONE | Attendee | Physical iPhone PENDING | iOS PENDING | Safari PENDING | PENDING | PENDING | NOT RUN | PENDING |
| ATT-ANDROID | Attendee | Physical Android PENDING | Android PENDING | Chrome PENDING | PENDING | PENDING | NOT RUN | PENDING |
| ATT-TURN | Any attendee role | PENDING | PENDING | PENDING | Restrictive path (ICE/TCP or TURN) | PENDING | NOT RUN | PENDING |
| ATT-BGFG | Mobile attendee | PENDING | PENDING | PENDING | Background/foreground cycle | PENDING | NOT RUN | PENDING |
| ATT-BT | Mobile attendee where possible | PENDING | PENDING | PENDING | Bluetooth or output switching | Bluetooth PENDING | NOT RUN | PENDING |

## 4. Test journey

The canonical sequence from `WEEKEND_REHEARSAL.md` §1–§5 applies in full. The
rows below make the post-August-2 additions explicit and give every row a
traceable ID. All rows start **NOT RUN** with no observed result.

| ID | Precondition | Action | Expected result | Observed | Result | Severity | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|
| QA-01 | Doors open; tester has no briefing | ATT-CHROME explains their role, the session, and the next action without coaching | Correct, unaided comprehension | | NOT RUN | P2 | | |
| QA-02 | In room | Tester states who they are and which session they are in | Identity/role/session named correctly | | NOT RUN | P0 | | |
| QA-03 | In room | Deny microphone, allow camera (and vice versa) | Partial permissions handled with clear state, no dead end | | NOT RUN | P1 | | |
| QA-04 | Audio active | Distinguish Stage, audience, tapestry and Beacon | All four identified correctly | | NOT RUN | P2 | | |
| QA-05 | Audio active | Listen 60 s at balance 0.25 | Beacon/voice presence as designed; record glitches/routing | | NOT RUN | P1 | | |
| QA-06 | Audio active | Listen 60 s at balance 0.50 | As QA-05 | | NOT RUN | P1 | | |
| QA-07 | Audio active | Listen 60 s at balance 0.75 | As QA-05 | | NOT RUN | P1 | | |
| QA-08 | Audio active, balance fully to Beacon | Move balance fully toward Beacon | Session voice at zero; only the Beacon is heard | | NOT RUN | P1 | | |
| QA-09 | Session voice present | Human judges voice intelligibility | Voice intelligible (continuity alone is not intelligibility) | | NOT RUN | P1 | | |
| QA-10 | Camera on, mic on | Turn camera off | Microphone and active audio continue; each control works independently | | NOT RUN | P0 | | |
| QA-11 | Mobile, on Stage | Switch front/rear camera and back | No room exit, no mic/Beacon interruption | | NOT RUN | P1 | | |
| QA-12 | In audience | Raise hand | Facilitator and operator both see it with name/thumbnail | | NOT RUN | P1 | | |
| QA-13 | Hand raised | Staff view shows attendee name and thumbnail | Real name/thumbnail, not a generic role | | NOT RUN | P1 | | |
| QA-14 | Hand raised | FACILITATOR-01 invites; attendee accepts | Publishes only after explicit accept; audience until then | | NOT RUN | P0 | | |
| QA-15 | Hand raised | Invite; attendee declines | Never appears on Stage | | NOT RUN | P0 | | |
| QA-16 | On Stage | Demote attendee | Stage, tapestry, hand queue and grants converge | | NOT RUN | P1 | | |
| QA-17 | Was on Stage; network cut 15 s | Restore network and reconnect | No stale `ON_STAGE`; no automatic reappearance | | NOT RUN | P1 | | |
| QA-18 | Tapestry visible | Observe tapestry and audience presence | Composition names participants; presence truthful | | NOT RUN | P2 | | |
| QA-19 | In room, clean feed | ATT-CHROME posts a NAMED contribution | Appears immediately with the display name | | NOT RUN | P1 | | |
| QA-20 | In room | ATT-FIREFOX posts an ANONYMOUS contribution | Audience sees "Anónimo"/"Anonymous", never the author | | NOT RUN | P0 | | |
| QA-21 | QA-20 done | Every attendee device inspects the anonymous message | No author identity anywhere in the audience surface | | NOT RUN | P0 | | |
| QA-22 | QA-20 done | FACILITATOR-01/OP-01 opens the staff feed | Real author visible to staff with anonymity badge | | NOT RUN | P0 | | |
| QA-23 | Composer open | Press Enter inside the composer | New line only; nothing publishes implicitly | | NOT RUN | P1 | | |
| QA-24 | Draft written; network cut | Attempt send while offline | Draft preserved; recovery offered; no duplicate on retry | | NOT RUN | P1 | | |
| QA-25 | Backlog open | New messages arrive while reading backlog | "New messages ↓" indicator; no forced scroll | | NOT RUN | P2 | | |
| QA-26 | Audio active with media probe (where available) | Open/close the contributions panel and drawer | No remount; no new sockets, tracks, media elements or AudioContext | | NOT RUN | P0 | | |
| QA-27 | Audio active with media probe | Open/close SessionGuidance | No remount; media pipeline untouched | | NOT RUN | P0 | | |
| QA-28 | Guidance closed | ATT-CHROME reads SessionGuidance in ES | Explains volume, balance, full-Beacon listening and camera/mic independence unaided | | NOT RUN | P2 | | |
| QA-29 | Guidance closed | A second attendee reads it in EN | Same comprehension in English | | NOT RUN | P2 | | |
| QA-30 | Guidance visible pre-room | Tester waiting behind closed doors finds and reads the guidance | Available and understandable before entry | | NOT RUN | P2 | | |
| QA-31 | Session A done | Move the same principal to session B | No leakage of messages, cursors, drafts, hand, grant, language, audio or stage state | | NOT RUN | P0 | | |
| QA-32 | Session live | FACILITATOR-01 ends the session from the cockpit | All attendees exit; no new tokens issued | | NOT RUN | P0 | | |
| QA-33 | QA-32 done | Staff and attendees observe final state | Converged final state; closure communicated as completion, not transport error | | NOT RUN | P1 | | |
| QA-34 | QA-32 done | A former attendee re-opens the session URL | Entry denied; no token issued; truthful ended state | | NOT RUN | P1 | | |

## 5. Human ES/EN language review

Run Parts A and B of
[`../../verification/HUMAN_ROLE_LANGUAGE_REVIEW.md`](../../verification/HUMAN_ROLE_LANGUAGE_REVIEW.md)
against the same deployed SHA. The review must answer, unaided, in both
locales:

- Who are you in this room?
- What can you do here?
- What can you not do?
- Who controls your camera and microphone?
- What does raising your hand imply?
- How does anonymity work when you share?
- What does the overall volume do?
- What does the Beacon/Session balance do?
- What does "look for a question, not an answer" mean to you?

Do not fill answers on behalf of testers. Record per-locale outcomes in the
review's own evidence sheet and link it here: **PENDING**.

## 6. Qualitative interview

Record without steering answers:

| Field | Recording |
|---|---|
| Moment of greatest confusion | PENDING |
| Action that felt scary | PENDING |
| Expectation when turning the camera off | PENDING |
| Perceived meaning of "Beacon" | PENDING |
| Feature discovered too late | PENDING |
| Confidence in anonymity | PENDING |
| Visual hierarchy reading | PENDING |
| Room versus dashboard perception | PENDING |
| Copy problem found | PENDING |
| Touch/layout problem found | PENDING |

## 7. Severity and abort

- **P0:** wrong identity or session; consent/privacy breach; anonymous author
  exposed; duplicated audio/media; seventh publisher; inability to end the
  session.
- **P1:** main path unusable; unintelligible voice; wrong reconnect/Stage
  state; audio loss; inconsistent contribution behavior.
- **P2:** ambiguous copy; problematic layout/touch; hard-to-find feature.
- **P3:** visual refinement with no operational impact.

**Abort conditions:** any P0; health degradation on the target; unexpected
production impact; inability to close the session. On abort, stop, record the
state, and notify the go/no-go owner. Open a minimal issue per real defect;
never silently edit evidence.

## 8. Scope separation

- This battery does **not** certify 150 participants and does not close #99.
- It does **not** test payments and does not close #25/#26/#81 (existing
  commercial evidence from Mariano/Sai is linked, not re-executed).
- It does **not** test moderation/withdrawal: #134 remains pending; register
  its absence as a pending feature, not a failure.
- It does **not** test a facilitation mix override: #98 does not exist and no
  interface copy claims it does.
- It does **not** require a mic checker: #126 remains pending.
- It does **not** require staff audio return: #131 remains pending.
- EarlyBirds (PR #203 line) is a separate staging lane: not part of this
  battery, not a blocker, not touched.
- This battery authorizes no sales and no deploy.

## 9. Closure

| Field | Value |
|---|---|
| PASS / FAIL / BLOCKED / NOT RUN summary | PENDING |
| Issues created | PENDING |
| Open P0/P1 | PENDING |
| Decision | PENDING — GO / CONDITIONAL GO / NO-GO |
| Go/no-go owner signature | PENDING |
| Linked from #24, #64, #66, #68, #69, #94 | PENDING |

Silence or incomplete rows are **not** approval. A row without human evidence
stays NOT RUN; a candidate mismatch makes every row BLOCKED. The go/no-go
decision requires the deployed SHA to contain PRs #187, #192 and #206, every
P0/P1 closed or explicitly waived by the go/no-go owner, and this sheet linked
from #24, #64, #66, #68, #69 and #94.
