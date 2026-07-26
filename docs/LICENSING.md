# Licensing — decision record and how to apply it across the constellation

*Decided 2026-07-26. Supersedes LEGAL_AUDIT finding L1.*

## The decision

**Apache License 2.0** for the source code, across the Harmonic Beacon
repositories. `SPDX-License-Identifier: Apache-2.0`. Copyright holder:
**Asociación Civil AlterMundi**.

## Why, and what it costs

L1 was recorded as "a blocker before the repo goes public". It was not: this
repository has been **public since 2026-01-23** with no license, and so are six
sibling repositories. The decision was never about whether to publish — it was
six months of ambiguity nobody had chosen.

The unlicensed state was the worst available. A visitor could read and fork the
source but had no right to run, modify or deploy it, and a pull request carried
no grant to AlterMundi at all, because GitHub's inbound=outbound terms apply only
to a repository that states a license.

AGPL-3.0 was researched carefully and is the more obvious fit for a hosted
service: its §13 is the only OSI-approved instrument that reaches software
running as a network service, where GPLv3 and permissive licenses alike impose
nothing on a rival. It was rejected for two reasons.

**The dual-licensing upside is not available.** AGPL's protection is worth
paying for mainly if you sell proprietary exceptions, and that requires
consolidating copyright in one holder, which requires a CLA. A CLA on a
community-technology project is real friction on volunteer contributors and
attracts the "open in name only" criticism specifically. AlterMundi is not
running one. Without it, AGPL delivers the friction and not the benefit.

**And it would defend the wrong asset.** The moat here is not the code. It is
the live beacon, which is a physical and operational thing; the provider
relationships; the research credibility; the trademark; and the Constellation
charter. A fork gets a mixer UI and no beacon. Meanwhile AGPL carries real
procurement friction at exactly the universities and clinics that
[MONETIZATION.md](./MONETIZATION.md) targets with study and clinic licenses —
blanket AGPL prohibitions are common there.

What is given up, stated plainly: **a well-resourced competitor may take this,
improve it privately, host a rival service, and contribute nothing back.** That
is lawful under Apache-2.0 and the grant is irrevocable for versions already
published. The judgement is that this costs less than the friction AGPL would
have added, and that six months of public source with zero forks is weak evidence
of anyone wanting to.

### Apache-2.0 rather than MIT

Three differences that matter for this project specifically:

1. **An express patent grant, with retaliation.** The Seal and its measurement
   methodology ([PHASE_4](./phases/PHASE_4_CERTIFICATION_AND_BEYOND.md) §2.3) are
   the kind of work that might later involve patents. MIT is silent on patents,
   which is a known trap for a project with a research-IP horizon.
2. **§5 makes inbound=outbound explicit in the license text**, so contributions
   do not depend on GitHub's terms of service to be licensed. This is what makes
   a DCO sufficient and a CLA unnecessary.
3. **§6 expressly declines to grant trademark rights**, which is the mechanism
   that lets the code be permissive while the Constellation stays governed by its
   charter.

### What the license does not cover

- **Content.** Provider audio, session recordings, the beacon stream. Governed by
  the Provider Content Agreement, which [CONTENT_POLICY.md](./CONTENT_POLICY.md)
  §7 records as undrafted, with the license term still unresolved. Unaffected by
  this decision.
- **Trademarks.** "Harmonic Beacon", "AlterMundi", the Seal. The Constellation's
  charter-as-license is a trademark license and is unaffected.
- **Documentation.** `docs/` and `BUSINESS_RULES.md` are swept up in this license
  for want of a separate decision. `harmonic-information-theory` — the founding
  work this product implements — is published **CC BY 4.0**, and aligning the
  documentation with it would be coherent. Open question, deliberately not
  decided here.

## Still owed

**A one-time agreement from the second contributor.** `git log` shows two
identities: Fede654 (78 commits) and AnnieScigliano (21). Because the repository
carried no license, those commits are not covered by inbound=outbound, so
copyright in that portion is co-held unless an employment or assignment
relationship exists. Licensing the code Apache-2.0 requires the right to do so.

This is a much lighter ask than a CLA: a short written "I agree my contributions
to this repository are licensed under Apache-2.0", once, covering commits to
date. Everything after the LICENSE file lands is covered by §5 automatically.

**Four questions for an Argentine IP lawyer**, none of which blocks the license
file:

1. Is the second contributor's work covered by Ley 11.723 Art. 4 inc. d)
   (work-for-hire where a dependent employee hired to develop software produces
   it in the course of duties), or does she hold copyright? Get it in writing
   either way.
2. Ley 11.723 Art. 57 / 63 — does publishing under an open license start the
   legal-deposit clock, and should the work be registered at DNDA to avoid the
   Art. 63 suspension of rights? Ask specifically about software published on a
   foreign platform. This affects enforceability, not the choice.
3. Does the association's *estatuto* permit commercial software licensing within
   its object?
4. For the study and clinic contracts: is a services agreement that never touches
   the code license the right instrument, now that there is no code-license
   exception to sell?

## Applying it to the other repositories

Six sibling repositories are public with no license. Consistency is most of the
signal — six repositories of one product under different terms says something
nobody intends.

| Repository | State |
|---|---|
| `harmonic-beacon-webapp` | ✅ Apache-2.0 |
| `harmonic-beacon-mobile` | no license |
| `harmonicbeacon.com` | no license |
| `beacon-spatial` | no license |
| `cymatic-control` | no license |
| `beacon-rasgador` | no license |
| `harmonic-beacon-ESP32-Actuator` | no license |

For each, four steps:

1. **`LICENSE`** — the canonical Apache-2.0 text, unmodified. Copy it from this
   repository rather than retyping or paraphrasing it:
   ```bash
   curl -sO https://raw.githubusercontent.com/AlterMundi/harmonic-beacon-webapp/main/LICENSE
   ```
2. **`NOTICE`** — copy this repository's and adjust the first line and the
   third-party section. Keep the content and trademark carve-outs verbatim; they
   are the part that matters and the part most easily lost in an edit.
3. **Manifest** — `"license": "Apache-2.0"` in `package.json`, or the equivalent
   for the language: `license = "Apache-2.0"` in `Cargo.toml` / `pyproject.toml`,
   `license` in `platformio.ini` for the ESP32 firmware.
4. **README** — the License section from this repository, with paths adjusted.

**One caveat before applying it blindly.** `harmonic-beacon-ESP32-Actuator` is
firmware and `beacon-spatial` may vendor code; check each for a GPL or LGPL
dependency first, since a copyleft dependency that is actually redistributed
imposes obligations Apache-2.0 does not satisfy on its own. This repository was
checked: no GPL, AGPL or SSPL anywhere in either dependency tree, and the LGPL
sharp/libvips binaries are not redistributed because container images are built
on the deployment host and pushed to no registry. **That last point stops being
true the moment anyone adds a registry push** — see [NOTICE](../NOTICE).

Also worth knowing: `HarMoCAP`, another Harmonic Beacon component, carries a
carefully reasoned note about `ultralytics` being AGPL-3.0 and what that would
mean for a distributed combined work. Whoever wrote it has already thought about
this class of question and should review any firmware or ML repository before it
is licensed.
