import { candidateIdentitySha256 } from '../release-manifest.mjs';
const H = (character) => `sha256:${character.repeat(64)}`;
const HEX = (character) => character.repeat(64);
const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = HEX('c');

function artifact(artifactId, repository, digest, roles) {
  return {
    artifactId,
    repository,
    digest,
    platform: 'linux/amd64',
    context: '.',
    dockerfile: artifactId === 'app' ? 'Dockerfile' : `services/${artifactId}/Dockerfile`,
    roles,
    evidenceRecordDigest: H('9'),
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

export function validManifest() {
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
