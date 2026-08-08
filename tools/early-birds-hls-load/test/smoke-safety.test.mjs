import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildPlan, selectTarget } from '../src/contracts.mjs';
import {
  EXTERNAL_CANARY_KIND,
  EXTERNAL_CANARY_ROLE,
  MONITOR_THRESHOLDS,
  SMOKE_ORIGIN,
  SMOKE_TARGET_ID,
  TARGET_MONITOR_KIND,
  TARGET_MONITOR_ROLE,
  assertExternalHost,
  readJsonStatus,
  readPrivateFile,
  validateFreshSignedManifest,
  validateNetworkSmokePreconditions,
} from '../src/smoke-safety.mjs';

const toolRoot = new URL('../', import.meta.url);
const policy = JSON.parse(await readFile(new URL('policies/listener-staging-smoke-10.json', toolRoot)));
const profiles = JSON.parse(await readFile(new URL('profiles.json', toolRoot)));
const TEST_HOST_HASH = '0123456789ab';

function fixture(nowMs = Date.now()) {
  const target = selectTarget(policy, SMOKE_TARGET_ID);
  const plan = buildPlan({
    runId: 'smoke-safety-test',
    profileName: 'staging-smoke',
    profile: profiles.profiles['staging-smoke'],
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(nowMs + 20_000).toISOString(),
    networkRun: true,
    nowMs,
  });
  const common = {
    schemaVersion: 1,
    status: 'PASS',
    external: true,
    targetId: SMOKE_TARGET_ID,
    targetOrigin: SMOKE_ORIGIN,
    hostHash: TEST_HOST_HASH,
    observedAt: new Date(nowMs).toISOString(),
  };
  return {
    plan,
    target,
    manifest: {
      value: `${SMOKE_ORIGIN}/v1/hls/approved-v2/live.m3u8?exp=${Math.floor((nowMs + 120_000) / 1000)}&sig=${'a'.repeat(43)}`,
      writtenAtMs: nowMs,
    },
    canaryStatus: {
      ...common,
      kind: EXTERNAL_CANARY_KIND,
      role: EXTERNAL_CANARY_ROLE,
      decodedAudio: true,
      decodedSeconds: 6,
      manifestAgeSeconds: 1,
    },
    monitorStatus: {
      ...common,
      kind: TARGET_MONITOR_KIND,
      role: TARGET_MONITOR_ROLE,
      listenerReady: true,
      streamHealthy: true,
      liveReady: true,
      originUp: true,
      canaryOk: true,
      prometheusFiringAlerts: 0,
      alertmanagerReady: true,
      activeAlerts: 0,
      cpuUsedRatio: 0.2,
      memoryUsedRatio: 0.4,
      rootFreeRatio: 0.6,
      egressBitsPerSecond: 500_000_000,
      tcpRetransmitRatio: 0.001,
      interfaceErrorsDrops: 0,
      restartBaselineEstablished: true,
      containerRestartsObserved: 0,
      oomEventsDelta: 0,
      thresholds: { ...MONITOR_THRESHOLDS },
    },
    nowMs,
    expectedHostHash: TEST_HOST_HASH,
  };
}

test('dedicated policy can authorize exactly ten clients and no more', () => {
  const target = selectTarget(policy, SMOKE_TARGET_ID);
  assert.deepEqual(target.origins, [SMOKE_ORIGIN]);
  assert.equal(target.limits.maxClients, 10);
  assert.equal(target.limits.maxShardCount, 1);
  assert.equal(target.limits.maxSoakSeconds, 60);
  assert.equal(target.limits.maxRequestsPerSecond, 28);
  assert.throws(() => buildPlan({
    runId: 'smoke-eleven-refused',
    profileName: 'unsafe-smoke',
    profile: { ...profiles.profiles['staging-smoke'], clients: 11 },
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }), /clients exceed the target policy/);
});

test('fresh signed manifest is exact-origin, canonical, recently written and long-lived enough', () => {
  const values = fixture();
  assert.doesNotThrow(() => validateNetworkSmokePreconditions(values));
  assert.throws(() => validateFreshSignedManifest({
    ...values.manifest,
    value: values.manifest.value.replace(SMOKE_ORIGIN, 'https://attacker.example'),
    allowedOrigins: values.target.origins,
    nowMs: values.nowMs,
    requiredThroughMs: Date.parse(values.plan.endAt) + 10_000,
  }), /escaped the exact target allowlist/);
  assert.throws(() => validateFreshSignedManifest({
    ...values.manifest,
    value: `${SMOKE_ORIGIN}/v1/hls/approved-v2/live.m3u8?exp=${Math.floor((values.nowMs - 1) / 1000)}&sig=${'a'.repeat(43)}`,
    allowedOrigins: values.target.origins,
    nowMs: values.nowMs,
    requiredThroughMs: Date.parse(values.plan.endAt) + 10_000,
  }), /expired/);
  assert.throws(() => validateFreshSignedManifest({
    ...values.manifest,
    writtenAtMs: values.nowMs - 31_000,
    allowedOrigins: values.target.origins,
    nowMs: values.nowMs,
    requiredThroughMs: Date.parse(values.plan.endAt) + 10_000,
  }), /not refreshed/);
});

test('network smoke cannot start or continue without fresh external canary and monitor', () => {
  const values = fixture();
  assert.throws(() => validateNetworkSmokePreconditions({ ...values, canaryStatus: undefined }),
    /external decoded canary status is required/);
  assert.throws(() => validateNetworkSmokePreconditions({ ...values, monitorStatus: undefined }),
    /target monitor status is required/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    canaryStatus: { ...values.canaryStatus, observedAt: new Date(values.nowMs - 46_000).toISOString() },
  }), /canary status is stale/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, activeAlerts: 1 },
  }), /active alerts/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, liveReady: false },
  }), /failed health check/);
});

test('safety producers refuse execution on mona', () => {
  assert.throws(() => assertExternalHost('mona'), /forbidden from mona/);
  assert.throws(() => assertExternalHost('mona-01.example'), /forbidden from mona/);
  assert.match(assertExternalHost('daimonmatrix'), /^[a-f0-9]{12}$/);
});

test('dedicated CLI refuses a network run before spawning load when safety files are absent', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'listener-smoke-refusal-'));
  const startAt = new Date(Date.now() + 20_000).toISOString();
  const child = spawn(process.execPath, [
    new URL('../run-staging-smoke.mjs', import.meta.url).pathname,
    '--run-id', 'missing-safety-files',
    '--start-at', startAt,
    '--evidence', path.join(temporaryRoot, 'must-not-exist.json'),
    '--clock-offset-ms', '1',
    '--confirm', 'not-reached',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 1);
  assert.match(output, /requires signed manifest, external canary, target monitor/);
  await assert.rejects(readFile(path.join(temporaryRoot, 'must-not-exist.json')), /ENOENT/);
});

test('wrapper rejects Alertmanager failures, firing alerts and threshold-breaching telemetry', () => {
  const values = fixture();
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, alertmanagerReady: false },
  }), /Alertmanager is not ready/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, activeAlerts: 1 },
  }), /active alerts/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, prometheusFiringAlerts: 1 },
  }), /active alerts/);
  for (const [field, value, pattern] of [
    ['cpuUsedRatio', MONITOR_THRESHOLDS.maxCpuUsedRatio, /CPU used ratio/],
    ['memoryUsedRatio', MONITOR_THRESHOLDS.maxMemoryUsedRatio, /memory used ratio/],
    ['rootFreeRatio', MONITOR_THRESHOLDS.minRootFreeRatio, /root free ratio/],
    ['egressBitsPerSecond', MONITOR_THRESHOLDS.maxEgressBitsPerSecond, /egress/],
    ['tcpRetransmitRatio', MONITOR_THRESHOLDS.maxTcpRetransmitRatio, /retransmit/],
    ['interfaceErrorsDrops', 1, /interface errors or drops/],
    ['cpuUsedRatio', Number.NaN, /finite number/],
    ['egressBitsPerSecond', Number.POSITIVE_INFINITY, /finite number/],
  ]) {
    assert.throws(() => validateNetworkSmokePreconditions({
      ...values,
      monitorStatus: { ...values.monitorStatus, [field]: value },
    }), pattern, `${field}=${value} must be rejected`);
  }
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: {
      ...values.monitorStatus,
      thresholds: { ...MONITOR_THRESHOLDS, maxCpuUsedRatio: 0.9 },
    },
  }), /thresholds differ/);
});

test('wrapper rejects a monitor without a verified restart/OOM baseline or with observed restarts', () => {
  const values = fixture();
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, restartBaselineEstablished: false },
  }), /has not established a restart\/OOM baseline/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, containerRestartsObserved: 1 },
  }), /restart or OOM event/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, oomEventsDelta: 2 },
  }), /restart or OOM event/);
});

test('status roles, target identity and co-located host fingerprints are enforced', () => {
  const values = fixture();
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    canaryStatus: { ...values.canaryStatus, role: TARGET_MONITOR_ROLE },
  }), /canary status role is invalid/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, targetOrigin: 'https://live.harmonicbeacon.com' },
  }), /target does not match/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    canaryStatus: { ...values.canaryStatus, hostHash: 'ffffffffffff' },
  }), /must run on this external host/);
  assert.throws(() => validateNetworkSmokePreconditions({
    ...values,
    monitorStatus: { ...values.monitorStatus, hostHash: 'ffffffffffff' },
  }), /must run on this external host/);
});

test('private inputs require a regular file with exact mode 0600 and bounded size', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'listener-smoke-input-'));
  const accepted = path.join(root, 'accepted.json');
  await writeFile(accepted, '{"ok":true}\n', { mode: 0o600 });
  const { text } = await readPrivateFile(accepted, 'test input');
  assert.equal(text, '{"ok":true}\n');

  for (const mode of [0o640, 0o644, 0o400, 0o700]) {
    const candidate = path.join(root, `mode-${mode.toString(8)}.json`);
    await writeFile(candidate, '{}\n', { mode: 0o600 });
    await chmod(candidate, mode);
    await assert.rejects(readPrivateFile(candidate, 'test input'), /exactly 0600/);
  }

  const linked = path.join(root, 'linked.json');
  await symlink(accepted, linked);
  await assert.rejects(readPrivateFile(linked, 'test input'), /regular file/);

  const directory = path.join(root, 'directory');
  await mkdir(directory, { mode: 0o700 });
  await assert.rejects(readPrivateFile(directory, 'test input'), /regular file/);

  const oversized = path.join(root, 'oversized.json');
  await writeFile(oversized, `${'x'.repeat(20_000)}\n`, { mode: 0o600 });
  await assert.rejects(readPrivateFile(oversized, 'test input'), /byte bound/);
  await assert.rejects(readJsonStatus(oversized, 'test status'), /byte bound/);
  await assert.rejects(
    readPrivateFile(oversized, 'signed manifest', 4_096),
    /byte bound/,
  );
});
