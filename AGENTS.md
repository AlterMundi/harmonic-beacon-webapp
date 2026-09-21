# Agent entry contract

User instructions remain authoritative. For work involving environments,
releases, deploys, incidents, backups, payments, identity, or service health,
read `docs/ops/OPERATING_CONTRACT.md` and inspect
`deploy/platform-services.json` before acting.

## Autonomous review policy (owner decision, 2026-09-21)

The task owner reviews and delivers their own work. Do not request external
approvals or block on another operator's review by default. Use an adversarial
subagent only when a concrete risk or unresolved uncertainty warrants a second
examination; not for every PR, commit or repair. Keep that review scoped to the
risk and resolve substantive findings before delivery. No reviewer chains.

This policy supersedes older mandatory independent-review/GitHub-approval
instructions, including pending operator-loop and skill guidance. PRs remain
the change record; relevant automated checks, exact-candidate verification,
production authorization boundaries and recovery safeguards still apply.

Use a dedicated clean worktree for repository changes and preserve unrelated
user or operator work. Before editing, inspect the current branch, status,
upstreams, concurrent worktrees, and relevant open pull requests. Do not treat
old reports, issue comments, memories, or recorded SHAs as live state.

Run `scripts/hb.mjs change-impact --base <comparison-ref>` to obtain the
minimum known verification profile, then add checks required by the actual
risk. Run `scripts/hb.mjs doctor` before an operational mutation and read back
the exact external target afterwards.

Production authority is not inferred from shell, sudo, Docker, database, DNS,
or GitHub access. Use only the reviewed workflow and restricted helper for the
owning service. Never touch DNSExit or exercise real payments unless the user
explicitly authorizes that exact operation.
