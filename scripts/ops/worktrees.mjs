import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const LANES = ['main', 'release', 'early-birds'];
const OWNER = 'AlterMundi/harmonic-beacon-webapp';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function parseWorktrees(raw) {
  const rows = [];
  let row;
  for (const field of raw.split('\0')) {
    if (!field) continue;
    const space = field.indexOf(' ');
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? true : field.slice(space + 1);
    if (key === 'worktree') { row = { path: value }; rows.push(row); }
    else if (row) row[key] = value;
  }
  return rows;
}

function canonicalRemote(repo) {
  for (const remote of git(repo, ['remote']).trim().split('\n')) {
    if (!remote) continue;
    const url = git(repo, ['remote', 'get-url', remote]).trim().replace(/\.git$/, '');
    if (url === `git@github.com:${OWNER}` || url === `https://github.com/${OWNER}`
        || url === `ssh://git@github.com/${OWNER}`) return remote;
  }
  throw new Error(`canonical remote for ${OWNER} not found; no GC permitted`);
}

export function inventory(repo = process.cwd()) {
  const current = realpathSync(git(repo, ['rev-parse', '--show-toplevel']).trim());
  const common = realpathSync(resolve(repo, git(repo, ['rev-parse', '--git-common-dir']).trim()));
  const remote = canonicalRemote(repo);
  const bases = LANES.map(lane => {
    const ref = `refs/remotes/${remote}/${lane}`;
    return { ref, sha: git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]).trim() };
  });
  const rows = parseWorktrees(git(repo, ['worktree', 'list', '--porcelain', '-z']));
  for (const row of rows) {
    row.reasons = [];
    row.mergedInto = bases.filter(base => {
      try { git(repo, ['merge-base', '--is-ancestor', row.HEAD, base.sha]); return true; }
      catch (error) { if (error.status === 1) return false; throw error; }
    }).map(base => base.ref);
    if (!row.mergedInto.length) row.reasons.push('not merged into a canonical lane');
    if (row.bare || row.path === dirname(common)) row.reasons.push('main/bare worktree');
    if (within(row.path, current) || within(row.path, realpathSync(process.cwd()))) row.reasons.push('current worktree');
    if (row.locked !== undefined) row.reasons.push('locked/active worktree');
    if (row.prunable !== undefined || !existsSync(row.path)) row.reasons.push('missing/prunable; investigate separately');
    if (LANES.some(lane => row.branch === `refs/heads/${lane}`)) row.reasons.push('canonical local lane');
    if (rows.some(other => other !== row && within(row.path, other.path))) row.reasons.push('contains another worktree');
    if (existsSync(row.path)) {
      if (lstatSync(row.path).isSymbolicLink() || realpathSync(row.path) !== row.path) row.reasons.push('symlinked worktree path');
      const status = git(row.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']);
      if (status) row.reasons.push('tracked, untracked or ignored files present');
      // status and even worktree remove ignore WIP hidden by these index flags.
      if (git(row.path, ['ls-files', '-v', '-z']).split('\0').some(entry => /^[a-zS] /u.test(entry))) {
        row.reasons.push('assume-unchanged or skip-worktree index flags can hide local work');
      }
      const modules = join(row.path, 'node_modules');
      if (existsSync(modules)) row.dependencies = { path: modules, target: realpathSync(modules), shared: lstatSync(modules).isSymbolicLink() };
    }
  }
  for (const row of rows) {
    const users = rows.filter(other => other !== row && other.dependencies && within(row.path, other.dependencies.target));
    if (users.length) row.reasons.push(`supplies node_modules to ${users.length} other worktree(s)`);
    row.eligible = row.reasons.length === 0;
  }
  return { schemaVersion: 1, repository: OWNER, current, common, bases, worktrees: rows };
}

// One explicit target per invocation. Never force, prune, delete branches or remove artifacts.
export function collect(repo, { path, expectedHead, backupDir }) {
  const initial = inventory(repo);
  const lock = join(initial.common, 'hb-worktrees-gc.lock');
  mkdirSync(lock); // Fail closed if a previous/interrupted collector owns the repository.
  try {
    const select = report => {
      const row = report.worktrees.find(entry => entry.path === resolve(path));
      if (!row || !row.eligible) throw new Error(`worktree is not eligible: ${row?.reasons.join('; ') || 'not registered'}`);
      if (row.HEAD !== expectedHead) throw new Error('HEAD changed since the reviewed inventory');
      return row;
    };
    const row = select(inventory(repo));
    const backup = resolve(backupDir);
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    const backupReal = realpathSync(backup);
    if (within(row.path, backupReal)) throw new Error('backup must be outside the target worktree');
    // All eligible HEADs are reachable from these three lane tips. Reuse a single
    // self-contained archive, instead of multiplying history by the worktree count.
    const archiveId = createHash('sha256').update(JSON.stringify(initial.bases)).digest('hex');
    const bundle = join(backupReal, `lanes-${archiveId}.bundle`);
    if (!existsSync(bundle)) {
      const pending = `${bundle}.${randomUUID()}.partial`;
      git(repo, ['bundle', 'create', pending, ...initial.bases.map(base => base.ref)]);
      chmodSync(pending, 0o600);
      linkSync(pending, bundle); // Publish without overwriting an existing archive.
      unlinkSync(pending);
    }
    git(repo, ['bundle', 'verify', bundle]);
    const heads = git(repo, ['bundle', 'list-heads', bundle]).trim().split('\n').sort();
    const expected = initial.bases.map(base => `${base.sha} ${base.ref}`).sort();
    if (JSON.stringify(heads) !== JSON.stringify(expected)) throw new Error('bundle does not bind the canonical lane tips');
    // Verify recovery into an empty object database, not only against this repository.
    const recovery = mkdtempSync(join(tmpdir(), 'hb-gc-verify-'));
    git(repo, ['init', '--bare', recovery]);
    try {
      git(recovery, ['fetch', bundle, ...initial.bases.map(base => `${base.ref}:${base.ref}`)]);
      git(recovery, ['cat-file', '-e', `${row.HEAD}^{commit}`]);
      const recovered = git(recovery, ['rev-parse', `${row.HEAD}^{commit}`]).trim();
      if (recovered !== row.HEAD) throw new Error('isolated bundle recovery did not reproduce HEAD');
      git(recovery, ['fsck', '--full']);
    } finally {
      rmSync(recovery, { recursive: true }); // Only the private temporary verification repo.
    }
    const fresh = inventory(repo);
    select(fresh);
    if (JSON.stringify(fresh.bases) !== JSON.stringify(initial.bases)) throw new Error('canonical refs changed during GC');
    git(repo, ['worktree', 'remove', row.path]);
    if (parseWorktrees(git(repo, ['worktree', 'list', '--porcelain', '-z'])).some(entry => entry.path === row.path)
        || existsSync(row.path)) throw new Error('worktree removal could not be verified');
    return { removed: row.path, head: row.HEAD, bundle, isolatedRecoveryVerified: true, branchesPreserved: true };
  } finally { rmdirSync(lock); }
}

export function main(argv, repo = process.cwd()) {
  const [command = 'list', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json' || arg === '--apply') options[arg.slice(2)] = true;
    else if (['--path', '--expect-head', '--backup-dir'].includes(arg)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
      if (options[arg] !== undefined) throw new Error(`duplicate argument: ${arg}`);
      options[arg] = rest[++i];
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['list', 'gc'].includes(command)) throw new Error('use worktrees list [--json] or gc [--json] [--apply --path PATH --expect-head SHA --backup-dir DIR]');
  if (options.apply) {
    if (command !== 'gc' || !options['--path'] || !/^[0-9a-f]{40}$/.test(options['--expect-head'] || '') || !options['--backup-dir']) {
      throw new Error('GC apply requires --path, full --expect-head and --backup-dir');
    }
    console.log(JSON.stringify(collect(repo, { path: options['--path'], expectedHead: options['--expect-head'], backupDir: options['--backup-dir'] }), null, 2));
    return 0;
  }
  const report = inventory(repo);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Read-only inventory: ${report.worktrees.length} worktrees; ${report.worktrees.filter(row => row.eligible).length} GC candidates. Fetch canonical refs and coordinate active lanes before apply.`);
    for (const row of report.worktrees) console.log(`${row.eligible ? 'CANDIDATE' : 'KEEP'} ${JSON.stringify(row.path)} ${row.HEAD} ${row.reasons.join('; ')}`);
  }
  return 0;
}
