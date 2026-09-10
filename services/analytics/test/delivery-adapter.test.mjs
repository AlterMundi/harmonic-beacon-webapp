import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = new URL('../../../', import.meta.url);
const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;
const PREVIOUS_SHA = 'c'.repeat(40);
const PREVIOUS_DIGEST = `sha256:${'d'.repeat(64)}`;

async function repositoryFile(path) {
  return readFile(new URL(path, repo), 'utf8');
}

function drillArgs(stateRoot, extra = []) {
  return [
    new URL('ops/analytics/synthetic-delivery-drill.mjs', repo).pathname,
    '--state-root', stateRoot,
    '--source', SOURCE_SHA,
    '--digest', IMAGE_DIGEST,
    '--previous-source', PREVIOUS_SHA,
    '--previous-digest', PREVIOUS_DIGEST,
    ...extra,
  ];
}

test('analytics delivery workflow is manual, release-bound, CI-bound, and externally gated', async () => {
  const workflow = await repositoryFile('.github/workflows/analytics-delivery.yml');
  const ci = await repositoryFile('.github/workflows/ci.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bpush:/);
  assert.match(workflow, /environment: analytics-production/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, analytics-delivery\]/);
  assert.match(workflow, /refs\/heads\/release/);
  assert.match(workflow, /run\.path.*\.github\/workflows\/ci\.yml/s);
  assert.match(workflow, /head_branch.*release/s);
  assert.match(workflow, /head_sha.*source_sha/s);
  assert.match(workflow, /conclusion.*success/s);
  assert.match(workflow, /GITHUB_WORKFLOW_REF/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /failure\(\)[\s\S]*hb-analytics-delivery[\s\S]*rollback/);
  assert.match(workflow, /\/usr\/local\/sbin\/hb-analytics-delivery/);
  assert.doesNotMatch(workflow, /docker compose|sudo .*\b(?:bash|sh)\b/);
  assert.match(ci, /hb-analytics-delivery-root/);
  assert.match(ci, /compose\.synthetic\.yml/);
  assert.match(ci, /receipt\.schema\.json/);
  assert.match(ci, /analytics-runner\.sudoers/);
});

test('analytics catalog lane and workflow match the real release delivery contract', async () => {
  const catalog = JSON.parse(await repositoryFile('deploy/platform-services.json'));
  const analytics = catalog.services.find(({ id }) => id === 'analytics');
  assert.deepEqual(analytics.lanes, ['release']);
  assert.deepEqual(analytics.workflows, ['.github/workflows/ci.yml', '.github/workflows/analytics-delivery.yml']);
  assert.deepEqual(analytics.health, [
    { name: 'collector health', url: 'https://live.harmonicbeacon.com/_a/health', expectStatus: [200], provenanceField: 'provenance.sourceRevision' },
    { name: 'collector readiness', url: 'https://live.harmonicbeacon.com/_a/ready', expectStatus: [200, 503], provenanceField: 'provenance.sourceRevision' },
  ]);
});

test('root helper and sudoers expose only bounded analytics operations', async () => {
  const helperPath = new URL('ops/analytics/hb-analytics-delivery-root', repo).pathname;
  const helper = await repositoryFile('ops/analytics/hb-analytics-delivery-root');
  const sudoers = await repositoryFile('ops/analytics/analytics-runner.sudoers');
  for (const command of ['probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback']) {
    assert.match(helper, new RegExp(`\\b${command}\\)`));
  }
  assert.match(helper, /flock --exclusive --nonblock/);
  assert.match(helper, /readonly LOCK_FILE="\$STATE_DIR\/delivery\.lock"/);
  assert.match(helper, /org\.opencontainers\.image\.revision/);
  assert.match(helper, /value\.provenance\.configSha256 !== process\.env\.EXPECTED_CONFIG/);
  assert.match(helper, /refs\/remotes\/origin\/release/);
  assert.doesNotMatch(helper, /\[ "\$RUN_ID" = "\$run_id" \]/);
  assert.doesNotMatch(helper, /\beval\b|bash -c|sh -c/);
  assert.match(sudoers, /\/usr\/local\/sbin\/hb-analytics-delivery \*/);
  assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/docker\b|\/(?:ba)?sh\b/);

  const rejected = spawnSync('bash', [helperPath, 'arbitrary-root-command'], { encoding: 'utf8' });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /usage:/);
});

test('analytics monitor renders failure and recovery for the same Alertmanager route without recipient secrets', async () => {
  const notifierPath = new URL('ops/analytics/notify-analytics-monitor.mjs', repo).pathname;
  const service = await repositoryFile('ops/analytics/hb-analytics-monitor.service');
  const failureUnit = await repositoryFile('ops/analytics/hb-analytics-monitor-failure@.service');
  assert.match(service, /OnFailure=hb-analytics-monitor-failure@%n\.service/);
  assert.match(service, /ExecStartPost=.*notify-analytics-monitor\.mjs recovery/);
  assert.match(failureUnit, /notify-analytics-monitor\.mjs failure/);

  const failure = spawnSync('node', [notifierPath, '--render', 'failure'], { encoding: 'utf8' });
  const recovery = spawnSync('node', [notifierPath, '--render', 'recovery'], { encoding: 'utf8' });
  assert.equal(failure.status, 0);
  assert.equal(recovery.status, 0);
  const failedAlert = JSON.parse(failure.stdout)[0];
  const recoveredAlert = JSON.parse(recovery.stdout)[0];
  assert.deepEqual(failedAlert.labels, recoveredAlert.labels);
  assert.equal(failedAlert.labels.service, 'analytics');
  assert.equal(failedAlert.labels.alertname, 'HarmonicBeaconAnalyticsMonitorFailed');
  assert.equal(typeof failedAlert.endsAt, 'undefined');
  assert.match(recoveredAlert.endsAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(`${failure.stdout}${recovery.stdout}`, /telegram|token|password|recipient/i);
});

test('versioned delivery contract supersedes mutable analytics delivery instructions without erasing history', async () => {
  const contract = await repositoryFile('docs/analytics/DELIVERY_RECOVERY_CONTRACT_V1.md');
  const runbook = await repositoryFile('docs/analytics/RUNBOOK.md');
  assert.match(contract, /hb\.analytics\.delivery-recovery-receipt\.v1/);
  assert.match(contract, /historical receipts.*not current evidence/is);
  assert.match(contract, /recipient delivery remains unproven/i);
  assert.match(contract, /must not block.*product/i);
  assert.match(runbook, /DELIVERY_RECOVERY_CONTRACT_V1\.md/);
  assert.match(runbook, /supersedes/i);
});

test('synthetic Compose contract cannot attach production networks, mounts, names, or databases', async () => {
  const compose = await repositoryFile('ops/analytics/compose.synthetic.yml');
  assert.match(compose, /name: harmonic-beacon-analytics-synthetic/);
  assert.match(compose, /POSTGRES_DB: analytics_synthetic/);
  assert.equal((compose.match(/\$\{ANALYTICS_SYNTHETIC_DATABASE_PASSWORD:\?required\}/g) ?? []).length, 3);
  assert.match(compose, /127\.0\.0\.1:0:3300/);
  assert.doesNotMatch(compose, /external:\s*true|\/mnt\/beacon-data|analytics_owner|container_name:/);
});

test('interrupted synthetic delivery restores previous state and removes attempt state', async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'analytics-synthetic-interrupt-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const run = spawnSync('node', drillArgs(stateRoot, ['--interrupt', 'after-activate']), { encoding: 'utf8' });
  assert.equal(run.status, 75);
  const result = JSON.parse(await readFile(join(stateRoot, 'result.json'), 'utf8'));
  assert.deepEqual(result.current, { sourceSha: PREVIOUS_SHA, digest: PREVIOUS_DIGEST });
  assert.deepEqual(result.rollback, { required: true, performed: true, status: 'passed', previousDigest: PREVIOUS_DIGEST });
  assert.equal(result.cleanupComplete, true);
  await assert.rejects(access(join(stateRoot, 'attempt.json')));
  await assert.rejects(access(join(stateRoot, '.delivery.lock')));
});

test('synthetic delivery lock rejects a concurrent attempt', async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'analytics-synthetic-concurrency-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const first = spawn(process.execPath, drillArgs(stateRoot, ['--hold-ms', '500']), { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = spawnSync(process.execPath, drillArgs(stateRoot), { encoding: 'utf8' });
  assert.equal(second.status, 73);
  assert.match(second.stderr, /another synthetic delivery is active/);
  const firstExit = await new Promise((resolve) => first.on('exit', resolve));
  assert.equal(firstExit, 0);
});
