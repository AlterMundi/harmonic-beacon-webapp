import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATOR_ROLE,
  aggregateEvidence,
  assertExternalGenerator,
  assertRedactedEvidence,
  buildPlan,
  createLatencyHistogram,
  observeLatency,
  parseMediaPlaylist,
  parseUtc,
  selectTarget,
  sha256,
  summarizeLatency,
} from '../src/contracts.mjs';
import { plannedEvidence } from '../src/runner.mjs';

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    targets: [{
      id: 'test-staging',
      environment: 'staging',
      production: false,
      attestation: {
        header: 'x-harmonic-beacon-environment',
        value: 'early-birds-staging-test',
      },
      origins: ['https://staging.example.test', 'https://media-staging.example.test'],
      limits: {
        maxClients: 5000,
        maxRampPerSecond: 100,
        maxSoakSeconds: 3600,
        maxShardCount: 16,
        minManifestIntervalMs: 1000,
        maxInflightPerShard: 128,
        maxSegmentsPerPoll: 6,
        maxRequestsPerSecond: 20000,
        maxManifestBytes: 262144,
        maxSegmentBytes: 4194304,
        maxClockOffsetMs: 100,
      },
      ...overrides,
    }],
  };
}

function profile(overrides = {}) {
  return {
    clients: 12,
    rampPerSecond: 4,
    soakSeconds: 30,
    manifestIntervalMs: 3000,
    requestTimeoutMs: 3000,
    startupSegments: 2,
    maxSegmentsPerPoll: 6,
    maxInflightPerShard: 8,
    minShards: 2,
    maxErrorRate: 0.01,
    maxFetchMissRate: 0.01,
    maxManifestP95Ms: 1000,
    maxSegmentP95Ms: 2000,
    syntheticOnly: false,
    ...overrides,
  };
}

test('target policy is exact, explicitly non-production, and fails closed for live-like targets', () => {
  const target = selectTarget(policy(), 'test-staging');
  assert.deepEqual(target.origins, [
    'https://staging.example.test',
    'https://media-staging.example.test',
  ]);
  assert.throws(
    () => selectTarget(policy({ environment: 'production' }), 'test-staging'),
    /staging or synthetic/,
  );
  assert.throws(
    () => selectTarget(policy({ production: true }), 'test-staging'),
    /production to false/,
  );
  assert.throws(
    () => selectTarget(policy({ origins: ['https://live.harmonicbeacon.com'] }), 'test-staging'),
    /production target hostname/,
  );
  for (const origin of [
    'https://harmonicbeacon.com.',
    'https://app.harmonicbeacon.com',
    'https://foo.live.harmonicbeacon.com',
  ]) {
    assert.throws(() => selectTarget(policy({ origins: [origin] }), 'test-staging'),
      /production.*hostname/);
  }
  assert.throws(
    () => selectTarget(policy({ origins: ['http://staging.example.test'] }), 'test-staging'),
    /must use HTTPS/,
  );
});

test('distributed shards partition deterministic global client ordinals and share one plan hash', () => {
  const target = selectTarget(policy(), 'test-staging');
  const values = Array.from({ length: 3 }, (_, shardIndex) => buildPlan({
    runId: 'reproducible-run',
    profileName: 'test-profile',
    profile: profile({ clients: 12, minShards: 3 }),
    target,
    shardIndex,
    shardCount: 3,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }));
  assert.equal(new Set(values.map((value) => value.planHash)).size, 1);
  assert.deepEqual(values[0].shard.clientOrdinals, [0, 3, 6, 9]);
  assert.deepEqual(values[1].shard.clientOrdinals, [1, 4, 7, 10]);
  assert.deepEqual(values[2].shard.clientOrdinals, [2, 5, 8, 11]);
  assert.match(values[0].confirmation, /clients=12 ramp=4\/s soak=30s shards=3/);
  assert.match(values[0].confirmation, new RegExp(`plan=${values[0].planHash}$`));
  const changed = buildPlan({
    runId: 'reproducible-run',
    profileName: 'test-profile',
    profile: profile({ clients: 12, minShards: 3, manifestIntervalMs: 4000 }),
    target,
    shardIndex: 0,
    shardCount: 3,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  });
  assert.notEqual(changed.confirmation, values[0].confirmation);
});

test('large profiles require distributed shards and remain capped per generator', () => {
  const target = selectTarget(policy(), 'test-staging');
  assert.throws(() => buildPlan({
    runId: 'too-few-shards',
    profileName: 'large-profile',
    profile: profile({ clients: 3000, minShards: 1 }),
    target,
    shardIndex: 0,
    shardCount: 2,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }), /at least four shards/);
  const plan = buildPlan({
    runId: 'bounded-shards',
    profileName: 'large-profile',
    profile: profile({ clients: 3000, minShards: 4 }),
    target,
    shardIndex: 0,
    shardCount: 4,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  });
  assert.equal(plan.shard.localClients, 750);
});

test('staging network runs are explicitly external and always refused from mona', () => {
  assert.throws(() => assertExternalGenerator({
    hostname: 'mona',
    declaredRole: GENERATOR_ROLE,
    externalConfirmed: true,
    targetEnvironment: 'staging',
    networkRun: true,
  }), /forbidden from mona/);
  assert.throws(() => assertExternalGenerator({
    hostname: 'mona-01.example.test',
    declaredRole: GENERATOR_ROLE,
    externalConfirmed: true,
    targetEnvironment: 'staging',
    networkRun: true,
  }), /forbidden from mona/);
  assert.throws(() => assertExternalGenerator({
    hostname: 'generator-1',
    declaredRole: 'web-runtime',
    externalConfirmed: true,
    targetEnvironment: 'staging',
    networkRun: true,
  }), /must equal external-load-generator/);
  assert.doesNotThrow(() => assertExternalGenerator({
    hostname: 'generator-1',
    declaredRole: GENERATOR_ROLE,
    externalConfirmed: true,
    targetEnvironment: 'staging',
    networkRun: true,
  }));
});

test('UTC timestamps and request-shape bounds fail closed', () => {
  assert.throws(() => parseUtc('2026-02-30T12:00:00.000Z'), /invalid UTC civil date/);
  const target = selectTarget(policy(), 'test-staging');
  assert.throws(() => buildPlan({
    runId: 'poll-too-fast',
    profileName: 'unsafe-profile',
    profile: profile({ manifestIntervalMs: 999, requestTimeoutMs: 1000 }),
    target,
    shardIndex: 0,
    shardCount: 2,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }), /manifestIntervalMs must be at least/);
  assert.throws(() => buildPlan({
    runId: 'unsafe-quality-gate',
    profileName: 'unsafe-profile',
    profile: profile({ maxErrorRate: 1, maxFetchMissRate: 1 }),
    target,
    shardIndex: 0,
    shardCount: 2,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }), /maxErrorRate must be between zero and 0\.1/);
  assert.throws(() => parseMediaPlaylist(
    '#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:0@0\nsegment.bin\n',
    'https://staging.example.test/live.m3u8',
  ), /positive safe integer/);
});

test('media parsing is codec/rate/channel neutral and preserves relative URLs and byte ranges', () => {
  const manifest = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:41
#EXTINF:1.250,
#EXT-X-BYTERANGE:4@0
opaque.bin?sig=first
#EXTINF:7.750,
#EXT-X-BYTERANGE:3
opaque.bin?sig=first
#EXTINF:3.000,
#EXT-X-GAP
gap.bin
`;
  const parsed = parseMediaPlaylist(
    manifest,
    'https://media-staging.example.test/path/live.m3u8?sig=manifest',
  );
  assert.deepEqual(parsed.segments.map(({ sequence, durationSeconds, byteRange }) => ({
    sequence,
    durationSeconds,
    byteRange,
  })), [
    { sequence: 41, durationSeconds: 1.25, byteRange: { start: 0, end: 3 } },
    { sequence: 42, durationSeconds: 7.75, byteRange: { start: 4, end: 6 } },
    { sequence: 43, durationSeconds: 3, byteRange: null },
  ]);
  assert.equal(parsed.segments[0].url, 'https://media-staging.example.test/path/opaque.bin?sig=first');
  assert.equal(parsed.segments[2].declaredGap, true);
  assert.throws(() => parseMediaPlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\nsegment.bin\n',
    'https://media-staging.example.test/live.m3u8',
  ), /encrypted media playlists/);
});

test('planned and aggregate evidence contain hashes, never signed URLs', () => {
  const target = selectTarget(policy(), 'test-staging');
  const plans = [0, 1].map((shardIndex) => buildPlan({
    runId: 'aggregate-run',
    profileName: 'test-profile',
    profile: profile(),
    target,
    shardIndex,
    shardCount: 2,
    startAt: '2030-01-01T00:00:00.000Z',
    networkRun: false,
  }));
  const entries = plans.map((plan) => {
    const evidence = plannedEvidence({
      plan,
      target,
      policySha256: 'a'.repeat(64),
      profileSha256: 'b'.repeat(64),
      hostname: 'generator',
    });
    const histogram = (count) => {
      const value = createLatencyHistogram();
      for (let index = 0; index < count; index += 1) observeLatency(value, 10);
      return summarizeLatency(value);
    };
    evidence.status = 'PASS';
    evidence.target = {
      id: target.id,
      environment: target.environment,
      plane: 'origin-media',
      origin: target.origins[0],
      manifestPathSha256: sha256('/media/live.m3u8'),
      allowlistedOrigins: [...target.origins],
    };
    evidence.generator = {
      role: GENERATOR_ROLE,
      hostFingerprintSha256: sha256(`generator-${plan.shard.index}`),
      explicitlyExternal: true,
      networkRequestsMade: true,
      measuredClockOffsetMs: 5,
    };
    evidence.termination = { reason: 'completed', circuitBreakerReason: null };
    evidence.measurements = {
      clients: {
        planned: plan.shard.localClients,
        started: plan.shard.localClients,
        completed: plan.shard.localClients,
        generatorScheduleMisses: 0,
      },
      requests: {
        total: 2,
        successful: 2,
        failed: 0,
        byKind: { manifest: 1, segment: 1 },
        errorsByCategory: {},
        httpStatus: { 200: 2 },
        errorRate: 0,
      },
      bytes: { total: 6, manifest: 1, segment: 5 },
      fetchContinuity: {
        opportunities: 1,
        successfulMediaFetches: 1,
        misses: 0,
        missesByCategory: {},
        fetchMissRate: 0,
      },
      manifest: { samples: 1, sequenceRegressions: 0, windowMisses: 0 },
      latencyMs: {
        all: histogram(2),
        manifest: histogram(1),
        segment: histogram(1),
        queue: histogram(2),
      },
      rollingWindows: {
        seconds: 10,
        sampled: 1,
        eligibleRequestWindows: 0,
        eligibleFetchWindows: 0,
        worstRequestErrorRate: null,
        worstFetchMissRate: null,
      },
    };
    return { sha256: 'c'.repeat(64), evidence };
  });
  const aggregate = aggregateEvidence(entries);
  assert.equal(aggregate.status, 'PASS');
  assert.equal(aggregate.sourceShards.length, 2);
  assert.equal(aggregate.plan.planHash, plans[0].planHash);
  assert.doesNotThrow(() => assertRedactedEvidence(aggregate));
  const mismatched = structuredClone(entries);
  mismatched[1].evidence.target.origin = 'https://other-staging.example.test';
  assert.throws(() => aggregateEvidence(mismatched), /actual target (?:descriptor does not match|differs)/);
  const mismatchedInputs = structuredClone(entries);
  mismatchedInputs[1].evidence.inputs.targetPolicySha256 = 'd'.repeat(64);
  assert.throws(() => aggregateEvidence(mismatchedInputs), /input\/confirmation hashes differ/);
  const relaxedThresholds = structuredClone(entries);
  relaxedThresholds[0].evidence.thresholds.maxErrorRate = 0.1;
  assert.throws(() => aggregateEvidence(relaxedThresholds),
    /thresholds do not match the deterministic plan profile/);
  assert.throws(() => assertRedactedEvidence({
    target: 'https://media-staging.example.test/live.m3u8?sig=leak',
  }), /query strings|credential-like/);
  assert.throws(() => assertRedactedEvidence({ authorization: 'Bearer do-not-store' }),
    /sensitive field|bearer/);
});
