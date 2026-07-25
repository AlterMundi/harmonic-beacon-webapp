# Agent Policy — Harmonic Beacon

How Claude assigns **model**, **reasoning effort**, **tool scope** and **autonomy** to
delegated teammates, based on the *responsibility* the task carries.

The governing question is never "is this task hard?" but **"what happens if the agent
gets this wrong and nobody notices?"** Blast radius drives the tier; difficulty only
adjusts effort within a tier.

---

## 1. Responsibility tiers

| Tier | Name | Blast radius if wrong | Model | Effort | Autonomy |
|------|------|----------------------|-------|--------|----------|
| **R0** | Irreversible / production | Data loss, prod outage, leaked secret, spend | `opus` | `max` | **Never autonomous.** Proposes; a human executes. |
| **R1** | Design & architecture | Wrong decision propagates into weeks of code | `opus` | `high` | Autonomous to *produce a proposal*. Never to apply it. |
| **R2** | Implementation on a closed spec | Bad code, caught by review/CI | `sonnet` | `medium` | Autonomous within the repo. No deploys, no migrations. |
| **R3** | Research & read-only analysis | A wrong fact in a report | `sonnet` | `medium` | Fully autonomous. Read-only tools. |
| **R4** | Mechanical | Trivially revertible | `haiku` | `low` | Fully autonomous. |

### Tier assignment — concrete for this repo

**R0** — `prisma migrate deploy` against a real database · anything writing
`/etc/sai-harmonic-beacon/production.env` or a cloud secret store · `docker compose
down/up` on a live host · DNS, TLS or firewall changes · deleting or overwriting
anything under `/mnt/n8n-data/harmonic-beacon/` · any object-storage lifecycle rule ·
granting or changing a Zitadel role mapping · anything that starts costing money.

**R1** — the storage-driver interface · schema changes in `prisma/schema.prisma` ·
auth/session flow changes (`src/lib/auth-config.ts`, `middleware.ts`) · choosing
between LiveKit Cloud and self-hosted · deciding whether go2rtc survives the migration ·
anything in `docs/` that states a policy or a commitment.

**R2** — writing an API route against an agreed contract · adding tests ·
implementing a storage driver once the interface is fixed · wiring a health endpoint ·
refactoring call sites of an already-designed function.

**R3** — provider/pricing research · codebase exploration · "where is X used" ·
dependency audits · reading logs to characterise a failure.

**R4** — renames · formatting · import reordering · changelog entries ·
mechanical find-and-replace with a verified pattern.

---

## 2. Modifiers

Applied *after* the base tier. Each is `+1 effort step`
(`low → medium → high → xhigh → max`) unless stated otherwise.

| Modifier | Trigger | Adjustment |
|----------|---------|------------|
| **Volatile facts** | Task depends on things that change under the knowledge cutoff: pricing, free tiers, API versions, provider quotas | +1 effort · **must** cite source URL + verification date · unverifiable claims marked `UNVERIFIED` |
| **Security surface** | Touches auth, tokens, signed URLs, role checks, rate limits, CORS | +1 effort · bump to at least R1 · mandatory adversarial review (§3) |
| **Silent failure** | Wrongness would not be caught by tests, types, or CI | +1 effort · require the agent to state its own verification method |
| **Concurrent writes** | Two or more agents edit files at the same time | `isolation: "worktree"` |
| **Wide fan-out** | Answer requires sweeping many files, only the conclusion is needed | Prefer `Explore` over `general-purpose`; keep at R3 |
| **Cheap and bounded** | Task is fully specified, output is short, verification is instant | −1 effort |

**Never downgrade below the tier's model.** Effort flexes; the model does not. An R0
task at `low` effort is still `opus` — a cheap model on an irreversible action is the
failure mode this policy exists to prevent.

---

## 3. Verification rules

- **R0 and R1 outputs get a second pass.** Spawn an independent reviewer with a
  *different lens* than the producer (correctness / security / "what did this miss"),
  not a second copy of the same prompt. Redundancy catches noise; diversity catches
  blind spots.
- **R3 findings that will drive an R0/R1 decision must be re-verified** before acting.
  Research is cheap and confident; that combination is dangerous. Treat a single
  agent's factual claim as a lead, not a fact.
- **Agents report failure explicitly.** A teammate that could not verify something says
  so. Silence is not success. Prompts must say this in as many words.
- **Never let an agent's conclusion reach the user unreviewed** when it recommends
  spending money, changing production, or discarding a component.

## 4. Prompt contract

Every spawned teammate gets, at minimum:

1. **Today's date** and an explicit instruction that its knowledge may be stale.
2. **The workload context** — enough that it does not have to guess constraints.
3. **A hard scope boundary** — what it owns and, critically, what *other agents* own,
   so parallel teammates do not duplicate each other.
4. **The output shape** — the final message *is* the deliverable; no preamble, no
   "here's what I found" framing.
5. **A falsification instruction** for research tasks — what would make its own
   conclusion wrong, and whether it checked.

## 5. Parallelism

- Independent teammates go out in **one message, multiple tool calls**. Sequential
  spawning of independent work is a bug.
- Fan out by **scope**, not by volume. Four agents with disjoint, well-drawn boundaries
  beat ten with overlapping ones.
- Reuse a running teammate via `SendMessage` when the follow-up needs its context.
  A fresh `Agent` call throws that context away.
- The parent (Claude) does the **synthesis**. Agents return findings; conclusions,
  trade-offs and recommendations are the parent's job — that is where the
  cross-cutting view lives.

## 6. Worked example — this migration's research phase

Four R3 teammates, `sonnet` + `medium`, `+1` for the volatile-facts modifier
(provider pricing under a May-2026 cutoff), disjoint scopes:

| Teammate | Scope | Why R3 |
|----------|-------|--------|
| `research-compute` | Container/PaaS free tiers | Read-only, output is a report |
| `research-data` | Managed Postgres + object storage | Read-only, output is a report |
| `research-webrtc` | UDP-capable hosting, LiveKit Cloud, go2rtc necessity | Read-only, output is a report |
| `research-platform` | Registry, CI, TLS/edge, secrets, observability | Read-only, output is a report |

The **decision** each report feeds — "which provider do we actually deploy on" — is R1
and stays with the parent. The **execution** — creating accounts, provisioning,
pointing DNS — is R0 and stays with Fede.
