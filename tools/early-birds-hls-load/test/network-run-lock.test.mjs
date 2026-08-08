import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NETWORK_RUN_LOCK_KIND, acquireNetworkRunLock } from '../src/network-run-lock.mjs';

async function tempLockPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'network-run-lock-'));
  return path.join(directory, 'smoke.lock');
}

test('acquire creates a mode-0600 lock and a concurrent second acquire is refused', async () => {
  const lockPath = await tempLockPath();
  const first = await acquireNetworkRunLock({ path: lockPath, runId: 'run-a', pid: 4321 });
  const details = await stat(lockPath);
  assert.equal(details.mode & 0o777, 0o600);
  assert.equal(details.isFile(), true);
  const contents = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(contents.kind, NETWORK_RUN_LOCK_KIND);
  assert.equal(contents.runId, 'run-a');
  assert.equal(contents.pid, 4321);
  await assert.rejects(
    acquireNetworkRunLock({ path: lockPath, runId: 'run-b' }),
    /network run lock already exists/,
  );
  // The refused second acquire leaves the original lock untouched.
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).runId, 'run-a');
  await first.release();
  await assert.rejects(access(lockPath), /ENOENT/);
});

test('a stale or ambiguous pre-existing lock is refused and never deleted', async () => {
  const lockPath = await tempLockPath();
  const stale = '{"stale":true}\n';
  await writeFile(lockPath, stale, { mode: 0o600 });
  await assert.rejects(
    acquireNetworkRunLock({ path: lockPath, runId: 'run-c' }),
    /network run lock already exists/,
  );
  assert.equal(await readFile(lockPath, 'utf8'), stale);
});

test('a later run proceeds after a clean release', async () => {
  const lockPath = await tempLockPath();
  const first = await acquireNetworkRunLock({ path: lockPath, runId: 'run-d' });
  await first.release();
  const second = await acquireNetworkRunLock({ path: lockPath, runId: 'run-e' });
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).runId, 'run-e');
  await second.release();
  await assert.rejects(access(lockPath), /ENOENT/);
});

test('release removes only the lock this process wrote', async () => {
  const lockPath = await tempLockPath();
  const lock = await acquireNetworkRunLock({ path: lockPath, runId: 'run-f' });
  const replaced = '{"replaced":true}\n';
  await writeFile(lockPath, replaced);
  await lock.release();
  assert.equal(await readFile(lockPath, 'utf8'), replaced);
  await lock.release(); // Releasing twice stays a safe no-op.
  assert.equal(await readFile(lockPath, 'utf8'), replaced);
});

test('release tolerates a lock that is already gone', async () => {
  const lockPath = await tempLockPath();
  const lock = await acquireNetworkRunLock({ path: lockPath, runId: 'run-g' });
  await lock.release();
  await lock.release();
  await assert.rejects(access(lockPath), /ENOENT/);
});

test('a lock path is required', async () => {
  await assert.rejects(acquireNetworkRunLock({ path: '', runId: 'run-h' }), /lock path is required/);
});
