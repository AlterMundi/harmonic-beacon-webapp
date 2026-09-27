# Worktree ownership and garbage collection

One policy applies to every operator and agent. Keep at most three **active**
work lanes per repository per host; archived worktrees are not active lanes.
Before creating a fourth, finish/archive a lane or record a concrete temporary
exception in the owning issue. A dependency directory does not imply ownership.
Never reuse or reset another operator's checkout without resolving its owner.

Declare the lane and objective in the owning issue and pin active linked
worktrees with Git's native lock (the reason should name issue and operator):

```bash
git worktree lock --reason '#590 active; operator name; shared GC tooling' /absolute/worktree
node scripts/hb.mjs worktrees list --json
```

Coordinate the active list with other operators before collection; Git cannot
detect an idle editor or private agent session. The main checkout, current
checkout, locked worktrees and local main/release/early-birds lanes are protected.
Only the owner releases their active lock once their work is safely handed off.
Do not unlock unfamiliar worktrees to make GC pass.

## Dependency and build storage

Share `node_modules` by symlink only when lockfile, Node/platform and generated
client requirements are compatible. Keep its provider outside removable lanes
or pin that provider. Do not run `npm ci` through a consumer and mutate a shared
installation other operators are using. Incompatible lanes get separate installs.
The inventory reports root `node_modules` providers/consumers; check any other
custom shared paths explicitly before removing their provider.

Remove regenerable artifacts only after checking their owner and purpose. This
collector deliberately refuses ignored files too: a directory called `.env`,
`artifacts` or an ignored backup is not disposable just because Git ignores it.
Do not use recursive deletion to bypass that refusal. Artifact cleanup is a
separate reviewed selection; no broad `git clean`, Docker/volume prune or
rollback image deletion. A broken symlink is still a file to preserve/inspect.

## Post-merge GC

From a retained checkout, fetch the canonical remote, then inspect a fresh
inventory. The tool recognizes the canonical GitHub URL rather than assuming
that `origin` is upstream. It requires local remote refs for main, release and
early-birds; it does not fetch or access production itself.

```bash
git fetch upstream  # use the actual canonical remote name
node scripts/hb.mjs worktrees gc --json
```

This is read-only. A candidate must be clean including ignored/untracked files,
unlocked, and its HEAD an ancestor of at least one canonical lane. Index flags
`assume-unchanged` or `skip-worktree` block collection because they can hide WIP
even from Git's normal removal checks. GC rejects
symlinked/missing paths, parent worktrees and providers of another registered
worktree's root node_modules. Inspect the full candidate list and confirm no
other operator owns the selected path. Review existing PRs before removing a
checkout; branches and their PRs remain intact.

For **one explicitly selected candidate**, use its full SHA from the inventory:

```bash
node scripts/hb.mjs worktrees gc --apply \
  --path /absolute/inactive-worktree \
  --expect-head FULL_40_CHARACTER_SHA \
  --backup-dir /absolute/persistent-backups
```

The command creates a self-contained Git bundle of the three canonical lane
tips outside the selected worktree. Candidates with the same lane tips reuse
that archive, avoiding one history copy per deleted worktree. Every invocation
verifies its exact refs, fetches it into an isolated temporary repository,
checks the selected HEAD is recoverable and runs `git fsck`. Only then does it
recheck HEAD, canonical refs and eligibility,
call `git worktree remove` **without force**, and read back removal. It never
deletes a branch, prunes registrations, removes dependencies or alters production.
Bundle paths and outcomes go in the owning issue receipt; bundles stay local
and private. Ensure disk space for the bundle and temporary verification copy.

A repository-local GC lock rejects concurrent collectors. If a process dies,
inspect its result and running processes before removing that stale lock; do not
automatically retry or erase it. Ordinary Git/editor operations do not obey this
lock: operator coordination is still necessary. An error preserves the bundle
if already created; verify actual state before retrying.

Dirty or unmerged lanes are **not** automatic GC candidates. List and review
them separately with their owner; a Git bundle does not contain unstaged,
untracked or ignored files. Preserve that work separately and test recovery
before any separately authorized retirement. Do not force or fake a merge just
to qualify a lane.

Recovery of a collected clean lane needs no private skill:

```bash
git init /absolute/recovered-worktree
git -C /absolute/recovered-worktree fetch /absolute/backups/recorded.bundle \
  '+refs/remotes/*:refs/remotes/*'
git -C /absolute/recovered-worktree checkout --detach FULL_40_CHARACTER_SHA
git -C /absolute/recovered-worktree rev-parse HEAD
```

Compare the full SHA to the receipt. Reinstall dependencies as needed. This is
source recovery, not production/database recovery. Retain required bundles;
archive retention itself is an explicit decision, not an automatic prune.
