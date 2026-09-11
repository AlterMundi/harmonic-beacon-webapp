import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { atomicWriteJson, compareAndSwapJournal, exactIdentity, writeContentAddressed } from '../../../ops/analytics/durable-json-state.mjs';

test('journal CAS rejects stale phase or generation and preserves the winner', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'analytics-journal-cas-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'journal.json');
  atomicWriteJson(path, { phase: 'prepared', generation: 0, identity: 'run-1-attempt-1' });
  compareAndSwapJournal(path, { phase: 'prepared', generation: 0 }, { phase: 'restore-verified', observation: 'sha256:abc' });
  assert.throws(
    () => compareAndSwapJournal(path, { phase: 'prepared', generation: 0 }, { phase: 'migrated' }),
    /CAS phase conflict/,
  );
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    phase: 'restore-verified', generation: 1, identity: 'run-1-attempt-1', observation: 'sha256:abc',
  });
});

test('crash boundary leaves either complete prior or complete next JSON for exact resume', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'analytics-journal-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'journal.json');
  atomicWriteJson(path, { phase: 'prepared', generation: 0 });
  assert.throws(
    () => compareAndSwapJournal(path, { phase: 'prepared', generation: 0 }, { phase: 'migration-attempted' }, { failpoint: 'before-rename' }),
    /injected crash before rename/,
  );
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { phase: 'prepared', generation: 0 });
  assert.throws(
    () => compareAndSwapJournal(path, { phase: 'prepared', generation: 0 }, { phase: 'migration-attempted' }, { failpoint: 'after-rename' }),
    /injected crash after rename/,
  );
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { phase: 'migration-attempted', generation: 1 });
});

test('replay identity rejects one-field substitution and accepts exact serialization', () => {
  const recorded = { target: 'analytics-production', operation: 'deploy', runId: '123', runAttempt: 2, digest: `sha256:${'a'.repeat(64)}` };
  assert.deepEqual(exactIdentity(recorded, structuredClone(recorded), 'transaction replay'), recorded);
  assert.throws(() => exactIdentity(recorded, { ...recorded, runAttempt: 3 }, 'transaction replay'), /identity conflict/);
});

test('content-addressed evidence replay is idempotent and rejects an occupied mutated object', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'analytics-evidence-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const body = '{"measured":"direct"}\n';
  const first = writeContentAddressed(root, body);
  assert.deepEqual(writeContentAddressed(root, body), first);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(first.path, '{"substituted":true}\n');
  assert.throws(() => writeContentAddressed(root, body), /occupied content-addressed path differs/);
});
