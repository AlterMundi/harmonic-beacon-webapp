import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { ReceiptError, validateReceiptBundle } from '../src/delivery-receipt.mjs';

const repo = new URL('../../../', import.meta.url);
const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const IMAGE_DIGEST = `sha256:${'c'.repeat(64)}`;
const CONFIG_SHA = `sha256:${'d'.repeat(64)}`;
const BACKUP_SHA = `sha256:${'e'.repeat(64)}`;
const AT = '2026-09-11T06:00:00.000Z';

const repositoryFile = (path) => readFile(new URL(path, repo), 'utf8');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function runBlocks(workflow) {
  return [...workflow.matchAll(/^\s+run:\s*\|\s*\n((?:\s{10}.+(?:\n|$))*)/gmu)].map((match) => match[1]);
}

function runNode(argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function evidence(kind, facts) {
  const body = `${JSON.stringify({
    schemaVersion: 'hb.analytics.delivery-evidence.v1', kind,
    binding: { target: 'analytics-production', operation: 'deploy', runId: '400', runAttempt: 2 },
    observedAt: AT, facts,
  })}\n`;
  return { sha256: sha256(body), body };
}

function validBundle() {
  const health = evidence('health', {
    status: 'ok', sourceSha: SOURCE_SHA, imageId: IMAGE_ID, digest: IMAGE_DIGEST, configSha256: CONFIG_SHA,
    responseSha256: `sha256:${'5'.repeat(64)}`,
  });
  const readiness = evidence('readiness', {
    status: 'ready', sourceSha: SOURCE_SHA, imageId: IMAGE_ID, digest: IMAGE_DIGEST, configSha256: CONFIG_SHA,
    responseSha256: `sha256:${'6'.repeat(64)}`,
  });
  const backup = evidence('backup', { checksumSha256: BACKUP_SHA, bytes: 4096, ageSeconds: 60 });
  const restore = evidence('isolated-restore', {
    status: 'passed', profile: 'analytics-synthetic-restore', backupChecksumSha256: BACKUP_SHA,
    observedTables: 12, cleanupObserved: true,
  });
  const monitor = evidence('monitor', { status: 'passed', exitCode: 0, outputSha256: `sha256:${'4'.repeat(64)}` });
  const notification = evidence('notification-state', { route: 'alertmanager', phase: 'healthy', recipientDelivery: 'unproven' });
  const objects = [health, readiness, backup, restore, monitor, notification];
  return {
    receipt: {
      schemaVersion: 'hb.analytics.delivery-recovery-receipt.v2', service: 'analytics', evidenceStatus: 'current',
      observedAt: AT, target: 'analytics-production', operation: 'deploy', sourceSha: SOURCE_SHA,
      artifact: { imageId: IMAGE_ID, digest: IMAGE_DIGEST, revision: SOURCE_SHA }, configSha256: CONFIG_SHA,
      deployment: {
        previous: { sourceSha: 'f'.repeat(40), imageId: `sha256:${'1'.repeat(64)}`, digest: `sha256:${'2'.repeat(64)}`, configSha256: `sha256:${'3'.repeat(64)}` },
        current: { sourceSha: SOURCE_SHA, imageId: IMAGE_ID, digest: IMAGE_DIGEST, configSha256: CONFIG_SHA },
      },
      provenance: {
        ci: { workflow: 'CI', runId: '100', runAttempt: 3 },
        build: { workflow: 'Analytics OCI Build', runId: '200', runAttempt: 4, subjectDigest: IMAGE_DIGEST },
        delivery: { workflowRef: 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release', runId: '400', runAttempt: 2 },
      },
      evidence: Object.fromEntries(objects.map((object) => [JSON.parse(object.body).kind, object.sha256])),
      rollback: { required: false, performed: false, status: 'not-required', reversedRunId: null, reversedRunAttempt: null },
      recipientDelivery: 'unproven',
    },
    evidence: objects,
  };
}

const expected = {
  sourceSha: SOURCE_SHA, artifactImageId: IMAGE_ID, artifactDigest: IMAGE_DIGEST, configSha256: CONFIG_SHA,
  target: 'analytics-production', operation: 'deploy', ciRunId: '100', ciRunAttempt: 3,
  buildRunId: '200', buildRunAttempt: 4, runId: '400', runAttempt: 2,
  now: '2026-09-11T06:05:00.000Z', maxEvidenceAgeSeconds: 1800,
};

test('workflow dispatch values are environment-only shell data and quote-breakout corpus is inert', async () => {
  const workflow = await repositoryFile('.github/workflows/analytics-delivery.yml');
  for (const block of runBlocks(workflow)) assert.doesNotMatch(block, /\$\{\{\s*inputs\./u);
  for (const input of ['operation', 'target', 'source_sha', 'image_digest', 'ci_run_id', 'ci_run_attempt', 'build_run_id', 'build_run_attempt']) {
    assert.match(workflow, new RegExp(`\\b${input}:`));
  }
  assert.match(workflow, /IMAGE_DIGEST: \$\{\{ inputs\.image_digest \}\}/u);
  assert.match(workflow, /\[\[ "\$IMAGE_DIGEST" =~ \^sha256:/u);
  assert.match(workflow, /packages:\s*read/u);
  assert.match(workflow, /gh attestation verify/u);
  for (const hostile of [
    `sha256:$(printf injected)${'a'.repeat(64)}`,
    `sha256:\"; printf injected; #${'a'.repeat(64)}`,
    `sha256:\`printf injected\`${'a'.repeat(64)}`,
  ]) assert.equal(/^sha256:[0-9a-f]{64}$/.test(hostile), false);
});

test('release CI and build provenance form an attempt-specific exact-digest chain', async () => {
  const ci = await repositoryFile('.github/workflows/ci.yml');
  const build = await repositoryFile('.github/workflows/analytics-build.yml');
  const delivery = await repositoryFile('.github/workflows/analytics-delivery.yml');
  assert.match(ci, /push:\s*\n\s+branches:\s*\[release\]/u);
  assert.match(build, /workflow_run:/u);
  assert.match(build, /workflows:\s*\[CI\]/u);
  assert.match(build, /branches:\s*\[release\]/u);
  assert.match(build, /context: services\/analytics\s*\n\s+file: Dockerfile/u);
  assert.match(build, /docker\/build-push-action@[0-9a-f]{40}/u);
  assert.match(build, /push:\s*true/u);
  assert.match(build, /attest-build-provenance@[0-9a-f]{40}/u);
  assert.match(build, /subject-digest:/u);
  assert.match(build, /certificate-identity=https:\/\/github\.com\/AlterMundi\/harmonic-beacon-webapp\/\.github\/workflows\/analytics-build\.yml@refs\/heads\/main/u);
  assert.match(delivery, /actions\/runs\/\$\{CI_RUN_ID\}\/attempts\/\$\{CI_RUN_ATTEMPT\}/u);
  assert.match(delivery, /actions\/runs\/\$\{BUILD_RUN_ID\}\/attempts\/\$\{BUILD_RUN_ATTEMPT\}/u);
  assert.match(delivery, /--signer-workflow github\.com\/AlterMundi\/harmonic-beacon-webapp\/\.github\/workflows\/analytics-build\.yml/u);
  assert.match(delivery, /--cert-identity https:\/\/github\.com\/AlterMundi\/harmonic-beacon-webapp\/\.github\/workflows\/analytics-build\.yml@refs\/heads\/main/u);
  assert.match(delivery, /Analytics OCI Build/u);
});

test('privileged adapter executes only an installed immutable bundle and one locked transaction', async () => {
  const helper = await repositoryFile('ops/analytics/hb-analytics-delivery-root');
  const stateMachine = await repositoryFile('ops/analytics/analytics-delivery-state.mjs');
  const durableState = await repositoryFile('ops/analytics/durable-json-state.mjs');
  const sudoers = await repositoryFile('ops/analytics/analytics-runner.sudoers');
  const service = await repositoryFile('ops/analytics/hb-analytics-monitor.service');
  const failureService = await repositoryFile('ops/analytics/hb-analytics-monitor-failure@.service');
  assert.match(helper, /^#!\/bin\/bash\n/u);
  assert.doesNotMatch(helper, /\bgit\b|GITHUB_WORKSPACE|\/opt\/actions-runner/u);
  assert.match(helper, /analytics-delivery-bundle\.sha256/u);
  assert.match(helper, /sha256sum --check --strict/u);
  assert.match(helper, /verify_(?:file|directory)/u);
  assert.match(helper, /unsafe trusted ancestor/u);
  assert.match(stateMachine, /TRUSTED_COMPOSE/u);
  assert.match(helper, /flock -x/u);
  const deliveryWorkflow = await repositoryFile('.github/workflows/analytics-delivery.yml');
  assert.match(deliveryWorkflow, /for helper_attempt in 1 2/u);
  assert.match(stateMachine, /runDeploy/u);
  assert.match(durableState, /journal CAS phase conflict/u);
  assert.match(stateMachine, /if \(existsSync\(root\)\) rmSync\(root, \{ recursive: true \}\)/u);
  assert.match(stateMachine, /atomicBytes/u);
  assert.doesNotMatch(sudoers, /\b(?:preflight|deploy|smoke)\b/u);
  assert.match(service, /\/usr\/local\/libexec\/harmonic-beacon\/analytics\/monitor-analytics\.sh/u);
  assert.match(failureService, /\/usr\/local\/libexec\/harmonic-beacon\/analytics\/notify-analytics-monitor\.mjs/u);
});

test('receipt validation hashes measured evidence and binds target operation plus all run attempts', async () => {
  const bundle = validBundle();
  assert.deepEqual(await validateReceiptBundle(bundle, expected), bundle.receipt);
  const historical = structuredClone(bundle);
  historical.receipt.evidenceStatus = 'historical';
  await assert.rejects(validateReceiptBundle(historical, expected), /current evidence/u);
  const tampered = structuredClone(bundle);
  tampered.evidence[0].body = tampered.evidence[0].body.replace('"ok"', '"failed"');
  await assert.rejects(validateReceiptBundle(tampered, expected), /evidence digest/u);
  const wrongAttempt = structuredClone(bundle);
  wrongAttempt.receipt.provenance.build.runAttempt = 5;
  await assert.rejects(validateReceiptBundle(wrongAttempt, expected), /build run attempt/u);
  const selfAttested = structuredClone(bundle);
  selfAttested.receipt.health = { provenanceVerified: true };
  await assert.rejects(validateReceiptBundle(selfAttested, expected), ReceiptError);
});

test('rollback state captures exact previous config and the current reversal identity', async () => {
  const stateMachine = await repositoryFile('ops/analytics/analytics-delivery-state.mjs');
  assert.match(stateMachine, /composeBase64/u);
  assert.match(stateMachine, /previousConfigSha256/u);
  assert.match(stateMachine, /prior', 'compose\.yml/u);
  assert.match(stateMachine, /'postgres', 'collector', 'worker'/u);
  assert.match(stateMachine, /reversedRunId/u);
  assert.match(stateMachine, /reversedRunAttempt/u);
  assert.match(stateMachine, /function prepareDeploy[\s\S]+readCurrentState\(\); verifyLiveMatches\(previous\);[\s\S]+installTransactionFiles\(root, previous\)/u);
});

test('migration is gated by exact-byte backup verification and isolated restore observations', async () => {
  const stateMachine = await repositoryFile('ops/analytics/analytics-delivery-state.mjs');
  const restore = await repositoryFile('ops/analytics/restore-verify-analytics.sh');
  const restoreIndex = stateMachine.indexOf('verify_backup_and_restore(invocation, candidate)');
  const migrateIndex = stateMachine.indexOf("if (journal.phase === 'migration-attempted')");
  assert.ok(restoreIndex >= 0 && migrateIndex > restoreIndex);
  assert.match(stateMachine, /backup sidecar does not bind the exact selected bytes/u);
  assert.match(stateMachine, /secureRootAncestors\(BACKUP_ROOT\)/u);
  assert.match(stateMachine, /selected analytics backup owner or mode is unsafe/u);
  assert.match(stateMachine, /backup checksum sidecar owner or mode is unsafe/u);
  assert.match(restore, /analytics-synthetic-restore/u);
  assert.match(restore, /docker compose/u);
  assert.match(restore, /--wait --wait-timeout 60/u);
  assert.match(restore, /down --volumes/u);
  assert.doesNotMatch(restore, /docker exec hb-analytics-postgres/u);
});

test('synthetic drill uses a real isolated Compose target and external SIGKILL recovery', async () => {
  const drill = await repositoryFile('ops/analytics/synthetic-delivery-drill.mjs');
  const compose = await repositoryFile('ops/analytics/compose.synthetic.yml');
  assert.match(drill, /SIGKILL/u);
  assert.match(drill, /--worker/u);
  assert.match(drill, /docker[^\n]+compose/u);
  assert.match(drill, /\/usr\/local\/libexec\/harmonic-beacon\/analytics\/compose\.synthetic\.yml/u);
  assert.match(drill, /for \(let attempt = 0; attempt < 60/u);
  assert.match(drill, /resume/u);
  assert.match(drill, /cleanupObserved/u);
  assert.match(compose, /analytics_synthetic/u);
  assert.doesNotMatch(compose, /external:\s*true|\/mnt\/beacon-data|container_name:|analytics_owner/u);
});

test('notification crash after accepted failure is durably reconciled before matching recovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'analytics-notify-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const received = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push(JSON.parse(body)[0]);
    response.writeHead(202).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const notifier = new URL('ops/analytics/notify-analytics-monitor.mjs', repo).pathname;
  const env = {
    ...process.env,
    HB_ANALYTICS_NOTIFY_STATE_DIR: root,
    HB_ANALYTICS_ALERTMANAGER_URL: `http://127.0.0.1:${port}/api/v2/alerts`,
    HB_ANALYTICS_NOTIFY_FAILPOINT: 'after-post',
  };
  const interrupted = await runNode([notifier, 'failure'], { env });
  assert.notEqual(interrupted.status, 0);
  const pending = JSON.parse(await readFile(join(root, 'notification.json'), 'utf8'));
  assert.equal(pending.phase, 'failure-pending');
  const recovered = await runNode([notifier, 'recovery'], { env: { ...env, HB_ANALYTICS_NOTIFY_FAILPOINT: '' } });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(received.length, 3);
  assert.deepEqual(received.map((alert) => Boolean(alert.endsAt)), [false, false, true]);
  assert.deepEqual(received[0].labels, received[2].labels);
  assert.equal(received[0].startsAt, received[2].startsAt);
  const healthy = JSON.parse(await readFile(join(root, 'notification.json'), 'utf8'));
  assert.equal(healthy.phase, 'healthy');
  assert.equal((await stat(join(root, 'notification.json'))).mode & 0o777, 0o600);
});
