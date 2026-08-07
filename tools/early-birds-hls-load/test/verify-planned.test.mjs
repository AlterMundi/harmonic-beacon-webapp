import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { buildPlan, selectTarget } from '../src/contracts.mjs';
import { plannedEvidence } from '../src/runner.mjs';

const profile = {
  clients: 2,
  rampPerSecond: 2,
  soakSeconds: 1,
  manifestIntervalMs: 100,
  requestTimeoutMs: 100,
  startupSegments: 1,
  maxSegmentsPerPoll: 2,
  maxInflightPerShard: 4,
  minShards: 1,
  maxErrorRate: 0,
  maxFetchMissRate: 0,
  maxManifestP95Ms: 100,
  maxSegmentP95Ms: 100,
  syntheticOnly: true,
};

const target = selectTarget({
  schemaVersion: 1,
  targets: [{
    id: 'tiny-origin',
    environment: 'synthetic',
    production: false,
    origins: ['http://127.0.0.1:9'],
    limits: {
      maxClients: 2,
      maxRampPerSecond: 2,
      maxSoakSeconds: 2,
      maxShardCount: 2,
      minManifestIntervalMs: 25,
      maxInflightPerShard: 4,
      maxSegmentsPerPoll: 2,
      maxRequestsPerSecond: 100,
      maxManifestBytes: 65536,
      maxSegmentBytes: 1048576,
      maxClockOffsetMs: 100,
    },
  }],
}, 'tiny-origin');

async function invoke(paths, minimumGenerators = 2) {
  const script = path.resolve(import.meta.dirname, '..', 'verify-planned.mjs');
  const child = spawn(process.execPath, [
    script,
    '--min-generators', String(minimumGenerators),
    ...paths,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'listener-planned-evidence-'));
  const paths = [];
  for (let index = 0; index < 2; index += 1) {
    const plan = buildPlan({
      runId: 'dry-run-proof',
      profileName: 'tiny-synthetic',
      profile,
      target,
      shardIndex: index,
      shardCount: 2,
      startAt: '2030-01-01T00:00:00.000Z',
      networkRun: false,
    });
    const evidence = plannedEvidence({
      plan,
      target,
      policySha256: 'a'.repeat(64),
      profileSha256: 'b'.repeat(64),
      hostname: `generator-${index}`,
    });
    const evidencePath = path.join(directory, `shard-${index}.json`);
    await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
    await chmod(evidencePath, 0o600);
    paths.push(evidencePath);
  }
  return paths;
}

test('verifies a complete zero-request multi-generator plan', async () => {
  const paths = await fixture();
  const result = await invoke(paths);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'PLANNED');
  assert.equal(summary.clients, 2);
  assert.equal(summary.shardCount, 2);
  assert.equal(summary.distinctGenerators, 2);
  assert.equal(summary.networkRequestsMade, false);
  assert.deepEqual(summary.sourceShards.map((entry) => entry.index), [0, 1]);
});

test('refuses evidence that claims network activity', async () => {
  const paths = await fixture();
  const evidence = JSON.parse(await readFile(paths[1], 'utf8'));
  evidence.generator.networkRequestsMade = true;
  await writeFile(paths[1], `${JSON.stringify(evidence)}\n`);
  const result = await invoke(paths);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /zero network requests/);
});

test('refuses evidence that is not mode 0600', async () => {
  const paths = await fixture();
  await chmod(paths[1], 0o640);
  const result = await invoke(paths);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /mode must be exactly 0600/);
});
