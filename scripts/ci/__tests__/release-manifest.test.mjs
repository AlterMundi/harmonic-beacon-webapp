import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  assembleReleaseManifest,
  candidateIdentitySha256,
  canonicalSha256,
  publicConfigSha256,
  validateReleaseManifest,
  verifyReleaseManifest,
  verifyRuntimePublicConfig,
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
    sbom: { format: 'spdx-json', digest: H('1'), signatureBundleDigest: H('4') },
    provenance: {
      predicateType: 'https://slsa.dev/provenance/v1',
      digest: H('2'),
      signatureBundleDigest: H('5'),
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
      workflowPath: '.github/workflows/oci-candidate.yml',
      workflowRef: 'refs/heads/main',
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
    deploymentInputs: { composeSha256: H('6'), overlaySha256: H('7') },
    promotion: { baseManifestSha256: BASE },
    rollback: { manifestSha256: BASE },
    qualification: {
      runId: '34310000000',
      runAttempt: 1,
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
    sbomSignatureBundleDigest: entry.sbom.signatureBundleDigest,
    provenanceDigest: entry.provenance.digest,
    provenanceSignatureBundleDigest: entry.provenance.signatureBundleDigest,
    signatureBundleDigest: entry.signature.bundleDigest,
  }]));
}

function expectations(manifest) {
  return {
    sourceRepository: manifest.source.repository,
    sourceSha: manifest.source.gitSha,
    sourceTree: manifest.source.gitTree,
    workflowRunId: manifest.build.workflowRunId,
    workflowRunAttempt: manifest.build.workflowRunAttempt,
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
rejectMutation('rejects a qualification run attempt mismatch', (manifest) => { manifest.qualification.runAttempt = 2; }, /qualification run identity or attempt/u);
rejectMutation('rejects an unqualified candidate', (manifest) => { manifest.qualification.result = 'failure'; }, /qualification/);
rejectMutation('rejects a changed manifest hash', (_manifest, expected) => { expected.manifestSha256 = HEX('f'); }, /manifest SHA-256/);
rejectMutation('rejects a rollback manifest not equal to the current base', (manifest) => { manifest.rollback.manifestSha256 = HEX('f'); }, /rollback manifest must equal/);
rejectMutation('rejects a duplicate app artifact', (manifest) => { manifest.artifacts.push(structuredClone(manifest.artifacts[0])); }, /duplicate artifact/);
rejectMutation('rejects app role digest divergence', (manifest) => { manifest.artifacts[0].roles = ['app', 'migrate']; }, /app roles/);

test('validator rejects qualification identity drift without external expectations', () => {
  const manifest = validManifest();
  manifest.qualification.runAttempt = 2;
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  assert.throws(() => validateReleaseManifest(manifest), /qualification run identity or attempt/u);
});

test('public config digest is SHA-256 of the exact file bytes', () => {
  const bytes = Buffer.from('{"z":1,"a":2}\n');
  assert.equal(publicConfigSha256(bytes), `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  assert.notEqual(publicConfigSha256(bytes), publicConfigSha256(Buffer.from('{"a":2,"z":1}\n')));
});

test('runtime public config rejects semantic drift in inert operator env bytes', () => {
  const profile = {
    schemaVersion: 'harmonic-beacon.runtime-public-config.v1',
    publicOrigin: 'https://live.harmonicbeacon.com',
    livekitPublicUrl: 'wss://live.harmonicbeacon.com',
    featureFlags: { tapestryPublic: false, promoInvitations: false },
  };
  const valid = Buffer.from('PUBLIC_ORIGIN=https://live.harmonicbeacon.com\nLIVEKIT_PUBLIC_URL=wss://live.harmonicbeacon.com\nLIVEKIT_PUBLIC_URL_ALLOWLIST=wss://live.harmonicbeacon.com\nPROMO_INVITATIONS_ENABLED=false\nTAPESTRY_PUBLIC_ENABLED=false\n');
  assert.equal(verifyRuntimePublicConfig(profile, valid), true);
  assert.throws(() => verifyRuntimePublicConfig(profile, Buffer.from(valid.toString().replace('PROMO_INVITATIONS_ENABLED=false', 'PROMO_INVITATIONS_ENABLED=true'))), /does not match/u);
});

test('assembles qualification evidence into a self-bound final manifest', () => {
  const desired = validManifest();
  const candidate = structuredClone(desired);
  delete candidate.qualification;
  const assembled = assembleReleaseManifest(candidate, desired.qualification);
  assert.deepEqual(assembled, desired);
  verifyReleaseManifest(assembled, expectations(assembled));
});
