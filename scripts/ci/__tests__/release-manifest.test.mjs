import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleReleaseManifest,
  candidateIdentitySha256,
  canonicalSha256,
  verifyReleaseManifest,
} from '../release-manifest.mjs';

const H = (character) => `sha256:${character.repeat(64)}`;
const HEX = (character) => character.repeat(64);
const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = HEX('c');
const NOW = new Date('2026-09-10T18:00:00.000Z');

function artifact(artifactId, repository, digest, roles) {
  return {
    artifactId,
    repository,
    digest,
    platform: 'linux/amd64',
    context: '.',
    dockerfile: artifactId === 'app' ? 'Dockerfile' : `services/${artifactId}/Dockerfile`,
    roles,
    sbom: { format: 'spdx-json', digest: H('1') },
    provenance: {
      predicateType: 'https://slsa.dev/provenance/v1',
      digest: H('2'),
    },
    signature: {
      issuer: 'https://token.actions.githubusercontent.com',
      identity: 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main',
      bundleDigest: H('3'),
    },
  };
}

function validManifest() {
  const manifest = {
    schemaVersion: 'harmonic-beacon.release.v1',
    source: {
      repository: 'AlterMundi/harmonic-beacon-webapp',
      gitSha: SHA,
      gitTree: TREE,
    },
    build: {
      workflowRunId: '34310000000',
      workflowRunAttempt: 1,
      createdAt: '2026-09-10T17:30:00.000Z',
      dependencyLockSha256: H('4'),
      buildDefinitionSha256: H('5'),
      runtimePolicySha256: H('6'),
    },
    artifacts: [
      artifact('app', 'ghcr.io/altermundi/harmonic-beacon-app', H('a'), ['app', 'migrate', 'commerce-reconciler']),
      artifact('tapestry', 'ghcr.io/altermundi/harmonic-beacon-tapestry', H('b'), ['tapestry']),
      artifact('playlist-bot', 'ghcr.io/altermundi/harmonic-beacon-playlist-bot', H('c'), ['playlist-bot']),
      artifact('analytics', 'ghcr.io/altermundi/harmonic-beacon-analytics', H('d'), ['analytics']),
    ],
    externalImages: [
      { serviceId: 'postgres', repository: 'docker.io/library/postgres', digest: H('e'), platform: 'linux/amd64' },
      { serviceId: 'livekit', repository: 'docker.io/livekit/livekit-server', digest: H('f'), platform: 'linux/amd64' },
    ],
    migrationSet: { head: '20260909120000_example', sha256: H('7') },
    publicConfig: {
      strategy: 'server-token-response',
      schemaSha256: H('8'),
    },
    configProfiles: {
      'live-staging': { sha256: H('9') },
      production: { sha256: H('0') },
    },
    promotion: { baseManifestSha256: BASE },
    rollback: {
      manifestSha256: HEX('d'),
      artifacts: [
        { artifactId: 'app', repository: 'ghcr.io/altermundi/harmonic-beacon-app', digest: H('8') },
        { artifactId: 'tapestry', repository: 'ghcr.io/altermundi/harmonic-beacon-tapestry', digest: H('9') },
        { artifactId: 'playlist-bot', repository: 'ghcr.io/altermundi/harmonic-beacon-playlist-bot', digest: H('a') },
        { artifactId: 'analytics', repository: 'ghcr.io/altermundi/harmonic-beacon-analytics', digest: H('b') },
      ],
    },
    qualification: {
      runId: '34310000001',
      result: 'success',
      qualifiedAt: '2026-09-10T17:50:00.000Z',
      expiresAt: '2026-09-11T17:50:00.000Z',
      candidateIdentitySha256: '',
      receiptSha256: H('5'),
    },
  };
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  return manifest;
}

function evidenceFor(manifest) {
  return Object.fromEntries(manifest.artifacts.map((entry) => [entry.artifactId, {
    repository: entry.repository,
    imageDigest: entry.digest,
    sbomDigest: entry.sbom.digest,
    provenanceDigest: entry.provenance.digest,
    signatureBundleDigest: entry.signature.bundleDigest,
  }]));
}

function expectations(manifest) {
  return {
    sourceRepository: manifest.source.repository,
    sourceSha: manifest.source.gitSha,
    sourceTree: manifest.source.gitTree,
    target: 'production',
    targetConfigSha256: manifest.configProfiles.production.sha256,
    currentBaseManifestSha256: manifest.promotion.baseManifestSha256,
    manifestSha256: canonicalSha256(manifest),
    registryEvidence: evidenceFor(manifest),
    now: NOW,
  };
}

function rejectMutation(name, mutate, pattern) {
  test(name, () => {
    const manifest = validManifest();
    const expected = expectations(manifest);
    mutate(manifest, expected);
    assert.throws(() => verifyReleaseManifest(manifest, expected), pattern);
  });
}

test('accepts a canonical, qualified manifest bound to exact registry evidence', () => {
  const manifest = validManifest();
  const result = verifyReleaseManifest(manifest, expectations(manifest));
  assert.equal(result.manifestSha256, canonicalSha256(manifest));
  assert.equal(result.imageRefs.app, `${manifest.artifacts[0].repository}@${manifest.artifacts[0].digest}`);
  assert.equal(result.rollbackRefs.app, `${manifest.rollback.artifacts[0].repository}@${manifest.rollback.artifacts[0].digest}`);
});

rejectMutation('rejects unknown manifest fields', (manifest) => { manifest.untrusted = true; }, /unknown field/);
rejectMutation('rejects wrong source SHA', (_manifest, expected) => { expected.sourceSha = 'f'.repeat(40); }, /source SHA/);
rejectMutation('rejects wrong source tree', (_manifest, expected) => { expected.sourceTree = 'f'.repeat(40); }, /source tree/);
rejectMutation('rejects a changed image digest', (manifest) => { manifest.artifacts[0].digest = H('f'); }, /candidate identity|image digest/);
rejectMutation('rejects a tag in place of an image digest', (manifest) => { manifest.artifacts[0].digest = 'latest'; }, /digest/);
rejectMutation('rejects an SBOM mismatch', (_manifest, expected) => { expected.registryEvidence.app.sbomDigest = H('f'); }, /SBOM/);
rejectMutation('rejects a provenance mismatch', (_manifest, expected) => { expected.registryEvidence.app.provenanceDigest = H('f'); }, /provenance/);
rejectMutation('rejects a signature mismatch', (_manifest, expected) => { expected.registryEvidence.app.signatureBundleDigest = H('f'); }, /signature/);
rejectMutation('rejects missing registry evidence', (_manifest, expected) => { delete expected.registryEvidence.app; }, /registry evidence/);
rejectMutation('rejects a target environment config mismatch', (_manifest, expected) => { expected.targetConfigSha256 = H('f'); }, /config profile/);
rejectMutation('rejects a stale base candidate', (_manifest, expected) => { expected.currentBaseManifestSha256 = HEX('f'); }, /stale candidate/);
rejectMutation('rejects an expired qualification', (_manifest, expected) => { expected.now = new Date('2026-09-12T00:00:00.000Z'); }, /expired/);
rejectMutation('rejects an unqualified candidate', (manifest) => { manifest.qualification.result = 'failure'; }, /qualification/);
rejectMutation('rejects a changed manifest hash', (_manifest, expected) => { expected.manifestSha256 = HEX('f'); }, /manifest SHA-256/);
rejectMutation('rejects a missing rollback digest', (manifest) => { manifest.rollback.artifacts[0].digest = ''; }, /rollback.*digest/);
rejectMutation('rejects an incomplete rollback digest set', (manifest) => { manifest.rollback.artifacts.pop(); }, /complete rollback/);
rejectMutation('rejects a duplicate app artifact', (manifest) => { manifest.artifacts.push(structuredClone(manifest.artifacts[0])); }, /duplicate artifact/);
rejectMutation('rejects app role digest divergence', (manifest) => { manifest.artifacts[0].roles = ['app', 'migrate']; }, /app roles/);

test('assembles qualification evidence into a self-bound final manifest', () => {
  const desired = validManifest();
  const candidate = structuredClone(desired);
  delete candidate.qualification;
  const assembled = assembleReleaseManifest(candidate, desired.qualification);
  assert.deepEqual(assembled, desired);
  verifyReleaseManifest(assembled, expectations(assembled));
});
