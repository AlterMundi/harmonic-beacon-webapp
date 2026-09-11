import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = new URL('../../../', import.meta.url);
const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;
const PREVIOUS_SHA = 'c'.repeat(40);
const PREVIOUS_DIGEST = `sha256:${'d'.repeat(64)}`;

const repositoryFile = (path) => readFile(new URL(path, repo), 'utf8');

function drillArgs(stateRoot, overrides = {}) {
  return [
    new URL('ops/analytics/synthetic-delivery-drill.mjs', repo).pathname,
    '--state-root', stateRoot,
    '--source', overrides.source ?? SOURCE_SHA,
    '--digest', IMAGE_DIGEST,
    '--image-id', `sha256:${'1'.repeat(64)}`,
    '--config', `sha256:${'2'.repeat(64)}`,
    '--previous-source', PREVIOUS_SHA,
    '--previous-digest', PREVIOUS_DIGEST,
    '--previous-image-id', `sha256:${'3'.repeat(64)}`,
    '--previous-config', `sha256:${'4'.repeat(64)}`,
  ];
}

test('analytics delivery is manual, release-bound, attempt-bound, and externally gated', async () => {
  const workflow = await repositoryFile('.github/workflows/analytics-delivery.yml');
  const ci = await repositoryFile('.github/workflows/ci.yml');
  const build = await repositoryFile('.github/workflows/analytics-build.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /environment: analytics-production/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, analytics-delivery\]/);
  assert.match(workflow, /refs\/heads\/release/);
  assert.match(workflow, /ci\.path !== '\.github\/workflows\/ci\.yml'/);
  assert.match(workflow, /build\.path !== '\.github\/workflows\/analytics-build\.yml'/);
  assert.match(workflow, /run_attempt/);
  assert.match(workflow, /GITHUB_WORKFLOW_REF/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /gh attestation verify/);
  assert.match(workflow, /\/usr\/local\/sbin\/hb-analytics-delivery/);
  assert.doesNotMatch(workflow, /docker compose|sudo .*\b(?:bash|sh)\b/);
  assert.match(ci, /push:\s*\n\s+branches: \[release\]/);
  assert.match(build, /workflow_run:/);
  assert.match(build, /attest-build-provenance@[0-9a-f]{40}/);
  assert.match(build, /cosign sign-blob/);
  assert.match(ci, /hb-analytics-delivery-root/);
  assert.match(ci, /compose\.synthetic\.yml/);
  assert.match(ci, /receipt\.schema\.json/);
  assert.match(ci, /analytics-runner\.sudoers/);
});

test('analytics catalog names the CI build and delivery workflow chain', async () => {
  const catalog = JSON.parse(await repositoryFile('deploy/platform-services.json'));
  const analytics = catalog.services.find(({ id }) => id === 'analytics');
  assert.deepEqual(analytics.lanes, ['release']);
  assert.deepEqual(analytics.workflows, [
    '.github/workflows/ci.yml',
    '.github/workflows/analytics-build.yml',
    '.github/workflows/analytics-delivery.yml',
  ]);
  assert.ok(analytics.localPaths.includes('contracts/analytics-delivery/v2/receipt.schema.json'));
  assert.deepEqual(analytics.health, [
    { name: 'collector health', url: 'https://live.harmonicbeacon.com/_a/health', expectStatus: [200], provenanceField: 'provenance.sourceRevision' },
    { name: 'collector readiness', url: 'https://live.harmonicbeacon.com/_a/ready', expectStatus: [200, 503], provenanceField: 'provenance.sourceRevision' },
  ]);
});

test('root helper and sudoers expose only one immutable locked state-machine boundary', async () => {
  const helperPath = new URL('ops/analytics/hb-analytics-delivery-root', repo).pathname;
  const helper = await repositoryFile('ops/analytics/hb-analytics-delivery-root');
  const machine = await repositoryFile('ops/analytics/analytics-delivery-state.mjs');
  const durableState = await repositoryFile('ops/analytics/durable-json-state.mjs');
  const sudoers = await repositoryFile('ops/analytics/analytics-runner.sudoers');
  assert.match(helper, /\{observe\|transaction\}/);
  assert.match(helper, /flock -x/);
  assert.match(helper, /readonly LOCK_FILE="\$STATE_DIR\/delivery\.lock"/);
  assert.match(helper, /analytics-delivery-bundle\.sha256/);
  assert.match(helper, /sha256sum --check --strict --status/);
  assert.doesNotMatch(helper, /\bgit\b|GITHUB_WORKSPACE|\/opt\/actions-runner|docker compose/);
  assert.match(machine, /org\.opencontainers\.image\.revision/);
  assert.match(durableState, /journal CAS phase conflict/);
  assert.match(machine, /transaction replay identity conflict/);
  assert.match(machine, /compensation-intent/);
  assert.doesNotMatch(helper, /\beval\b|bash -c|sh -c/);
  assert.match(sudoers, /\/usr\/local\/sbin\/hb-analytics-delivery \*/);
  assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/docker\b|\/(?:ba)?sh\b/);

  const rejected = spawnSync('/bin/bash', [helperPath, 'arbitrary-root-command'], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /usage:|root execution required/);
});

test('analytics monitor preserves one durable failure identity through recovery', async () => {
  const notifierPath = new URL('ops/analytics/notify-analytics-monitor.mjs', repo).pathname;
  const notifier = await repositoryFile('ops/analytics/notify-analytics-monitor.mjs');
  const service = await repositoryFile('ops/analytics/hb-analytics-monitor.service');
  const failureUnit = await repositoryFile('ops/analytics/hb-analytics-monitor-failure@.service');
  assert.match(service, /OnFailure=hb-analytics-monitor-failure@%n\.service/);
  assert.match(service, /StateDirectory=harmonic-beacon\/analytics-monitor-notification/);
  assert.match(service, /ExecStartPost=.*notify-analytics-monitor\.mjs recovery/);
  assert.match(failureUnit, /notify-analytics-monitor\.mjs failure/);
  assert.match(notifier, /failure-pending/);
  assert.match(notifier, /recovery-pending/);
  assert.match(notifier, /atomicState/);

  const failure = spawnSync(process.execPath, [notifierPath, '--render', 'failure'], { encoding: 'utf8' });
  const recovery = spawnSync(process.execPath, [notifierPath, '--render', 'recovery'], { encoding: 'utf8' });
  assert.equal(failure.status, 0);
  assert.equal(recovery.status, 0);
  const failedAlert = JSON.parse(failure.stdout)[0];
  const recoveredAlert = JSON.parse(recovery.stdout)[0];
  assert.deepEqual(failedAlert.labels, recoveredAlert.labels);
  assert.equal(failedAlert.labels.service, 'analytics');
  assert.equal(typeof failedAlert.endsAt, 'undefined');
  assert.match(recoveredAlert.endsAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(`${failure.stdout}${recovery.stdout}`, /telegram|token|password|recipient/i);
});

test('versioned delivery contract supersedes mutable instructions without erasing history', async () => {
  const contract = await repositoryFile('docs/analytics/DELIVERY_RECOVERY_CONTRACT_V2.md');
  const runbook = await repositoryFile('docs/analytics/RUNBOOK.md');
  assert.match(contract, /hb\.analytics\.delivery-recovery-receipt\.v2/);
  assert.match(contract, /historical receipts.*not current evidence/is);
  assert.match(contract, /recipient delivery remains unproven/i);
  assert.match(contract, /must not block.*product/i);
  assert.match(runbook, /DELIVERY_RECOVERY_CONTRACT_V2\.md/);
  assert.match(runbook, /supersedes/i);
});

test('synthetic Compose contract cannot attach production networks mounts names or databases', async () => {
  const compose = await repositoryFile('ops/analytics/compose.synthetic.yml');
  assert.match(compose, /name: harmonic-beacon-analytics-synthetic/);
  assert.match(compose, /POSTGRES_DB: analytics_synthetic/);
  assert.ok((compose.match(/\$\{ANALYTICS_SYNTHETIC_DATABASE_PASSWORD:\?required\}/g) ?? []).length >= 3);
  assert.match(compose, /127\.0\.0\.1:0:3300/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose, /external:\s*true|\/mnt\/beacon-data|analytics_owner|container_name:/);
});

test('external SIGKILL drill durably resumes exact prior state and rejects substituted replay', async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'analytics-synthetic-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const env = { ...process.env, HB_ANALYTICS_DRILL_DRIVER: 'file' };
  const first = spawnSync(process.execPath, drillArgs(stateRoot), { encoding: 'utf8', env, timeout: 10000 });
  assert.equal(first.status, 0, first.stderr);
  const result = JSON.parse(await readFile(join(stateRoot, 'result.json'), 'utf8'));
  assert.equal(result.interruption.signal, 'SIGKILL');
  assert.equal(result.current.sourceSha, PREVIOUS_SHA);
  assert.equal(result.current.digest, PREVIOUS_DIGEST);
  assert.deepEqual(result.rollback, { required: true, performed: true, status: 'passed', previousDigest: PREVIOUS_DIGEST });
  assert.equal(result.cleanupObserved, true);
  const journal = JSON.parse(await readFile(join(stateRoot, 'attempt.json'), 'utf8'));
  assert.equal(journal.phase, 'committed');

  const conflict = spawnSync(process.execPath, drillArgs(stateRoot, { source: 'e'.repeat(40) }), { encoding: 'utf8', env, timeout: 10000 });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /identity conflict/);
  const unchanged = JSON.parse(await readFile(join(stateRoot, 'current.json'), 'utf8'));
  assert.equal(unchanged.sourceSha, PREVIOUS_SHA);
});
