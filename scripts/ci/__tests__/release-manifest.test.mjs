import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  assembleReleaseManifest,
  candidateIdentitySha256,
  canonicalSha256,
  canonicalize,
  validateCandidateManifest,
  validateCurrentState,
  impactStateFromCurrent,
  validateQualificationReceipt,
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

function genesisManifest() {
  const manifest = validManifest();
  manifest.schemaVersion = 'harmonic-beacon.release.genesis.v1';
  manifest.promotion.baseManifestSha256 = null;
  manifest.rollback.manifestSha256 = null;
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  return manifest;
}

test('genesis structural validation and schema require disjoint, explicit null ancestry', () => {
  const projectRequire = createRequire(import.meta.url);
  const Ajv2020 = projectRequire('ajv/dist/2020').default;
  const schema = JSON.parse(readFileSync(new URL('../../../deploy/schemas/release-manifest.schema.json', import.meta.url)));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  for (const fixture of [validManifest(), genesisManifest()]) {
    assert.equal(validateReleaseManifest(fixture), fixture);
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
    for (const mutate of [
      m => { m.schemaVersion = 'unknown'; },
      m => { m.genesis = true; },
      m => { m.promotion.extra = true; },
      m => { delete m.promotion.baseManifestSha256; },
      m => { delete m.rollback.manifestSha256; },
      m => { m.promotion.baseManifestSha256 = null; m.rollback.manifestSha256 = BASE; },
      m => { m.promotion.baseManifestSha256 = BASE; m.rollback.manifestSha256 = null; },
      m => {
        const ancestry = m.schemaVersion === 'harmonic-beacon.release.v1' ? null : HEX('0');
        m.promotion.baseManifestSha256 = ancestry; m.rollback.manifestSha256 = ancestry;
      },
    ]) {
      const bad = structuredClone(fixture); mutate(bad);
      bad.qualification.candidateIdentitySha256 = candidateIdentitySha256(bad);
      assert.throws(() => validateReleaseManifest(bad));
      assert.equal(validate(bad), false, JSON.stringify(bad));
    }
  }
  const ordinaryZero = validManifest();
  ordinaryZero.promotion.baseManifestSha256 = HEX('0');
  ordinaryZero.rollback.manifestSha256 = HEX('0');
  ordinaryZero.qualification.candidateIdentitySha256 = candidateIdentitySha256(ordinaryZero);
  assert.equal(validateReleaseManifest(ordinaryZero), ordinaryZero, 'hash syntax is not predecessor authentication');
  assert.equal(validate(ordinaryZero), true);
});

test('ordinary verification rejects genesis even when current-base expectations are null', () => {
  const genesis = genesisManifest();
  for (const currentBaseManifestSha256 of [null, BASE]) {
    assert.throws(() => verifyReleaseManifest(genesis, { ...expectations(genesis), currentBaseManifestSha256 }), /genesis.*ordinary/u);
  }
});

test('a true successor binds the actual sealed genesis byte hash as base and rollback prior', () => {
  const genesis = genesisManifest();
  const sealedHash = createHash('sha256').update(canonicalize(genesis)).digest('hex');
  const successor = validManifest();
  successor.promotion.baseManifestSha256 = sealedHash;
  successor.rollback.manifestSha256 = sealedHash;
  successor.qualification.candidateIdentitySha256 = candidateIdentitySha256(successor);
  const expected = expectations(successor);
  assert.equal(verifyReleaseManifest(successor, expected).manifestSha256, canonicalSha256(successor));
  assert.throws(() => verifyReleaseManifest(successor, { ...expected, currentBaseManifestSha256: BASE }), /stale candidate/u);
});

test('genesis identity, assembly and complete qualification receipt retain all shared bindings', () => {
  const genesis = genesisManifest();
  assert.notEqual(candidateIdentitySha256(genesis), candidateIdentitySha256(validManifest()));
  for (const mutate of [
    m => { m.schemaVersion = 'harmonic-beacon.release.v1'; },
    m => { m.promotion.baseManifestSha256 = BASE; },
    m => { m.rollback.manifestSha256 = BASE; },
    m => { m.source.gitSha = 'f'.repeat(40); },
    m => { m.source.gitTree = 'f'.repeat(40); },
    m => { m.artifacts[0].evidenceRecordDigest = H('f'); },
  ]) {
    const changed = structuredClone(genesis); mutate(changed);
    assert.notEqual(candidateIdentitySha256(changed), candidateIdentitySha256(genesis));
    assert.throws(() => validateReleaseManifest(changed));
  }
  const candidate = structuredClone(genesis); delete candidate.qualification;
  assert.equal(validateCandidateManifest(candidate), candidate);
  const receipt = {
    schemaVersion: 'oci-qualification.v3', result: 'success',
    workflowRunId: genesis.build.workflowRunId, workflowRunAttempt: 1,
    candidateIdentitySha256: candidateIdentitySha256(candidate),
    imageRefs: Object.fromEntries([...genesis.artifacts, ...genesis.externalImages].map(e => [e.artifactId ?? e.serviceId, `${e.repository}@${e.digest}`])),
    checkedServices: ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'],
    qualificationJob: 'qualify', measurementStartedAt: '2026-09-10T17:40:00.000Z',
    measurementCompletedAt: '2026-09-10T17:49:00.000Z', issuedAt: genesis.qualification.qualifiedAt,
    acceptance: {
      browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 },
      syntheticSession: { created: 1, authenticatedRole: 'ADMIN' },
      commerce: { workerHeartbeatAgeMs: 1, pending: 0, processing: 0 },
      schema: { expectedHead: genesis.migrationSet.head, observedHead: genesis.migrationSet.head },
      isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] },
      restore: { backupSha256: H('a'), backupBytes: 4, restoredSessionCount: 1 },
    },
  };
  genesis.qualification.receiptSha256 = publicConfigSha256(canonicalize(receipt));
  assert.equal(validateQualificationReceipt(receipt, candidate), receipt);
  const assembled = assembleReleaseManifest(candidate, genesis.qualification);
  assert.deepEqual(assembled, genesis);
  assert.equal(validateQualificationReceipt(receipt, assembled), receipt);
  assert.throws(() => assembleReleaseManifest(candidate, { ...genesis.qualification, candidateIdentitySha256: BASE }), /different candidate/u);
  for (const mutate of [
    q => { q.workflowRunId = '123'; }, q => { q.workflowRunAttempt = 2; },
    q => { q.candidateIdentitySha256 = BASE; }, q => { q.result = 'failure'; },
    q => { q.imageRefs.app = `other@${H('a')}`; },
    q => { q.checkedServices.pop(); }, q => { delete q.acceptance.restore; },
    q => { q.acceptance.browser.skipped = 1; }, q => { q.qualificationJob = 'build'; },
  ]) {
    const changed = structuredClone(receipt); mutate(changed);
    assert.throws(() => validateQualificationReceipt(changed, assembled));
    assert.notEqual(publicConfigSha256(canonicalize(changed)), assembled.qualification.receiptSha256);
  }
  for (const mutate of [
    m => { m.build.workflowRef = 'refs/heads/feature'; },
    m => { m.artifacts[0].signature.identity = 'untrusted'; },
    m => { m.qualification.runId = '123'; }, m => { m.qualification.runAttempt = 2; },
    m => { m.qualification.result = 'failure'; },
    m => { m.qualification.expiresAt = '2026-09-12T17:50:00.000Z'; },
  ]) {
    const changed = structuredClone(assembled); mutate(changed);
    changed.qualification.candidateIdentitySha256 = candidateIdentitySha256(changed);
    assert.throws(() => validateReleaseManifest(changed));
  }
});

test('v4 decodes historical genesis without making it ordinary admission or adding a Live service', () => {
  const manifest = genesisManifest();
  const compose = readFileSync('docker-compose.yml');
  const overlay = readFileSync('deploy/oci-images.compose.yml');
  const config = readFileSync('deploy/runtime-public-config/production.json');
  manifest.deploymentInputs = { composeSha256: publicConfigSha256(compose), overlaySha256: publicConfigSha256(overlay) };
  manifest.configProfiles.production.sha256 = publicConfigSha256(config);
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  const manifestBytes = Buffer.from(canonicalize(manifest));
  const hash = publicConfigSha256(manifestBytes).slice(7);
  const state = {
    schemaVersion: 'harmonic-beacon.current-state.v4', laneState: 'oci-production',
    manifestSha256: hash, manifestBase64: manifestBytes.toString('base64'),
    composeBase64: compose.toString('base64'), overlayBase64: overlay.toString('base64'), publicConfigBase64: config.toString('base64'),
    publication: { generation: 1, id: HEX('a'), manifestSha256: hash },
  };
  assert.deepEqual(validateCurrentState(state).manifestBase64, manifestBytes);
  const impact = impactStateFromCurrent(state);
  assert.deepEqual(Object.keys(impact.serviceReleases).sort(), ['app', 'commerce-reconciler', 'playlist-bot', 'tapestry']);
  state.serviceReleases = impact.serviceReleases;
  validateCurrentState(state);
  assert.throws(() => validateCurrentState({ ...state, serviceReleases: { ...state.serviceReleases, analytics: state.serviceReleases.app } }), /service release/u);
  assert.ok(Date.parse(manifest.qualification.expiresAt) < Date.parse('2026-09-12T00:00:00.000Z'));
  assert.throws(() => verifyReleaseManifest(manifest, { ...expectations(manifest), now: new Date('2026-09-12T00:00:00.000Z') }), /genesis.*ordinary/u);
  const ordinary = validManifest();
  assert.throws(() => verifyReleaseManifest(ordinary, { ...expectations(ordinary), now: new Date('2026-09-10T17:49:00.000Z') }), /future/u);
  assert.throws(() => verifyReleaseManifest(ordinary, { ...expectations(ordinary), now: new Date(ordinary.qualification.expiresAt) }), /expired/u);
});

test('accepts a canonical, qualified manifest bound to exact registry evidence', () => {
  const manifest = validManifest();
  const result = verifyReleaseManifest(manifest, expectations(manifest));
  assert.equal(result.manifestSha256, canonicalSha256(manifest));
  assert.equal(result.imageRefs.app, `${manifest.artifacts[0].repository}@${manifest.artifacts[0].digest}`);
});

test('Draft 2020-12 release schema accepts producer output and requires evidenceRecordDigest', () => {
  const projectRequire = createRequire(import.meta.url);
  const prismaRequire = createRequire(projectRequire.resolve('@prisma/streams-local/package.json'));
  const Ajv2020 = prismaRequire('ajv/dist/2020').default;
  const schema = JSON.parse(readFileSync(new URL('../../../deploy/schemas/release-manifest.schema.json', import.meta.url)));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  const manifest = validManifest();
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  delete manifest.artifacts[0].evidenceRecordDigest;
  assert.equal(validate(manifest), false);
  assert.ok(validate.errors.some(error => error.keyword === 'required' && error.params.missingProperty === 'evidenceRecordDigest'));
});

rejectMutation('rejects missing evidence record digest', (manifest) => { delete manifest.artifacts[0].evidenceRecordDigest; }, /missing evidenceRecordDigest/);
rejectMutation('rejects malformed evidence record digest', (manifest) => { manifest.artifacts[0].evidenceRecordDigest = 'mutable'; }, /evidence record digest/);
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
