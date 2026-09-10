# Agent entry contract

User instructions remain authoritative. For work involving environments,
releases, deploys, incidents, backups, payments, identity, or service health,
read `docs/ops/OPERATING_CONTRACT.md` and inspect
`deploy/platform-services.json` before acting.

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
