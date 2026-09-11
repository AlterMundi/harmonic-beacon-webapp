import assert from 'node:assert/strict';
import test from 'node:test';

import { createCandidate } from '../create-candidate.mjs';

const digest = (char) => `sha256:${char.repeat(64)}`;
const evidence = ['app', 'tapestry', 'playlist-bot', 'analytics'].map((artifactId, index) => ({
  artifactId,
  repository: `ghcr.io/altermundi/harmonic-beacon-${artifactId}`,
  digest: digest(String.fromCharCode(97 + index)),
  evidenceRecordDigest: digest('6'),
  sbomDigest: digest('1'),
  sbomSignatureBundleDigest: digest('4'),
  provenanceDigest: digest('2'),
  provenanceSignatureBundleDigest: digest('5'),
  signatureBundleDigest: digest('3'),
}));
evidence[0].repository = 'ghcr.io/altermundi/harmonic-beacon-app';

function input() {
  return {
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runId: '123', runAttempt: 1,
    createdAt: '2026-09-10T17:00:00.000Z', evidence,
    externalRefs: {
      postgres: `docker.io/library/postgres@${digest('e')}`,
      livekit: `docker.io/livekit/livekit-server@${digest('f')}`,
    },
    baseManifestSha256: 'c'.repeat(64),
    rollback: { manifestSha256: 'd'.repeat(64), artifacts: [{ artifactId: 'app' }] },
    hashes: {
      dependencyLock: digest('4'), buildDefinition: digest('5'), runtimePolicy: digest('6'),
      migrationSet: digest('7'), configSchema: digest('8'), liveStagingConfig: digest('9'),
      productionConfig: digest('0'), compose: digest('a'), overlay: digest('b'),
    },
    migrationHead: '20260910170000_example',
  };
}

test('creates a complete exact-digest candidate with one app digest for all app roles', () => {
  const candidate = createCandidate(input());
  assert.equal(candidate.artifacts.length, 4);
  assert.equal(candidate.artifacts[0].evidenceRecordDigest, digest('6'));
  assert.ok(candidate.artifacts.every((entry) => entry.context === '.'));
  assert.deepEqual(candidate.rollback, { manifestSha256: 'c'.repeat(64) });
  assert.deepEqual(candidate.artifacts[0].roles, ['app', 'migrate', 'commerce-reconciler']);
  assert.equal(candidate.externalImages[0].digest, digest('e'));
  assert.equal(candidate.qualification, undefined);
});

test('rejects mutable external image references', () => {
  const options = input();
  options.externalRefs.postgres = 'docker.io/library/postgres:16';
  assert.throws(() => createCandidate(options), /exact postgres image reference/);
});
