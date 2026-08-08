import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  GENERATOR_ROLE,
  aggregateEvidence,
  buildPlan,
  selectTarget,
} from '../src/contracts.mjs';
import { runShard } from '../src/runner.mjs';

async function listen(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function syntheticTarget(origin, limitOverrides = {}) {
  return selectTarget({
    schemaVersion: 1,
    targets: [{
      id: 'tiny-origin',
      environment: 'synthetic',
      production: false,
      origins: [origin],
      limits: {
        maxClients: 2,
        maxRampPerSecond: 2,
        maxSoakSeconds: 2,
        maxShardCount: 1,
        minManifestIntervalMs: 25,
        maxInflightPerShard: 4,
        maxSegmentsPerPoll: 2,
        maxRequestsPerSecond: 100,
        maxManifestBytes: 65536,
        maxSegmentBytes: 1048576,
        maxClockOffsetMs: 100,
        ...limitOverrides,
      },
    }],
  }, 'tiny-origin');
}

function tinyProfile(overrides = {}) {
  return {
    clients: 1,
    rampPerSecond: 1,
    soakSeconds: 1,
    manifestIntervalMs: 200,
    requestTimeoutMs: 200,
    startupSegments: 1,
    maxSegmentsPerPoll: 2,
    maxInflightPerShard: 2,
    minShards: 1,
    maxErrorRate: 0.1,
    maxFetchMissRate: 0.1,
    maxManifestP95Ms: 500,
    maxSegmentP95Ms: 500,
    syntheticOnly: true,
    ...overrides,
  };
}

test('tiny synthetic origin records latency, bytes, HTTP errors and rebuffer-equivalent misses', async (t) => {
  let manifestRequests = 0;
  let segmentRequests = 0;
  let initializationRequests = 0;
  const { server, origin } = await listen((request, response) => {
    if (request.url.startsWith('/live.m3u8')) {
      manifestRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-MAP:URI="/init.bin?token=must-not-leak"\n#EXTINF:5.000,\n/segment.bin?token=must-not-leak\n`);
      return;
    }
    if (request.url.startsWith('/init.bin')) {
      initializationRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(Buffer.from([9, 8, 7]));
      return;
    }
    if (request.url.startsWith('/segment.bin')) {
      segmentRequests += 1;
      if (segmentRequests === 1) {
        response.writeHead(503);
        response.end('synthetic failure');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.end(Buffer.from([0, 1, 2, 3, 4]));
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  t.after(() => server.close());
  const target = syntheticTarget(origin);
  const plan = buildPlan({
    runId: 'tiny-origin-run',
    profileName: 'tiny-profile',
    profile: tinyProfile(),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 50).toISOString(),
    networkRun: true,
  });
  let rotation = 0;
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=rotated-${rotation += 1}`,
    externalGenerator: false,
    declaredGeneratorRole: undefined,
    hostname: 'local-test',
  });
  assert.equal(evidence.status, 'FAIL');
  assert.ok(manifestRequests >= 4);
  assert.equal(initializationRequests, 1);
  assert.equal(segmentRequests, 1);
  assert.ok(evidence.measurements.bytes.manifest > 0);
  assert.equal(evidence.measurements.requests.httpStatus['503'], 1);
  assert.equal(evidence.measurements.fetchContinuity.misses, 1);
  assert.equal(evidence.measurements.fetchContinuity.missesByCategory.segment_http, 1);
  assert.ok(evidence.measurements.latencyMs.manifest.count >= 4);
  assert.equal(evidence.target.origin, origin);
  assert.equal(evidence.target.manifestPathSha256.length, 64);
  assert.doesNotMatch(JSON.stringify(evidence), /rotated-|must-not-leak|token=/);
});

test('response bounds, byte-range validation and exact segment-origin allowlist fail closed', async (t) => {
  let segmentRequests = 0;
  const { server, origin } = await listen((request, response) => {
    if (request.url.startsWith('/live.m3u8')) {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:20
#EXTINF:5,
#EXT-X-BYTERANGE:4@0
/ranged.bin
#EXTINF:5,
http://127.0.0.1:1/escaped.bin
`);
      return;
    }
    if (request.url.startsWith('/ranged.bin')) {
      segmentRequests += 1;
      response.writeHead(200, { 'Content-Length': '5' });
      response.end('whole');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  t.after(() => server.close());
  const target = syntheticTarget(origin);
  const plan = buildPlan({
    runId: 'bounded-response-run',
    profileName: 'bounded-profile',
    profile: tinyProfile({ startupSegments: 2 }),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: true,
  });
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=redacted`,
    hostname: 'local-test',
  });
  assert.equal(segmentRequests, 1);
  assert.equal(evidence.measurements.requests.errorsByCategory.range_status, 1);
  assert.equal(evidence.measurements.fetchContinuity.missesByCategory.segment_range_status, 1);
  assert.equal(evidence.measurements.fetchContinuity.missesByCategory.segment_target_allowlist, 1);
});

test('manifest response-body cap aborts oversized responses without storing their body', async (t) => {
  const oversized = `#EXTM3U\n${'#'.repeat(256)}`;
  const { server, origin } = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Length': String(Buffer.byteLength(oversized)) });
    response.end(oversized);
  });
  t.after(() => server.close());
  const target = syntheticTarget(origin, { maxManifestBytes: 64 });
  const plan = buildPlan({
    runId: 'manifest-body-limit',
    profileName: 'body-limit-profile',
    profile: tinyProfile(),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: true,
  });
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=redacted`,
    hostname: 'local-test',
  });
  assert.equal(evidence.status, 'FAIL');
  assert.ok(evidence.measurements.requests.errorsByCategory.body_limit >= 1);
  assert.equal(evidence.measurements.bytes.total, 0);
});

test('overall deadline cancels an in-flight synthetic request and settles every client', async (t) => {
  const { server, origin } = await listen(() => {});
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const target = syntheticTarget(origin);
  const plan = buildPlan({
    runId: 'deadline-run',
    profileName: 'deadline-profile',
    profile: tinyProfile({ manifestIntervalMs: 600, requestTimeoutMs: 1200 }),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: true,
  });
  const started = Date.now();
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=redacted`,
    hostname: 'local-test',
  });
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.termination.reason, 'deadline_exceeded');
  assert.ok(Date.now() - started < 1500);
});

test('operator abort accounts for an in-flight request and remains aggregatable', async (t) => {
  const controller = new AbortController();
  const { server, origin } = await listen(() => {
    setTimeout(() => controller.abort(), 10);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const target = syntheticTarget(origin);
  const plan = buildPlan({
    runId: 'operator-abort-run',
    profileName: 'operator-abort-profile',
    profile: tinyProfile({ manifestIntervalMs: 600, requestTimeoutMs: 1200 }),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: true,
  });
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=redacted`,
    hostname: 'local-test',
    signal: controller.signal,
  });
  assert.equal(evidence.status, 'ABORTED');
  assert.equal(evidence.termination.reason, 'operator_abort');
  assert.equal(evidence.measurements.requests.total, 1);
  assert.equal(evidence.measurements.requests.failed, 1);
  assert.equal(evidence.measurements.requests.errorsByCategory.aborted, 1);
  const aggregate = aggregateEvidence([{ sha256: 'c'.repeat(64), evidence }]);
  assert.equal(aggregate.status, 'FAIL');
});

test('rolling fetch failures trip the in-run circuit breaker before soak completion', async (t) => {
  const { server, origin } = await listen((_request, response) => {
    response.writeHead(503);
    response.end('synthetic outage');
  });
  t.after(() => server.close());
  const target = syntheticTarget(origin, { maxRequestsPerSecond: 300 });
  const plan = buildPlan({
    runId: 'circuit-run',
    profileName: 'circuit-profile',
    profile: tinyProfile({
      clients: 2,
      rampPerSecond: 2,
      manifestIntervalMs: 25,
      requestTimeoutMs: 50,
      maxErrorRate: 0,
      maxFetchMissRate: 0,
    }),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: true,
  });
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => `${origin}/live.m3u8?sig=redacted`,
    hostname: 'local-test',
  });
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.termination.reason, 'circuit_breaker');
  assert.equal(evidence.termination.circuitBreakerReason, 'fetch_miss_rate');
  assert.ok(evidence.measurements.requests.total < 80);
});

test('staging responses must present the exact non-production attestation', async () => {
  const target = selectTarget({
    schemaVersion: 1,
    targets: [{
      id: 'attested-staging',
      environment: 'staging',
      production: false,
      attestation: {
        header: 'x-harmonic-beacon-environment',
        value: 'early-birds-staging-test',
      },
      origins: ['https://staging.example.test'],
      limits: {
        maxClients: 1,
        maxRampPerSecond: 1,
        maxSoakSeconds: 1,
        maxShardCount: 1,
        minManifestIntervalMs: 1000,
        maxInflightPerShard: 1,
        maxSegmentsPerPoll: 1,
        maxRequestsPerSecond: 2,
        maxManifestBytes: 65536,
        maxSegmentBytes: 1048576,
        maxClockOffsetMs: 100,
      },
    }],
  }, 'attested-staging');
  const plan = buildPlan({
    runId: 'attestation-run',
    profileName: 'attestation-profile',
    profile: tinyProfile({
      manifestIntervalMs: 1000,
      requestTimeoutMs: 1000,
      startupSegments: 1,
      maxSegmentsPerPoll: 1,
      maxInflightPerShard: 1,
      maxManifestP95Ms: 1000,
      maxSegmentP95Ms: 1000,
      syntheticOnly: false,
    }),
    target,
    shardIndex: 0,
    shardCount: 1,
    startAt: new Date(Date.now() + 25).toISOString(),
    networkRun: false,
  });
  const evidence = await runShard({
    plan,
    target,
    policySha256: 'a'.repeat(64),
    profileSha256: 'b'.repeat(64),
    confirmation: plan.confirmation,
    manifestUrlProvider: async () => 'https://staging.example.test/live.m3u8?sig=redacted',
    externalGenerator: true,
    declaredGeneratorRole: GENERATOR_ROLE,
    clockOffsetMs: 5,
    hostname: 'external-generator',
    fetchImpl: async () => new Response('#EXTM3U\n', { status: 200 }),
  });
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.measurements.requests.errorsByCategory.target_attestation, 1);
});

test('CLI dry-run writes planned redacted evidence and makes zero network requests', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'early-birds-hls-dry-'));
  const policyPath = path.join(temporary, 'policy.json');
  const evidencePath = path.join(temporary, 'evidence.json');
  await writeFile(policyPath, JSON.stringify({
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
        maxShardCount: 1,
        minManifestIntervalMs: 25,
        maxInflightPerShard: 4,
        maxSegmentsPerPoll: 2,
        maxRequestsPerSecond: 100,
        maxManifestBytes: 65536,
        maxSegmentBytes: 1048576,
        maxClockOffsetMs: 100,
      },
    }],
  }), { mode: 0o600 });
  await chmod(policyPath, 0o600);
  const toolRoot = path.resolve(import.meta.dirname, '..');
  const child = spawn(process.execPath, [
    path.join(toolRoot, 'run.mjs'),
    '--policy', policyPath,
    '--target', 'tiny-origin',
    '--profile', 'tiny-synthetic',
    '--run-id', 'dry-run-proof',
    '--start-at', '2030-01-01T00:00:00.000Z',
    '--evidence', evidencePath,
    '--dry-run',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Network requests: 0/);
  assert.match(stdout, /generator=external-not-mona/);
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'PLANNED');
  assert.equal(evidence.generator.networkRequestsMade, false);
  assert.equal(evidence.measurements.requests.total, 0);
});
