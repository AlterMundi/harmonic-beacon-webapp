import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCandidateManifest } from '../release-manifest.mjs';

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

test('explicit genesis produces only the discriminator and null ancestry differences', () => {
  const ordinary = createCandidate(input());
  assert.deepEqual(createCandidate({ ...input(), mode: 'successor' }), ordinary);
  const genesis = createCandidate({ ...input(), mode: 'genesis', baseManifestSha256: undefined });
  assert.deepEqual(genesis, {
    ...ordinary, schemaVersion: 'harmonic-beacon.release.genesis.v1',
    promotion: { baseManifestSha256: null }, rollback: { manifestSha256: null },
  });
});

for (const [name, changes, error] of [
  ['unknown mode', { mode: 'initial' }, /mode/u],
  ['empty mode', { mode: '' }, /mode/u],
  ['null mode', { mode: null }, /mode/u],
  ['conflicting genesis base', { mode: 'genesis' }, /genesis.*base/u],
  ['null supplied genesis base', { mode: 'genesis', baseManifestSha256: null }, /genesis.*base/u],
  ['missing successor base', { baseManifestSha256: undefined }, /base/u],
  ['empty successor base', { baseManifestSha256: '' }, /base/u],
  ['malformed successor base', { baseManifestSha256: 'c'.repeat(63) }, /base/u],
  ['prefixed successor base', { baseManifestSha256: digest('c') }, /base/u],
  ['nonallowlisted dependency', { externalRefs: { ...input().externalRefs, postgres: `evil.example/postgres@${digest('e')}` } }, /allowlisted/u],
  ['incomplete inventory', { evidence: evidence.slice(1) }, /complete/u],
  ['incomplete evidence', { evidence: evidence.map(e => ({ ...e, sbomDigest: undefined })) }, /SBOM|unsupported value/u],
]) {
  test(`producer rejects ${name} before returning a candidate`, () => {
    assert.throws(() => createCandidate({ ...input(), ...changes }), error);
  });
}

test('CLI propagates explicit mode and rejects invalid inputs without creating output bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'genesis-producer-'));
  try {
    for (const entry of evidence) {
      const dir = join(root, entry.artifactId); mkdirSync(dir);
      writeFileSync(join(dir, 'evidence.json'), JSON.stringify(entry));
    }
    let index = 0;
    const invoke = changes => {
      const output = join(root, `candidate-${++index}.json`);
      const env = {
        PATH: process.env.PATH, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
        HB_POSTGRES_IMAGE_REF: input().externalRefs.postgres,
        HB_LIVEKIT_IMAGE_REF: input().externalRefs.livekit,
        HB_RELEASE_BASE_MANIFEST_SHA256: input().baseManifestSha256, ...changes,
      };
      const result = spawnSync(process.execPath, ['scripts/ci/create-candidate.mjs', '--evidence', root, '--output', output], { env, encoding: 'utf8' });
      return { ...result, output };
    };
    for (const mode of [undefined, 'successor', 'genesis']) {
      const result = invoke(mode === undefined ? {} : { HB_RELEASE_MODE: mode, ...(mode === 'genesis' ? { HB_RELEASE_BASE_MANIFEST_SHA256: '' } : {}) });
      assert.equal(result.status, 0, result.stderr);
      const candidate = JSON.parse(readFileSync(result.output));
      validateCandidateManifest(candidate);
      assert.equal(candidate.schemaVersion, mode === 'genesis' ? 'harmonic-beacon.release.genesis.v1' : 'harmonic-beacon.release.v1');
    }
    for (const changes of [
      { HB_RELEASE_MODE: 'wrong' }, { HB_RELEASE_MODE: '' },
      { HB_RELEASE_MODE: 'genesis' },
      { HB_RELEASE_BASE_MANIFEST_SHA256: '' }, { HB_RELEASE_BASE_MANIFEST_SHA256: 'bad' },
      { HB_POSTGRES_IMAGE_REF: 'postgres:16' }, { HB_LIVEKIT_IMAGE_REF: '' },
      { HB_POSTGRES_IMAGE_REF: `evil.example/postgres@${digest('e')}` },
    ]) {
      const result = invoke(changes);
      assert.notEqual(result.status, 0, JSON.stringify(changes));
      assert.equal(existsSync(result.output), false, 'invalid inputs emitted bytes');
    }
    rmSync(join(root, 'analytics'), { recursive: true });
    const incomplete = invoke({ HB_RELEASE_MODE: 'genesis', HB_RELEASE_BASE_MANIFEST_SHA256: '' });
    assert.notEqual(incomplete.status, 0);
    assert.equal(existsSync(incomplete.output), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects mutable external image references', () => {
  const options = input();
  options.externalRefs.postgres = 'docker.io/library/postgres:16';
  assert.throws(() => createCandidate(options), /exact postgres image reference/);
});
