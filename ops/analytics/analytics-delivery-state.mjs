#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { atomicWriteJson, compareAndSwapJournal, exactIdentity, readJsonFile, writeContentAddressed } from './durable-json-state.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const ATTEMPT = /^[1-9][0-9]{0,9}$/;
const IMAGE_REPOSITORY = 'ghcr.io/altermundi/harmonic-beacon-analytics';
const WORKFLOW_REF = 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release';
const ROOT = '/usr/local/libexec/harmonic-beacon/analytics';
const STATE_DIR = '/var/lib/harmonic-beacon/analytics-delivery';
const ENV_FILE = '/etc/harmonic-beacon/analytics.env';
const BACKUP_ROOT = '/mnt/beacon-data/backups/analytics/postgres';
const TRUSTED_COMPOSE = `${ROOT}/compose.yml`;
const RESTORE = `${ROOT}/restore-verify-analytics.sh`;
const MONITOR = `${ROOT}/monitor-analytics.sh`;

const NOTIFICATION_STATE = '/var/lib/harmonic-beacon/analytics-monitor-notification/notification.json';
const CURRENT_STATE = `${STATE_DIR}/current-state.json`;
const TRANSACTIONS = `${STATE_DIR}/transactions`;

function fail(message) { throw new Error(message); }
function digest(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
function valid(value, pattern, message) { if (!pattern.test(value ?? '')) fail(message); return value; }
function command(path, args, options = {}) {
  return execFileSync(path, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024, ...options }).trim();
}
function syncDirectory(path) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function atomicBytes(path, bytes) {
  const temporary = `${path}.new-${process.pid}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}
function atomicJson(path, value) { atomicWriteJson(path, value); }
function secureFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== 0 || (info.mode & 0o777) !== 0o600) fail(`unsafe root state file: ${basename(path)}`);
  return info;
}
function readJson(path) { secureFile(path); return readJsonFile(path); }
function optionalJson(path) { try { return readJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function secureRootAncestors(path) {
  let ancestor = path;
  while (true) {
    const info = lstatSync(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || info.gid !== 0 || (info.mode & 0o022) !== 0) {
      fail(`unsafe root-owned backup ancestor: ${ancestor}`);
    }
    if (ancestor === '/') return;
    ancestor = dirname(ancestor);
  }
}
function failpoint(name) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0 && process.env.HB_ANALYTICS_STATE_FAILPOINT === name) fail(`injected state interruption after ${name}`);
}
function transactionPath(runId, runAttempt) { return join(TRANSACTIONS, `${runId}-${runAttempt}`); }
function assertExact(actual, expected, message) { return exactIdentity(actual, expected, message); }

function parseInvocation(argv) {
  if (argv.length !== 15) fail('invalid analytics state-machine invocation');
  const [verb, target, operation, sourceSha, imageDigest, ciRunId, ciRunAttempt, buildRunId, buildRunAttempt, workflowRef, githubRef, runId, runAttempt, reversedRunId, reversedRunAttempt] = argv;
  if (!['observe', 'transaction'].includes(verb)) fail('invalid adapter verb');
  if (target !== 'analytics-production') fail('invalid analytics target');
  if (!['probe', 'status', 'deploy', 'rollback'].includes(operation)) fail('invalid analytics operation');
  valid(sourceSha, SHA40, 'invalid source SHA'); valid(imageDigest, SHA256, 'invalid image digest');
  for (const [value, name] of [[ciRunId, 'CI run id'], [buildRunId, 'build run id'], [runId, 'delivery run id']]) valid(value, ID, `invalid ${name}`);
  for (const [value, name] of [[ciRunAttempt, 'CI attempt'], [buildRunAttempt, 'build attempt'], [runAttempt, 'delivery attempt']]) valid(value, ATTEMPT, `invalid ${name}`);
  if (workflowRef !== WORKFLOW_REF || githubRef !== 'refs/heads/release') fail('foreign workflow invocation');
  if (operation === 'rollback') {
    valid(reversedRunId, ID, 'invalid reversed deployment run id');
    valid(reversedRunAttempt, ATTEMPT, 'invalid reversed deployment run attempt');
  } else if (reversedRunId !== '0' || reversedRunAttempt !== '0') fail('unexpected reversal identity');
  if (verb === 'transaction' && !['deploy', 'rollback'].includes(operation)) fail('observation cannot enter the transaction state machine');
  if (verb === 'observe' && !['probe', 'status'].includes(operation)) fail('mutation requires the transaction state machine');
  return {
    verb, target, operation, sourceSha, imageDigest, ciRunId, ciRunAttempt: Number(ciRunAttempt),
    buildRunId, buildRunAttempt: Number(buildRunAttempt), workflowRef, githubRef,
    runId, runAttempt: Number(runAttempt), reversedRunId, reversedRunAttempt: Number(reversedRunAttempt),
  };
}

function inspectImage(sourceSha, imageDigest) {
  const ref = `${IMAGE_REPOSITORY}@${imageDigest}`;
  const imageId = command('/usr/bin/docker', ['image', 'inspect', ref, '--format', '{{.Id}}']);
  valid(imageId, SHA256, 'candidate image ID is invalid');
  const revision = command('/usr/bin/docker', ['image', 'inspect', ref, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}']);
  if (revision !== sourceSha) fail('OCI revision differs from source SHA');
  const repoDigests = command('/usr/bin/docker', ['image', 'inspect', ref, '--format', '{{range .RepoDigests}}{{println .}}{{end}}']).split('\n');
  if (!repoDigests.includes(ref)) fail('OCI RepoDigest differs from requested digest');
  return { imageId, revision, ref };
}

function composeEnvironment(selected) {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root',
    ANALYTICS_IMAGE_REF: `${IMAGE_REPOSITORY}@${selected.digest}`,
    ANALYTICS_EXPECTED_SOURCE_REVISION: selected.sourceSha,
    ANALYTICS_ARTIFACT_IMAGE_ID: selected.imageId,
    ANALYTICS_ARTIFACT_DIGEST: selected.digest,
    ANALYTICS_CONFIG_SHA256: selected.configSha256,
    ANALYTICS_ENV_FILE: ENV_FILE,
  };
}
function compose(composePath, selected, args) {
  return command('/usr/bin/docker', ['compose', '--file', composePath, '--project-name', 'harmonic-beacon-analytics', '--env-file', ENV_FILE, ...args], { env: composeEnvironment(selected) });
}
function compose_migrate(composePath, selected) {
  return compose(composePath, selected, ['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate']);
}
function compose_replace(composePath, selected) {
  return compose(composePath, selected, ['up', '-d', '--force-recreate', '--no-build', '--pull', 'never', 'postgres', 'collector', 'worker']);
}

function readCurrentState() {
  const state = readJson(CURRENT_STATE);
  if (state.schemaVersion !== 'hb.analytics.current-state.v2') fail('unsupported analytics current state');
  const expected = ['schemaVersion', 'sourceSha', 'imageId', 'digest', 'configSha256', 'composeBase64', 'healthContract'];
  if (Object.keys(state).sort().join(',') !== expected.sort().join(',')) fail('analytics current state is not closed');
  valid(state.sourceSha, SHA40, 'current source is invalid'); valid(state.imageId, SHA256, 'current image ID is invalid');
  valid(state.digest, SHA256, 'current digest is invalid'); valid(state.configSha256, SHA256, 'current config is invalid');
  if (!['hb.analytics.provenance.v1', 'legacy-container-health'].includes(state.healthContract)) fail('current compatibility metadata is invalid');
  const composeBytes = Buffer.from(state.composeBase64, 'base64');
  if (composeBytes.length === 0 || digest(composeBytes) !== state.configSha256) fail('current state exact Compose bytes do not match config hash');
  return state;
}

function verifyLiveMatches(state) {
  for (const container of ['hb-analytics-collector', 'hb-analytics-worker']) {
    const imageId = command('/usr/bin/docker', ['inspect', container, '--format', '{{.Image}}']);
    if (imageId !== state.imageId) fail('live analytics image differs from durable current state');
  }
}

function installTransactionFiles(root, previous) {
  mkdirSync(join(root, 'candidate'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'prior'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'evidence'), { recursive: true, mode: 0o700 });
  atomicBytes(join(root, 'candidate', 'compose.yml'), readFileSync(TRUSTED_COMPOSE));
  atomicBytes(join(root, 'prior', 'compose.yml'), Buffer.from(previous.composeBase64, 'base64'));
  syncDirectory(root);
}

function verifyTransactionFiles(root, journal) {
  const priorExpected = journal.operation === 'rollback' ? journal.rollbackTarget.configSha256 : journal.previous.configSha256;
  if (digest(readFileSync(join(root, 'prior', 'compose.yml'))) !== priorExpected) fail('durable prior Compose bytes changed after preparation');
  if (journal.operation === 'deploy' && digest(readFileSync(join(root, 'candidate', 'compose.yml'))) !== journal.configSha256) fail('durable candidate Compose bytes changed after preparation');
}

function journalIdentity(invocation, candidate, previous, configSha256) {
  return {
    schemaVersion: 'hb.analytics.transaction.v2', target: invocation.target, operation: invocation.operation,
    sourceSha: invocation.sourceSha, imageDigest: invocation.imageDigest, imageId: candidate.imageId,
    configSha256, ciRunId: invocation.ciRunId, ciRunAttempt: invocation.ciRunAttempt,
    buildRunId: invocation.buildRunId, buildRunAttempt: invocation.buildRunAttempt,
    workflowRef: invocation.workflowRef, runId: invocation.runId, runAttempt: invocation.runAttempt,
    reversedRunId: invocation.operation === 'rollback' ? invocation.reversedRunId : null,
    reversedRunAttempt: invocation.operation === 'rollback' ? invocation.reversedRunAttempt : null,
    previous: { sourceSha: previous.sourceSha, imageId: previous.imageId, digest: previous.digest, configSha256: previous.configSha256, healthContract: previous.healthContract },
  };
}
function durableJournal(path, value) { atomicJson(path, value); failpoint(value.phase); }
function advance(path, expectedPhase, nextPhase, extra = {}) {
  const current = readJson(path);
  const next = compareAndSwapJournal(
    path,
    { phase: expectedPhase, generation: current.generation },
    { ...extra, phase: nextPhase },
  );
  failpoint(next.phase);
  return next;
}

function latestBackup() {
  secureRootAncestors(BACKUP_ROOT);
  const candidates = readdirSync(BACKUP_ROOT).filter((name) => /^hb-analytics-[0-9]{8}T[0-9]{6}Z\.dump\.age$/.test(name));
  const measured = candidates.map((name) => {
    const path = join(BACKUP_ROOT, name); const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return null;
    if (info.uid !== 0 || (info.mode & 0o777) !== 0o600) fail('selected analytics backup owner or mode is unsafe');
    return { name, path, info };
  }).filter(Boolean).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  if (measured.length === 0) fail('current analytics backup is missing');
  const selected = measured[0];
  const sidecar = `${selected.path}.sha256`; const sidecarInfo = lstatSync(sidecar);
  if (!sidecarInfo.isFile() || sidecarInfo.isSymbolicLink() || sidecarInfo.nlink !== 1) fail('backup checksum sidecar is unsafe');
  if (sidecarInfo.uid !== 0 || (sidecarInfo.mode & 0o777) !== 0o600) fail('backup checksum sidecar owner or mode is unsafe');
  const checksum = digest(readFileSync(selected.path));
  const expectedLine = `${checksum.slice(7)}  ${selected.name}\n`;
  if (readFileSync(sidecar, 'utf8') !== expectedLine) fail('backup sidecar does not bind the exact selected bytes');
  const ageSeconds = Math.floor((Date.now() - selected.info.mtimeMs) / 1000);
  if (ageSeconds < 0 || ageSeconds > 28800 || selected.info.size <= 0) fail('selected analytics backup is stale or empty');
  return { path: selected.path, checksumSha256: checksum, bytes: selected.info.size, ageSeconds };
}

function verify_backup_and_restore(invocation, candidate) {
  const backup = latestBackup();
  const output = command(RESTORE, [backup.path, backup.checksumSha256, candidate.ref, invocation.runId, String(invocation.runAttempt)]);
  const restore = JSON.parse(output);
  if (restore.status !== 'passed' || restore.profile !== 'analytics-synthetic-restore' || restore.backupChecksumSha256 !== backup.checksumSha256 || restore.cleanupObserved !== true) fail('isolated restore evidence is incomplete');
  return { backup, restore };
}

function smoke(selected, healthContract) {
  const healthRaw = command('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '10', 'http://127.0.0.1:3300/health']);
  const readyRaw = command('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '10', 'http://127.0.0.1:3300/ready']);
  const health = JSON.parse(healthRaw); const readiness = JSON.parse(readyRaw);
  if (health.status !== 'ok' || readiness.status !== 'ready') fail('analytics health/readiness status failed');
  if (healthContract === 'hb.analytics.provenance.v1') {
    for (const value of [health, readiness]) {
      if (value.provenance?.schemaVersion !== healthContract || value.provenance.verified !== true ||
          value.provenance.sourceRevision !== selected.sourceSha || value.provenance.artifact?.imageId !== selected.imageId ||
          value.provenance.artifact?.digest !== selected.digest || value.provenance.configSha256 !== selected.configSha256) fail('analytics runtime provenance mismatch');
    }
  } else {
    for (const container of ['hb-analytics-collector', 'hb-analytics-worker']) {
      const observed = command('/usr/bin/docker', ['inspect', container, '--format', '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Image}}']);
      if (observed !== `running:healthy|${selected.imageId}`) fail('legacy rollback health/image observation failed');
    }
  }
  return { healthRaw: `${healthRaw}\n`, readyRaw: `${readyRaw}\n` };
}

function monitorObservation() {
  const output = command(MONITOR, []);
  return { status: 'passed', exitCode: 0, outputSha256: digest(`${output}\n`) };
}
function notificationObservation() {
  const state = optionalJson(NOTIFICATION_STATE);
  if (state && !['healthy'].includes(state.phase)) fail('analytics monitor has unresolved durable notification state');
  return { route: 'alertmanager', phase: 'healthy', recipientDelivery: state?.recipientDelivery ?? 'unproven' };
}
function evidenceBody(kind, invocation, observedAt, facts) {
  return `${JSON.stringify({ schemaVersion: 'hb.analytics.delivery-evidence.v1', kind, binding: { target: invocation.target, operation: invocation.operation, runId: invocation.runId, runAttempt: invocation.runAttempt }, observedAt, facts })}\n`;
}
function putEvidence(root, kind, body) {
  const stored = writeContentAddressed(join(root, 'evidence'), body);
  return { sha256: stored.sha256, body };
}

function createReceiptBundle(root, invocation, journal, current, observations, rollback) {
  const observedAt = new Date().toISOString();
  const targetState = invocation.operation === 'rollback' ? current : { sourceSha: invocation.sourceSha, imageId: journal.imageId, digest: invocation.imageDigest, configSha256: journal.configSha256 };
  const healthValue = JSON.parse(observations.smoke.healthRaw); const readyValue = JSON.parse(observations.smoke.readyRaw);
  const facts = {
    health: { status: healthValue.status, sourceSha: targetState.sourceSha, imageId: targetState.imageId, digest: targetState.digest, configSha256: targetState.configSha256, responseSha256: digest(observations.smoke.healthRaw) },
    readiness: { status: readyValue.status, sourceSha: targetState.sourceSha, imageId: targetState.imageId, digest: targetState.digest, configSha256: targetState.configSha256, responseSha256: digest(observations.smoke.readyRaw) },
    backup: { checksumSha256: observations.backup.checksumSha256, bytes: observations.backup.bytes, ageSeconds: observations.backup.ageSeconds },
    'isolated-restore': { status: observations.restore.status, profile: observations.restore.profile, backupChecksumSha256: observations.restore.backupChecksumSha256, observedTables: observations.restore.observedTables, cleanupObserved: observations.restore.cleanupObserved },
    monitor: observations.monitor,
    'notification-state': observations.notification,
  };
  const evidence = Object.entries(facts).map(([kind, value]) => putEvidence(root, kind, evidenceBody(kind, invocation, observedAt, value)));
  const evidenceMap = Object.fromEntries(evidence.map((entry) => [JSON.parse(entry.body).kind, entry.sha256]));
  const receipt = {
    schemaVersion: 'hb.analytics.delivery-recovery-receipt.v2', service: 'analytics', evidenceStatus: 'current', observedAt,
    target: invocation.target, operation: invocation.operation, sourceSha: invocation.sourceSha,
    artifact: { imageId: journal.imageId, digest: invocation.imageDigest, revision: invocation.sourceSha }, configSha256: journal.configSha256,
    deployment: {
      previous: { sourceSha: journal.previous.sourceSha, imageId: journal.previous.imageId, digest: journal.previous.digest, configSha256: journal.previous.configSha256 },
      current,
    },
    provenance: {
      ci: { workflow: 'CI', runId: invocation.ciRunId, runAttempt: invocation.ciRunAttempt },
      build: { workflow: 'Analytics OCI Build', runId: invocation.buildRunId, runAttempt: invocation.buildRunAttempt, subjectDigest: invocation.imageDigest },
      delivery: { workflowRef: invocation.workflowRef, runId: invocation.runId, runAttempt: invocation.runAttempt },
    },
    evidence: evidenceMap, rollback,
    recipientDelivery: observations.notification.recipientDelivery,
  };
  const bundle = { receipt, evidence };
  atomicJson(join(root, 'receipt.json'), receipt); atomicJson(join(root, 'receipt-bundle.json'), bundle);
  return bundle;
}

function commitCurrentState(state) {
  atomicJson(CURRENT_STATE, state);
  failpoint('current-state');
}
function publicState(state) { return { sourceSha: state.sourceSha, imageId: state.imageId, digest: state.digest, configSha256: state.configSha256 }; }

function prepareDeploy(root, invocation, candidate) {
  const previous = readCurrentState(); verifyLiveMatches(previous);
  const configBytes = readFileSync(TRUSTED_COMPOSE); const configSha256 = digest(configBytes);
  installTransactionFiles(root, previous);
  const journal = { ...journalIdentity(invocation, candidate, previous, configSha256), phase: 'prepared', generation: 1 };
  durableJournal(join(root, 'journal.json'), journal);
  return journal;
}

function runDeploy(root, invocation, candidate, initialJournal) {
  const journalPath = join(root, 'journal.json'); let journal = initialJournal;
  let observations = journal.observations ?? null;
  if (journal.phase === 'prepared') {
    observations = verify_backup_and_restore(invocation, candidate);
    journal = advance(journalPath, 'prepared', 'restore-verified', { observations });
  }
  if (journal.phase === 'restore-verified') journal = advance(journalPath, 'restore-verified', 'migration-attempted');
  if (journal.phase === 'migration-attempted') {
    compose_migrate(join(root, 'candidate', 'compose.yml'), { sourceSha: invocation.sourceSha, imageId: candidate.imageId, digest: invocation.imageDigest, configSha256: journal.configSha256 });
    journal = advance(journalPath, 'migration-attempted', 'migrated');
  }
  if (journal.phase === 'migrated') {
    compose_replace(join(root, 'candidate', 'compose.yml'), { sourceSha: invocation.sourceSha, imageId: candidate.imageId, digest: invocation.imageDigest, configSha256: journal.configSha256 });
    journal = advance(journalPath, 'migrated', 'replaced');
  }
  if (journal.phase === 'replaced') {
    const selected = { sourceSha: invocation.sourceSha, imageId: candidate.imageId, digest: invocation.imageDigest, configSha256: journal.configSha256 };
    const finalObservations = { ...journal.observations, smoke: smoke(selected, 'hb.analytics.provenance.v1'), monitor: monitorObservation(), notification: notificationObservation() };
    const currentState = { schemaVersion: 'hb.analytics.current-state.v2', ...selected, composeBase64: readFileSync(join(root, 'candidate', 'compose.yml')).toString('base64'), healthContract: 'hb.analytics.provenance.v1' };
    const current = publicState(currentState);
    const bundle = createReceiptBundle(root, invocation, journal, current, finalObservations, { required: false, performed: false, status: 'not-required', reversedRunId: null, reversedRunAttempt: null });
    commitCurrentState(currentState);
    journal = advance(journalPath, 'replaced', 'committed', { receiptSha256: digest(`${JSON.stringify(bundle.receipt)}\n`) });
  }
  if (journal.phase !== 'committed') fail(`unsupported deploy resume phase ${journal.phase}`);
  return readJson(join(root, 'receipt-bundle.json'));
}

function prepareRollback(root, invocation, candidate) {
  const reversedRoot = transactionPath(invocation.reversedRunId, invocation.reversedRunAttempt);
  const reversed = readJson(join(reversedRoot, 'journal.json'));
  if (reversed.phase !== 'committed' || reversed.operation !== 'deploy' || reversed.sourceSha !== invocation.sourceSha || reversed.imageDigest !== invocation.imageDigest) fail('reversal identity does not name the exact committed deployment');
  const live = readCurrentState();
  if (live.sourceSha !== reversed.sourceSha || live.digest !== reversed.imageDigest || live.configSha256 !== reversed.configSha256) fail('committed deployment is no longer current');
  installTransactionFiles(root, live);
  atomicBytes(join(root, 'prior', 'compose.yml'), readFileSync(join(reversedRoot, 'prior', 'compose.yml')));
  const rollbackTarget = { ...reversed.previous, composeBase64: readFileSync(join(root, 'prior', 'compose.yml')).toString('base64') };
  if (digest(readFileSync(join(root, 'prior', 'compose.yml'))) !== rollbackTarget.configSha256) fail('previousConfigSha256 does not match exact rollback Compose bytes');
  const journal = { ...journalIdentity(invocation, candidate, live, reversed.configSha256), rollbackTarget: {
    sourceSha: rollbackTarget.sourceSha, imageId: rollbackTarget.imageId, digest: rollbackTarget.digest,
    configSha256: rollbackTarget.configSha256, healthContract: rollbackTarget.healthContract,
  }, phase: 'prepared', generation: 1 };
  durableJournal(join(root, 'journal.json'), journal);
  return journal;
}

function runRollback(root, invocation, candidate, initialJournal) {
  const journalPath = join(root, 'journal.json'); let journal = initialJournal;
  if (journal.phase === 'prepared') {
    const observations = verify_backup_and_restore(invocation, candidate);
    journal = advance(journalPath, 'prepared', 'rollback-intent', { observations });
  }
  const selected = { sourceSha: journal.rollbackTarget.sourceSha, imageId: journal.rollbackTarget.imageId, digest: journal.rollbackTarget.digest, configSha256: journal.rollbackTarget.configSha256 };
  if (journal.phase === 'rollback-intent') {
    compose_replace(join(root, 'prior', 'compose.yml'), selected);
    journal = advance(journalPath, 'rollback-intent', 'replaced');
  }
  if (journal.phase === 'replaced') {
    const finalObservations = { ...journal.observations, smoke: smoke(selected, journal.rollbackTarget.healthContract), monitor: monitorObservation(), notification: notificationObservation() };
    const currentState = { schemaVersion: 'hb.analytics.current-state.v2', ...selected, composeBase64: readFileSync(join(root, 'prior', 'compose.yml')).toString('base64'), healthContract: journal.rollbackTarget.healthContract };
    const bundle = createReceiptBundle(root, invocation, journal, publicState(currentState), finalObservations, { required: true, performed: true, status: 'passed', reversedRunId: invocation.reversedRunId, reversedRunAttempt: invocation.reversedRunAttempt });
    commitCurrentState(currentState);
    journal = advance(journalPath, 'replaced', 'committed', { receiptSha256: digest(`${JSON.stringify(bundle.receipt)}\n`) });
  }
  if (journal.phase !== 'committed') fail(`unsupported rollback resume phase ${journal.phase}`);
  return readJson(join(root, 'receipt-bundle.json'));
}

function compensateDeploy(root) {
  const journalPath = join(root, 'journal.json');
  let current = readJson(journalPath);
  if (['migration-attempted', 'migrated', 'replaced'].includes(current.phase)) {
    current = advance(journalPath, current.phase, 'compensation-intent', { failureClass: 'delivery-step-failed' });
  }
  if (current.phase === 'compensation-intent') {
    const previous = {
      sourceSha: current.previous.sourceSha, imageId: current.previous.imageId,
      digest: current.previous.digest, configSha256: current.previous.configSha256,
    };
    compose_replace(join(root, 'prior', 'compose.yml'), previous);
    smoke(previous, current.previous.healthContract);
    commitCurrentState({
      schemaVersion: 'hb.analytics.current-state.v2', ...previous,
      composeBase64: readFileSync(join(root, 'prior', 'compose.yml')).toString('base64'),
      healthContract: current.previous.healthContract,
    });
    advance(journalPath, 'compensation-intent', 'compensated');
  } else if (['prepared', 'restore-verified'].includes(current.phase)) {
    advance(journalPath, current.phase, 'failed-contained', { failureClass: 'pre-mutation-step-failed' });
  }
}

function transaction(invocation) {
  const candidateInspection = inspectImage(invocation.sourceSha, invocation.imageDigest);
  const candidate = { imageId: candidateInspection.imageId, ref: candidateInspection.ref };
  const root = transactionPath(invocation.runId, invocation.runAttempt);
  let journal;
  try {
    journal = readJson(join(root, 'journal.json'));
    const configSha256 = journal.configSha256;
    const previous = journal.previous;
    const expectedIdentity = journalIdentity(invocation, candidate, previous, configSha256);
    if (invocation.operation === 'rollback') expectedIdentity.rollbackTarget = journal.rollbackTarget;
    assertExact(expectedIdentity, Object.fromEntries(Object.entries(journal).filter(([key]) => !['phase', 'generation', 'observations', 'receiptSha256', 'failureClass'].includes(key))), 'transaction replay identity conflict');
    verifyTransactionFiles(root, journal);
    if (journal.phase === 'committed') return readJson(join(root, 'receipt-bundle.json'));
    if (['compensated', 'failed-contained'].includes(journal.phase)) fail('transaction is terminal and did not commit');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existsSync(root)) rmSync(root, { recursive: true });
    mkdirSync(root, { mode: 0o700 }); syncDirectory(TRANSACTIONS);
    journal = invocation.operation === 'deploy' ? prepareDeploy(root, invocation, candidate) : prepareRollback(root, invocation, candidate);
  }
  try {
    return invocation.operation === 'deploy' ? runDeploy(root, invocation, candidate, journal) : runRollback(root, invocation, candidate, journal);
  } catch (error) {
    if (invocation.operation === 'deploy') {
      try { compensateDeploy(root); } catch (compensationError) {
        fail(`deployment and exact-config compensation both failed: ${compensationError instanceof Error ? compensationError.message : 'unknown compensation error'}`);
      }
    }
    throw error;
  }
}

const invocation = parseInvocation(process.argv.slice(2));
if (invocation.verb === 'observe') {
  const candidate = inspectImage(invocation.sourceSha, invocation.imageDigest);
  if (invocation.operation === 'probe') {
    const configSha256 = digest(readFileSync(TRUSTED_COMPOSE));
    process.stdout.write(`${JSON.stringify({ service: 'analytics', target: invocation.target, operation: invocation.operation, sourceSha: invocation.sourceSha, imageId: candidate.imageId, digest: invocation.imageDigest, configSha256 })}\n`);
  } else {
    const state = readCurrentState(); verifyLiveMatches(state);
    process.stdout.write(`${JSON.stringify({ service: 'analytics', target: invocation.target, operation: invocation.operation, current: publicState(state) })}\n`);
  }
} else {
  const bundle = transaction(invocation);
  process.stdout.write(`${JSON.stringify(bundle)}\n`);
}
