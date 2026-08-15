import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acquireNetworkRunLock,
  NETWORK_RUN_LOCK_PATH,
} from '../src/network-run-lock.mjs';

const wrapperPath = fileURLToPath(new URL('../run-staging-smoke.mjs', import.meta.url));

function runWrapper(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [wrapperPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolveRun({ code: -1, stdout, stderr: stderr + error.message }));
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

function baseArgs(directory) {
  return [
    '--run-id', 'lock-test-run',
    '--start-at', new Date(Date.now() + 120_000).toISOString(),
    '--evidence', path.join(directory, 'evidence.json'),
  ];
}

function networkArgs(directory) {
  return [
    ...baseArgs(directory),
    '--manifest-url-file', path.join(directory, 'missing-manifest'),
    '--canary-status-file', path.join(directory, 'missing-canary.json'),
    '--monitor-status-file', path.join(directory, 'missing-monitor.json'),
    '--clock-offset-ms', '0',
    '--confirm', 'test-confirmation',
  ];
}

// These tests never run network load: every network-mode invocation below is
// refused either at the lock or at the missing precondition files, before any
// load child is spawned.
test('a concurrent second wrapper is refused at the lock before spawning any load', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staging-smoke-wrapper-'));
  const held = await acquireNetworkRunLock({ path: NETWORK_RUN_LOCK_PATH, runId: 'first-run' });
  try {
    const result = await runWrapper(networkArgs(directory));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /network run lock already exists/);
    // The refusal precedes the precondition reads: the missing signed
    // manifest is never even reported.
    assert.doesNotMatch(result.stderr, /signed manifest/);
    // No load child ever ran, so no evidence was produced.
    await assert.rejects(access(path.join(directory, 'evidence.json')), /ENOENT/);
  } finally {
    await held.release();
  }
});

test('a later run passes the lock after a clean release and still fails closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staging-smoke-wrapper-'));
  const held = await acquireNetworkRunLock({ path: NETWORK_RUN_LOCK_PATH, runId: 'first-run' });
  await held.release();
  const result = await runWrapper(networkArgs(directory));
  assert.equal(result.code, 1);
  // The lock was acquired; the run now fails closed on the missing
  // precondition file instead of on the lock.
  assert.match(
    result.stderr,
    /cannot read (?:signed manifest file|external decoded canary status file|target monitor status file)/,
  );
  assert.doesNotMatch(result.stderr, /network run lock/);
  // The validation-error path released the lock deterministically.
  await assert.rejects(access(NETWORK_RUN_LOCK_PATH), /ENOENT/);
});

test('a wrapper that acquires the lock itself refuses a second wrapper until it exits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staging-smoke-wrapper-'));
  const first = await runWrapper(networkArgs(directory));
  // The first wrapper failed closed on preconditions and released its lock,
  // so a following invocation is again refused only on preconditions.
  assert.equal(first.code, 1);
  assert.match(
    first.stderr,
    /cannot read (?:signed manifest file|external decoded canary status file|target monitor status file)/,
  );
  await assert.rejects(access(NETWORK_RUN_LOCK_PATH), /ENOENT/);
});

test('dry-run plans without the network lock even while another run holds it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staging-smoke-wrapper-'));
  const held = await acquireNetworkRunLock({ path: NETWORK_RUN_LOCK_PATH, runId: 'other-run' });
  try {
    const result = await runWrapper([...baseArgs(directory), '--dry-run']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Status: PLANNED/);
    await access(path.join(directory, 'evidence.json'));
  } finally {
    await held.release();
  }
});

test('the production CLI refuses attempts to select a second lock path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staging-smoke-wrapper-'));
  const bypass = path.join(directory, 'bypass.lock');
  const result = await runWrapper([
    ...baseArgs(directory),
    '--dry-run',
    '--lock-file', bypass,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option --lock-file/);
  await assert.rejects(access(bypass), /ENOENT/);
});
