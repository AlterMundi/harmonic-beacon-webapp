import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, inventory, main, parseWorktrees } from '../worktrees.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hb-gc-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'GC test');
  git(repo, 'config', 'user.email', 'gc@example.invalid');
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env\n');
  writeFileSync(join(repo, 'tracked'), 'retained source\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'initial');
  const head = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'remote', 'add', 'canonical', 'git@github.com:AlterMundi/harmonic-beacon-webapp.git');
  for (const lane of ['main', 'release', 'early-birds']) git(repo, 'update-ref', `refs/remotes/canonical/${lane}`, head);
  const path = join(root, 'candidate with spaces');
  git(repo, 'worktree', 'add', '-b', 'done', path);
  const options = { path, expectedHead: head, backupDir: join(root, 'backups') };
  return { root, repo, path, head, options, row: () => inventory(repo).worktrees.find(w => w.path === path) };
}

test('NUL worktree parsing preserves whitespace and lock reasons', () => {
  assert.deepEqual(parseWorktrees('worktree /tmp/with\nnewline\0HEAD abc\0locked active lane\0\0'), [{ path: '/tmp/with\nnewline', HEAD: 'abc', locked: 'active lane' }]);
});

test('inventory and default gc are read-only; apply needs an exact target', t => {
  const f = fixture(t);
  assert.equal(f.row().eligible, true);
  t.mock.method(console, 'log', () => {});
  assert.equal(main(['gc', '--json'], f.repo), 0);
  assert.equal(existsSync(f.path), true);
  assert.throws(() => main(['gc', '--apply'], f.repo), /requires/);
  assert.throws(() => collect(f.repo, { ...f.options, expectedHead: '0'.repeat(40) }), /HEAD changed/);
  assert.equal(existsSync(f.path), true);
});

test('merged clean collection preserves branch and independently recoverable source', t => {
  const f = fixture(t);
  const result = collect(f.repo, f.options);
  assert.equal(existsSync(f.path), false);
  assert.equal(git(f.repo, 'rev-parse', 'done'), f.head);
  const restore = join(f.root, 'restore');
  git(f.repo, 'init', restore);
  git(restore, 'fetch', result.bundle, 'refs/remotes/canonical/main');
  git(restore, 'checkout', '--detach', f.head);
  assert.equal(git(restore, 'rev-parse', 'HEAD'), f.head);
  assert.equal(readFileSync(join(restore, 'tracked'), 'utf8'), 'retained source\n');
  assert.equal(result.isolatedRecoveryVerified, true);
  const second = join(f.root, 'second');
  git(f.repo, 'worktree', 'add', '-b', 'second', second);
  const next = collect(f.repo, { ...f.options, path: second });
  assert.equal(next.bundle, result.bundle, 'same lane tips share a single history archive');
});

for (const [name, change] of [
  ['tracked changes', f => writeFileSync(join(f.path, 'tracked'), 'WIP')],
  ['untracked files', f => writeFileSync(join(f.path, 'new-file'), 'WIP')],
  ['ignored secrets', f => writeFileSync(join(f.path, '.env'), 'private')],
  ['locked active lane', f => git(f.repo, 'worktree', 'lock', '--reason', '#590 active', f.path)],
  ['unmerged commits', f => { writeFileSync(join(f.path, 'tracked'), 'new'); git(f.path, 'commit', '-am', 'not merged'); }],
  ['canonical local lane', f => git(f.path, 'branch', '-m', 'release')],
  ['assume-unchanged WIP', f => { git(f.path, 'update-index', '--assume-unchanged', 'tracked'); writeFileSync(join(f.path, 'tracked'), 'hidden WIP'); }],
  ['skip-worktree WIP', f => { git(f.path, 'update-index', '--skip-worktree', 'tracked'); writeFileSync(join(f.path, 'tracked'), 'hidden WIP'); }],
]) {
  test(`GC refuses ${name}`, t => {
    const f = fixture(t); change(f);
    assert.equal(f.row().eligible, false);
    assert.throws(() => collect(f.repo, f.options), /not eligible/);
    assert.equal(existsSync(f.path), true);
  });
}

test('GC protects main/current checkout, nested worktrees and shared dependencies', t => {
  const f = fixture(t);
  assert.throws(() => collect(f.repo, { ...f.options, path: f.repo }), /not eligible/);
  assert.throws(() => collect(f.path, f.options), /current worktree/);
  const consumer = join(f.root, 'consumer');
  git(f.repo, 'worktree', 'add', '-b', 'consumer', consumer);
  // Even a symlink to tracked content makes this a dependency provider.
  symlinkSync(f.path, join(consumer, 'node_modules'));
  assert.match(f.row().reasons.join(';'), /supplies node_modules/);
  assert.throws(() => collect(f.repo, f.options), /not eligible/);
});

test('GC preserves a parent worktree even when nested worktree is ignored', t => {
  const f = fixture(t);
  const nested = join(f.path, 'node_modules');
  git(f.repo, 'worktree', 'add', '-b', 'nested', nested);
  assert.match(f.row().reasons.join(';'), /contains another worktree/);
  assert.throws(() => collect(f.repo, f.options), /not eligible/);
  assert.equal(existsSync(nested), true);
});

test('shared archive recovers ancestor commits and corrupt reuse never removes a lane', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'tracked'), 'new tip');
  git(f.repo, 'commit', '-am', 'advance');
  const tip = git(f.repo, 'rev-parse', 'HEAD');
  for (const lane of ['main', 'release', 'early-birds']) git(f.repo, 'update-ref', `refs/remotes/canonical/${lane}`, tip);
  const result = collect(f.repo, f.options);
  assert.equal(result.head, f.head);
  const second = join(f.root, 'second');
  git(f.repo, 'worktree', 'add', '-b', 'second', second);
  writeFileSync(result.bundle, 'broken archive');
  assert.throws(() => collect(f.repo, { ...f.options, path: second, expectedHead: tip }));
  assert.equal(existsSync(second), true);
  assert.equal(existsSync(join(f.repo, '.git', 'hb-worktrees-gc.lock')), false);
});

test('GC requires canonical remote, all lane refs and external backup', t => {
  const f = fixture(t);
  assert.throws(() => collect(f.repo, { ...f.options, backupDir: join(f.path, 'backup') }), /outside/);
  git(f.repo, 'update-ref', '-d', 'refs/remotes/canonical/early-birds');
  assert.throws(() => inventory(f.repo));
  git(f.repo, 'remote', 'set-url', 'canonical', 'git@github.com:someone/fork.git');
  assert.throws(() => inventory(f.repo), /canonical remote/);
});

test('another collector or interrupted lock blocks mutations', t => {
  const f = fixture(t);
  mkdirSync(join(f.repo, '.git', 'hb-worktrees-gc.lock'));
  assert.throws(() => collect(f.repo, f.options), /EEXIST/);
  assert.equal(existsSync(f.path), true);
});
