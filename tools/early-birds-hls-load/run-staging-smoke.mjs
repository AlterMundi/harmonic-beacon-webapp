#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlan, selectTarget } from './src/contracts.mjs';
import { acquireNetworkRunLock, NETWORK_RUN_LOCK_PATH } from './src/network-run-lock.mjs';
import { startStatusGuard } from './src/smoke-guard.mjs';
import {
  SIGNED_MANIFEST_MAX_BYTES,
  SMOKE_TARGET_ID,
  readJsonStatus,
  readPrivateFile,
  validateNetworkSmokePreconditions,
} from './src/smoke-safety.mjs';

const toolRoot = dirname(fileURLToPath(import.meta.url));
const policyPath = resolve(toolRoot, 'policies/listener-staging-smoke-10.json');
const profilesPath = resolve(toolRoot, 'profiles.json');

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function printHelp() {
  process.stdout.write(`Usage:
  node tools/early-birds-hls-load/run-staging-smoke.mjs \\
    --run-id RUN_ID --start-at UTC --evidence PATH --dry-run

For the exact ten-client network smoke, remove --dry-run and add:
  --manifest-url-file FILE --canary-status-file FILE --monitor-status-file FILE \\
  --clock-offset-ms NUMBER --confirm "EXACT DRY-RUN CONFIRMATION"

This wrapper fixes the target, origin, profile and shard count. It cannot run
more than ten clients or target any host other than the isolated stream origin.
A network run first takes an exclusive local lock on this generator host, so two
wrappers on the same host and Unix account cannot overlap. Its one absolute
path is not configurable; the lock is refused — never deleted — when it is
already held or stale. Do not manually remove or replace it during a run.
The lock is local to one host: a single trusted authorized generator is an
operational precondition that this code cannot enforce across hosts.
`);
}

async function readDocuments() {
  const [policy, profiles] = await Promise.all([
    readFile(policyPath, 'utf8').then(JSON.parse),
    readFile(profilesPath, 'utf8').then(JSON.parse),
  ]);
  return { policy, profiles };
}

async function readPreconditions({
  manifestPath,
  canaryPath,
  monitorPath,
  plan,
  target,
  checkFileFreshness = false,
}) {
  const [{ text, details }, canaryStatus, monitorStatus] = await Promise.all([
    readPrivateFile(manifestPath, 'signed manifest', SIGNED_MANIFEST_MAX_BYTES),
    readJsonStatus(canaryPath, 'external decoded canary status'),
    readJsonStatus(monitorPath, 'target monitor status'),
  ]);
  const values = {
    plan,
    target,
    manifest: {
      value: text.trim(),
      writtenAtMs: checkFileFreshness ? details.mtimeMs : null,
    },
    canaryStatus,
    monitorStatus,
  };
  validateNetworkSmokePreconditions(values);
  return values;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const known = new Set([
    '--run-id', '--start-at', '--evidence', '--dry-run', '--manifest-url-file',
    '--canary-status-file', '--monitor-status-file', '--clock-offset-ms', '--confirm',
  ]);
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) throw new Error(`unknown option ${argument}`);
  }
  const dryRun = args.includes('--dry-run');
  const runId = option(args, '--run-id');
  const startAt = option(args, '--start-at');
  const evidence = option(args, '--evidence');
  if (!runId || !startAt || !evidence) throw new Error('--run-id, --start-at and --evidence are required');

  const { policy, profiles } = await readDocuments();
  const target = selectTarget(policy, SMOKE_TARGET_ID);
  const profile = profiles.profiles?.['staging-smoke'];
  const plan = buildPlan({
    runId,
    profileName: 'staging-smoke',
    profile,
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt,
    networkRun: !dryRun,
  });

  const childArgs = [
    resolve(toolRoot, 'run.mjs'),
    '--profiles', profilesPath,
    '--policy', policyPath,
    '--target', SMOKE_TARGET_ID,
    '--profile', 'staging-smoke',
    '--run-id', runId,
    '--start-at', startAt,
    '--shard-index', '0',
    '--shard-count', '1',
    '--evidence', resolve(evidence),
  ];
  let guard = null;
  let child = null;
  let lock = null;
  let signalName = null;
  const onSignal = (name) => {
    if (signalName) return;
    signalName = name;
    // Stop the guard first so an in-flight status check can never abort or
    // kill during shutdown; then forward the interrupt to the load child.
    guard?.stop();
    child?.kill('SIGINT');
  };
  try {
    if (dryRun) {
      childArgs.push('--dry-run');
    } else {
      const manifestPath = option(args, '--manifest-url-file');
      const canaryPath = option(args, '--canary-status-file');
      const monitorPath = option(args, '--monitor-status-file');
      const clockOffset = option(args, '--clock-offset-ms');
      const confirmation = option(args, '--confirm');
      if (!manifestPath || !canaryPath || !monitorPath || clockOffset === null || !confirmation) {
        throw new Error('network smoke requires signed manifest, external canary, target monitor, clock offset and confirmation');
      }
      // The exclusive local lock is taken before any precondition read or
      // child spawn and is held through child exit and guard stop, so two
      // wrappers on this host can never overlap a network run. A held, stale
      // or ambiguous lock refuses the run; it is never deleted by a non-owner.
      lock = await acquireNetworkRunLock({
        path: NETWORK_RUN_LOCK_PATH,
        runId,
      });
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      await readPreconditions({
        manifestPath,
        canaryPath,
        monitorPath,
        plan,
        target,
        checkFileFreshness: true,
      });
      childArgs.push(
        '--manifest-url-file', resolve(manifestPath),
        '--clock-offset-ms', clockOffset,
        '--confirm', confirmation,
        '--external-generator',
      );
      guard = startStatusGuard({
        check: () => readPreconditions({ manifestPath, canaryPath, monitorPath, plan, target }),
        onAbort: () => child?.kill('SIGINT'),
      });
    }
    if (signalName) {
      // Interrupted between lock acquisition and spawn: no load ever started.
      process.exitCode = 130;
      return;
    }
    child = spawn(process.execPath, childArgs, { stdio: 'inherit', env: process.env });
    // A guard abort between precondition validation and spawn is delivered here,
    // so the child can never run unguarded after a failed status.
    if (guard?.aborted) child.kill('SIGINT');
    const exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 130 : 1)));
    });
    if (guard) guard.stop();
    process.exitCode = signalName ? 130 : exitCode;
  } finally {
    // Deterministic cleanup on every path — validation error, spawn error,
    // signal/abort and normal exit: park the guard, drop the signal handlers
    // and release only the lock this process owns.
    guard?.stop();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (lock) await lock.release();
  }
}

main().catch((error) => {
  process.stderr.write(`Ten-client smoke refused: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
