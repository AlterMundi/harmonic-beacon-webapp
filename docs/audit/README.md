# Pre-Public-Release Audit of the Product & Policy Documentation

*Audit date: 2026-06-09 · Auditor: automated full-corpus review (Claude Code) · Status: findings recorded, remediation pending*

## What this is

A complete, claim-by-claim audit of the **product and policy documentation set** — the structure of the wellness-adjacent app — performed in preparation for public release. Every factual assertion in these docs was checked against the actual codebase, git history, and deploy configuration; every legally significant statement was reviewed for accuracy, internal consistency, and exposure.

**Verdict: the doc set is NOT ready to be published as-is.** It is well-written and internally principled, but it systematically describes an aspirational product in the present tense: a substantial number of the controls, endpoints, and guarantees it asserts do not exist in code, several statements are legally inaccurate, and the policy docs contradict each other on material terms (provider license, revenue share, content states). Each finding is itemized, cited to file and line, and assigned a severity.

## Corpus audited

The policy/product spine, as defined by `docs/README.md`:

```
docs/VISION.md                  docs/CONTENT_POLICY.md
docs/PRODUCT_PRINCIPLES.md      docs/TRUST_AND_SAFETY.md
BUSINESS_RULES.md (root)        docs/SLO.md
docs/MONETIZATION.md            docs/ROADMAP.md
docs/RESEARCH_PROTOCOL.md       docs/phases/PHASE_1..PHASE_4 (all four)
docs/README.md
```

The root `README.md` §"Operational commitments" and §"License & ownership" are included because they republish claims from this corpus. The developer/infra readmes (`deploy/`, `go2rtc/`, `TESTING.md`, `public/*`) were also read; their minor findings are confined to an appendix of TECH_AUDIT.md.

Verification sources: `prisma/schema.prisma`, all `src/app/api/` routes, `src/lib/auth-config.ts`, `src/context/AudioContext.tsx`, `services/playlist-bot/`, `docker-compose.yml`, `.github/workflows/deploy.yml`, full git history (branch list, secret scan, env-file scan). Repo state: commit `b72b279`.

## Documents in this audit

| File | Audience | Contents |
|---|---|---|
| [LEGAL_AUDIT.md](./LEGAL_AUDIT.md) | Legal team / counsel | 18 findings: licensing, health-claims exposure, GDPR, consent, IP, monetization representations, contradictions between policy docs |
| [TECH_AUDIT.md](./TECH_AUDIT.md) | Tech team | 20 findings: claims the docs make about the system that the code does not support, each with file:line evidence and a recommended fix path (build it vs. re-tense the doc) |

## Severity scale

- **BLOCKER** — must be resolved before the docs or the repo become public.
- **HIGH** — significant legal or credibility exposure; resolve before launch or explicitly accept in writing.
- **MEDIUM** — inconsistency or inaccuracy that will mislead a reader; fix before release.
- **LOW** — editorial or hygiene item.

## Headline findings

1. **No license decision has been made** (BLOCKER). No `LICENSE` file, no `license` field in `package.json`, and `README.md:95` says "All rights reserved" while preparing a public release. → [LEGAL_AUDIT.md §L1](./LEGAL_AUDIT.md)
2. **The policy docs guarantee data rights the system cannot deliver** (BLOCKER). `BUSINESS_RULES.md` §1.1 and §9.1 promise one-click export and deletion via named endpoints; neither endpoint exists. → [LEGAL_AUDIT.md §L2](./LEGAL_AUDIT.md), [TECH_AUDIT.md §T1](./TECH_AUDIT.md)
3. **Documented safety/compliance controls do not exist** (BLOCKER while stated in the present tense): audit log, session kill switch, report buttons, CAPTCHA, email verification, age gate, Postgres encryption at rest, PII log filtering, and every public policy page (`/privacy`, `/terms`, `/research`, `/trust`, `/incidents`). The code in fact logs user email addresses to console, directly contradicting two docs. → [TECH_AUDIT.md §T2–T6](./TECH_AUDIT.md)
4. **Two legally wrong statements on GDPR and consent** (HIGH): the 72-hour breach window misattributed to user notification, and session recording justified by "participation implies consent." → [LEGAL_AUDIT.md §L3, §L4](./LEGAL_AUDIT.md)
5. **The wellness-claims discipline leaks** (HIGH): the corpus bans therapeutic claims, yet `PRODUCT_PRINCIPLES.md` asserts which "populations most benefit from the beacon," and `RESEARCH_PROTOCOL.md` records that the live marketing site already claims, in the present tense, research activity that does not exist. → [LEGAL_AUDIT.md §L5, §L12](./LEGAL_AUDIT.md)
6. **Material contradictions between policy docs** (HIGH): recording license (perpetual vs. revoked-on-removal), provider revenue share (two different 50% models), the "Hidden" content-state flags. → [LEGAL_AUDIT.md §L8, §L9](./LEGAL_AUDIT.md), [TECH_AUDIT.md §T8](./TECH_AUDIT.md)
7. **Good news**: no secrets or real env files anywhere in git history (all commits scanned); the Prisma schema, role enums, content-state flags, LiveKit/go2rtc topology, and the repo-layout claims in the docs are accurate; the docs' own "Draft · pending validation" discipline is consistently applied and is the cheapest global mitigation available.

## Recommended release path

1. Legal works through LEGAL_AUDIT.md top-down; every BLOCKER/HIGH gets a written decision in the PR that closes it.
2. Tech works through TECH_AUDIT.md; for each docs-vs-code gap, either build the control or re-tense the claim ("will", "Phase N") — each finding states which fix is realistic.
3. Global mitigation, cheap and honest: promote the existing "Draft · pending validation" marker into an unmissable status banner in each doc and in the root README, and convert all present-tense claims about unbuilt systems into explicitly-marked roadmap commitments. The corpus already contains the right vocabulary for this (`VISION.md` promise 7: *"We are honest about what we don't yet know"*) — the fix is to apply it to the docs themselves.
4. Re-run this audit's claim list before flipping repo visibility.
