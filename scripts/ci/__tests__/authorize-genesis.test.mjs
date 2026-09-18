import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { candidateIdentitySha256, canonicalize, publicConfigSha256 as digest, validateQualificationReceipt, validateReleaseManifest } from '../release-manifest.mjs';
import { validateGenesisAuthorization } from '../genesis-contract.mjs';
import { validManifest } from './b2-fixture.mjs';
import { observation, rehearsal, NOW, bytes, H } from './genesis-fixture.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(repo, 'scripts/ci/authorize-genesis.mjs');
const issuer = 'https://token.actions.githubusercontent.com';
const identity = kind => `https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-${kind}.yml@refs/heads/main`;

// Genuine ephemeral Ed25519 signatures ONLY at the cosign executable boundary.
// These fixtures prove local byte/identity rejection; NOT Sigstore, Fulcio, Rekor or OIDC.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'genesis-admission-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = join(root, 'candidate'); mkdirSync(candidate);
  const put = (name, content) => { const path = join(candidate, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return digest(content); };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const bundle = (content, kind = 'candidate') => bytes({ issuer, identity: identity(kind), signature: sign(null, Buffer.from(content), privateKey).toString('base64') });
  const seal = (name, kind = 'candidate') => put(name.replace(/\.json$/u, '.signature.bundle.json'), bundle(readFileSync(join(candidate, name)), kind));
  const m = validManifest();
  m.schemaVersion = 'harmonic-beacon.release.genesis.v1'; m.promotion.baseManifestSha256 = null; m.rollback.manifestSha256 = null;
  m.build.createdAt = new Date(NOW - 3600000).toISOString();
  m.qualification.qualifiedAt = new Date(NOW - 1800000).toISOString(); m.qualification.expiresAt = new Date(NOW + 3600000).toISOString();
  m.deploymentInputs.composeSha256 = put('docker-compose.yml', readFileSync(join(repo, 'docker-compose.yml')));
  m.deploymentInputs.overlaySha256 = put('deploy/oci-images.compose.yml', readFileSync(join(repo, 'deploy/oci-images.compose.yml')));
  for (const p of ['production', 'live-staging']) m.configProfiles[p].sha256 = put(`deploy/runtime-public-config/${p}.json`, readFileSync(join(repo, `deploy/runtime-public-config/${p}.json`)));
  for (const a of m.artifacts) {
    const prefix = `evidence/oci-evidence-${a.artifactId}/`;
    const statement = predicateType => ({ _type: 'https://in-toto.io/Statement/v1', subject: [{ name: a.repository, digest: { sha256: a.digest.slice(7) } }], predicateType });
    const sbom = { ...statement('https://spdx.dev/Document'), predicate: { spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: [{}] } };
    const provenance = { ...statement('https://slsa.dev/provenance/v1'), predicate: { buildDefinition: { externalParameters: { source: { repository: m.source.repository, ref: 'refs/heads/main', gitSha: m.source.gitSha, gitTree: m.source.gitTree }, context: '.', dockerfile: a.dockerfile, platform: 'linux/amd64' } }, runDetails: { builder: { id: identity('candidate') }, metadata: { workflowRunId: m.build.workflowRunId, workflowRunAttempt: m.build.workflowRunAttempt, buildkitProvenance: {} } } } };
    a.sbom.digest = put(`${prefix}sbom.bundle.json`, bytes(sbom));
    a.provenance.digest = put(`${prefix}provenance.bundle.json`, bytes(provenance));
    a.sbom.signatureBundleDigest = put(`${prefix}sbom.signature.bundle.json`, bundle(bytes(sbom)));
    a.provenance.signatureBundleDigest = put(`${prefix}provenance.signature.bundle.json`, bundle(bytes(provenance)));
    a.signature.bundleDigest = put(`${prefix}signature.bundle.json`, bundle(`${a.repository}@${a.digest}`));
    a.evidenceRecordDigest = put(`${prefix}evidence.json`, bytes({ artifactId: a.artifactId, repository: a.repository, digest: a.digest, dockerfile: a.dockerfile, sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, workflowRunId: m.build.workflowRunId, workflowRunAttempt: m.build.workflowRunAttempt, sbomDigest: a.sbom.digest, sbomSignatureBundleDigest: a.sbom.signatureBundleDigest, provenanceDigest: a.provenance.digest, provenanceSignatureBundleDigest: a.provenance.signatureBundleDigest, signatureBundleDigest: a.signature.bundleDigest }));
  }
  m.qualification.candidateIdentitySha256 = candidateIdentitySha256(m);
  const q = { schemaVersion: 'oci-qualification.v3', result: 'success', workflowRunId: m.build.workflowRunId, workflowRunAttempt: 1, candidateIdentitySha256: candidateIdentitySha256(m),
    imageRefs: Object.fromEntries([...m.artifacts, ...m.externalImages].map(a => [a.artifactId ?? a.serviceId, `${a.repository}@${a.digest}`])),
    checkedServices: ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'], qualificationJob: 'qualify',
    measurementStartedAt: new Date(NOW - 3500000).toISOString(), measurementCompletedAt: new Date(NOW - 1900000).toISOString(), issuedAt: m.qualification.qualifiedAt,
    acceptance: { browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 }, syntheticSession: { created: 1, authenticatedRole: 'ADMIN' }, commerce: { workerHeartbeatAgeMs: 1, pending: 0, processing: 0 }, schema: { expectedHead: m.migrationSet.head, observedHead: m.migrationSet.head }, isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] }, restore: { backupSha256: H('dump'), backupBytes: 4, restoredSessionCount: 1 } },
  };
  m.qualification.receiptSha256 = put('qualification-receipt.json', bytes(q));
  const manifestSha256 = put('release-manifest.json', bytes(m)).slice(7);
  validateReleaseManifest(m); validateQualificationReceipt(q, m);
  seal('release-manifest.json'); seal('qualification-receipt.json');
  const o = observation();
  for (const d of m.externalImages) o.services[d.serviceId].dependencyResolution.indexRef = `${d.repository}@${d.digest}`;
  const r = { ...rehearsal(), manifestSha256, sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, candidateRunId: m.build.workflowRunId, candidateRunAttempt: m.build.workflowRunAttempt };
  put('genesis/observation.json', bytes(o)); put('genesis/rehearsal.json', bytes(r)); seal('genesis/rehearsal.json', 'promote');
  const bin = join(root, 'bin'); mkdirSync(bin);
  const log = join(root, 'verification.log');
  const publicPath = join(root, 'public.pem'); writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(bin, 'cosign'), `#!/usr/bin/env node
const fs=require('node:fs'),crypto=require('node:crypto'),a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a)+'\\n');
const b=JSON.parse(fs.readFileSync(a[a.indexOf('--bundle')+1]));
const data=a[0]==='verify'?Buffer.from(a.at(-1)):fs.readFileSync(a.at(-1));
if(!['verify','verify-blob'].includes(a[0]) || b.issuer!==a[a.indexOf('--certificate-oidc-issuer')+1] || b.identity!==a[a.indexOf('--certificate-identity')+1] || !crypto.verify(null,data,fs.readFileSync(${JSON.stringify(publicPath)}),Buffer.from(b.signature,'base64'))) process.exit(9);
`); chmodSync(join(bin, 'cosign'), 0o755);
  const preload = join(root, 'clock.cjs'); writeFileSync(preload, `Date.now=()=>${NOW};`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--require=${preload}`,
    GITHUB_REPOSITORY: m.source.repository, GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: `${m.source.repository}/.github/workflows/oci-promote.yml@refs/heads/main`, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: m.source.gitSha,
    GITHUB_RUN_ID: r.deliveryRunId, GITHUB_RUN_ATTEMPT: String(r.deliveryRunAttempt),
    CANDIDATE_RUN_ID: m.build.workflowRunId, CANDIDATE_RUN_ATTEMPT: String(m.build.workflowRunAttempt), SOURCE_SHA: m.source.gitSha, SOURCE_TREE: m.source.gitTree,
    MANIFEST_SHA256: manifestSha256, CONFIG_SHA256: m.configProfiles.production.sha256, TARGET: 'production', ENVIRONMENT: 'production', OPERATION: 'genesis',
    GENESIS_ID: o.gateState.genesisId, PERMIT_SHA256: o.gateState.permitSha256, PROFILE_SHA256: o.profileSha256, IMPLEMENTATION_SHA256: o.implementationSha256, HARNESS_SHA256: r.harnessSha256,
    LEGACY_OBSERVATION_SHA256: digest(bytes(o)), HOSTED_REHEARSAL_SHA256: digest(bytes(r)),
  };
  const output = join(candidate, 'genesis-authorization.json');
  const issue = (extra = {}) => spawnSync(process.execPath, [cli], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, candidate, m, q, o, r, put, seal, bundle, env, output, issue, log };
}

test('shared descriptor reader rejects growth after fstat instead of unbounded snapshot reads', t => {
  const f = fixture(t), path = join(f.root, 'racing.json'); writeFileSync(path, 'x');
  const source = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; import assert from 'node:assert/strict';
const original=fs.fstatSync; let first=true;
fs.fstatSync=(fd)=>{const stat=original(fd);if(first){first=false;fs.appendFileSync(${JSON.stringify(path)},'y');}return stat;}; syncBuiltinESMExports();
const {readRegular}=await import(${JSON.stringify(new URL('../../../deploy/hb-artifact-verify.mjs', import.meta.url).href)});
assert.throws(()=>readRegular(${JSON.stringify(path)},1), /changed|unsafe/);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('CLI rechecks freshness after signature verification before issuing authority', t => {
  const f = fixture(t);
  // A test-only clock boundary simulates verification/queue delay without sleeping.
  writeFileSync(join(f.root, 'clock.cjs'), `let calls=0;Date.now=()=>++calls===1?${NOW}:${NOW + 900001};`);
  const result = f.issue();
  assert.notEqual(result.status, 0, 'observation expired during verification');
  assert.equal(existsSync(f.output), false);
});

test('CLI refuses malformed attempt spellings instead of normalizing them', t => {
  const f = fixture(t);
  for (const [key, value] of [['CANDIDATE_RUN_ATTEMPT', '01'], ['CANDIDATE_RUN_ATTEMPT', '1e0'], ['GITHUB_RUN_ATTEMPT', '02']]) {
    rmSync(f.output, { force: true });
    const result = f.issue({ [key]: value });
    assert.notEqual(result.status, 0, `${key}=${value}`);
    assert.equal(existsSync(f.output), false);
  }
});

test('actual hosted CLI authenticates complete real-shaped genesis inventory using local signatures, not OIDC', t => {
  assert.ok(existsSync(cli), 'genesis authorizer CLI is missing');
  const f = fixture(t);
  const result = f.issue(); assert.equal(result.status, 0, result.stderr);
  const a = validateGenesisAuthorization(readFileSync(f.output), {}, { now: NOW });
  assert.equal(a.manifestSha256, f.env.MANIFEST_SHA256);
  assert.equal(a.legacyRuntimeSha256, f.o.configCommitment);
  assert.equal(a.legacyObservationSha256, digest(bytes(f.o)));
  assert.equal(a.hostedRehearsalSha256, digest(bytes(f.r)));
  assert.equal(a.expectedPublication, null); assert.equal(a.expectedLedgerSha256, null);
  assert.equal(a.permitSha256, f.o.gateState.permitSha256);
  assert.equal(Date.parse(a.expiresAt) - Date.parse(a.authorizedAt), 900000);
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 15); assert.equal(calls.filter(a => a[0] === 'verify').length, 4);
  assert.ok(calls.some(a => a.includes(identity('promote'))));
  const original = readFileSync(f.output);
  assert.notEqual(f.issue().status, 0, 'must not overwrite issued bytes'); assert.deepEqual(readFileSync(f.output), original);
  assert.equal(readFileSync(f.output, 'utf8'), canonicalize(a));
});

function reseal(f) {
  f.m.qualification.candidateIdentitySha256 = candidateIdentitySha256(f.m);
  f.q.candidateIdentitySha256 = candidateIdentitySha256(f.m);
  f.m.qualification.receiptSha256 = f.put('qualification-receipt.json', bytes(f.q));
  f.env.MANIFEST_SHA256 = f.put('release-manifest.json', bytes(f.m)).slice(7);
  f.seal('qualification-receipt.json'); f.seal('release-manifest.json');
  f.r.manifestSha256 = f.env.MANIFEST_SHA256;
  refreshReported(f);
}
function refreshReported(f) {
  f.env.LEGACY_OBSERVATION_SHA256 = f.put('genesis/observation.json', bytes(f.o));
  f.env.HOSTED_REHEARSAL_SHA256 = f.put('genesis/rehearsal.json', bytes(f.r));
  f.seal('genesis/rehearsal.json', 'promote');
}

for (const [key, wrong] of Object.entries({
  SOURCE_SHA: 'c'.repeat(40), SOURCE_TREE: 'd'.repeat(40), CANDIDATE_RUN_ID: '345', CANDIDATE_RUN_ATTEMPT: '2',
  GITHUB_RUN_ID: '765', GITHUB_RUN_ATTEMPT: '3', GITHUB_REPOSITORY: 'evil/repo', GITHUB_REF: 'refs/heads/evil',
  GITHUB_WORKFLOW_REF: 'evil/workflow@refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'e'.repeat(40),
  TARGET: 'shadow', ENVIRONMENT: 'shadow', OPERATION: 'promote', MANIFEST_SHA256: 'f'.repeat(64), CONFIG_SHA256: H('wrong'),
  GENESIS_ID: 'f'.repeat(64), PERMIT_SHA256: H('wrong'), PROFILE_SHA256: H('wrong'), IMPLEMENTATION_SHA256: H('wrong'), HARNESS_SHA256: H('wrong'),
  LEGACY_OBSERVATION_SHA256: H('wrong'), HOSTED_REHEARSAL_SHA256: H('wrong'),
})) test(`CLI rejects mismatched ${key} with no output`, t => {
  const f = fixture(t), result = f.issue({ [key]: wrong });
  assert.notEqual(result.status, 0, result.stderr); assert.equal(existsSync(f.output), false);
});

for (const target of ['release-manifest', 'qualification-receipt', 'genesis/rehearsal']) {
  for (const mode of ['unsigned', 'tampered', 'wrong-identity', 'wrong-issuer']) test(`CLI rejects ${target} ${mode}`, t => {
    const f = fixture(t), name = `${target}.signature.bundle.json`;
    if (mode === 'unsigned') rmSync(join(f.candidate, name));
    else if (mode === 'tampered') writeFileSync(join(f.candidate, `${target}.json`), '{}');
    else { const b = JSON.parse(readFileSync(join(f.candidate, name))); b[mode === 'wrong-identity' ? 'identity' : 'issuer'] = 'https://evil.invalid'; f.put(name, bytes(b)); }
    assert.notEqual(f.issue().status, 0); assert.equal(existsSync(f.output), false);
  });
}

for (const kind of ['image', 'sbom', 'provenance']) test(`CLI really invokes existing ${kind} cryptographic verifier after all digests are rebound`, t => {
  const f = fixture(t), a = f.m.artifacts[0], prefix = 'evidence/oci-evidence-app/';
  const file = kind === 'image' ? 'signature.bundle.json' : `${kind}.signature.bundle.json`;
  const record = JSON.parse(readFileSync(join(f.candidate, prefix, 'evidence.json')));
  const hash = f.put(prefix + file, f.bundle('wrong signed content'));
  if (kind === 'image') { a.signature.bundleDigest = hash; record.signatureBundleDigest = hash; }
  else { a[kind].signatureBundleDigest = hash; record[`${kind}SignatureBundleDigest`] = hash; }
  a.evidenceRecordDigest = f.put(prefix + 'evidence.json', bytes(record)); reseal(f);
  assert.notEqual(f.issue().status, 0); assert.equal(existsSync(f.output), false);
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(argv => argv.includes(join(dirname(argv[argv.indexOf('--bundle') + 1]), file))), 'signature rejection reached cosign');
});

for (const [name, mutate] of [
  ['ordinary candidate', f => { f.m.schemaVersion = 'harmonic-beacon.release.v1'; f.m.promotion.baseManifestSha256 = H('prior').slice(7); f.m.rollback.manifestSha256 = H('prior').slice(7); reseal(f); }],
  ['expired qualification', f => { f.m.qualification.expiresAt = new Date(NOW - 1).toISOString(); reseal(f); }],
  ['future qualification', f => { f.m.qualification.qualifiedAt = f.q.issuedAt = new Date(NOW + 1).toISOString(); reseal(f); }],
  ['incomplete qualification', f => { f.q.acceptance.browser.skipped = 1; reseal(f); }],
  ['changed config bytes', f => f.put('deploy/runtime-public-config/production.json', bytes({ secret: 'not output' }))],
  ['changed compose bytes', f => f.put('docker-compose.yml', 'unreviewed compose')],
  ['noncanonical signed manifest', f => { f.put('release-manifest.json', JSON.stringify(f.m)); f.seal('release-manifest.json'); }],
  ['future observation', f => { f.o.observedAt = new Date(NOW + 1).toISOString(); refreshReported(f); }],
  ['stale observation', f => { f.o.observedAt = new Date(NOW - 900001).toISOString(); refreshReported(f); }],
  ['uninstalled permit', f => { f.o.gateState.permitSha256 = null; refreshReported(f); }],
  ['dependency upgrade', f => { f.o.services.postgres.dependencyResolution.indexRef = `docker.io/library/postgres@${H('upgrade')}`; refreshReported(f); }],
  ['reported secret/environment field', f => { f.o.services.app.environment = { PASSWORD: 'must-not-leak' }; refreshReported(f); }],
  ['reported live participant', f => { f.o.boundary.realLivekitParticipants = 1; refreshReported(f); }],
  ['same delivery wrong rehearsal attempt', f => { f.r.deliveryRunAttempt++; refreshReported(f); }],
  ['Mona-equivalence rehearsal claim', f => { f.r.scope = 'mona-isolated-exact'; refreshReported(f); }],
  ['signed rehearsal failure', f => { f.r.failureRecovery.result = 'failed'; refreshReported(f); }],
  ['initial adoption with surviving ledger/publication', f => { f.o.gateState.ledgerSha256 = H('ledger'); f.o.gateState.publication = { generation: 1, id: H('published').slice(7), manifestSha256: f.env.MANIFEST_SHA256 }; refreshReported(f); }],
  ['recovery without ledger', f => { f.env.OPERATION = 'genesis-recover'; }],
  ['extra evidence file', f => f.put('evidence/oci-evidence-app/exec.sh', 'not executable')],
  ['extra evidence directory', f => mkdirSync(join(f.candidate, 'evidence/extra'))],
  ['oversized observation', f => f.put('genesis/observation.json', Buffer.alloc(1048577))],
]) test(`CLI rejects ${name}`, t => {
  const f = fixture(t); mutate(f); const result = f.issue();
  assert.notEqual(result.status, 0); assert.equal(existsSync(f.output), false);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-leak|not output/);
});

for (const type of ['symlink', 'hardlink', 'fifo', 'directory-symlink']) test(`CLI rejects ${type} download input`, t => {
  const f = fixture(t), path = join(f.candidate, 'genesis/observation.json');
  if (type === 'directory-symlink') {
    const dest = join(f.root, 'observations'); mkdirSync(dest);
    for (const name of ['observation.json', 'rehearsal.json', 'rehearsal.signature.bundle.json']) writeFileSync(join(dest, name), readFileSync(join(f.candidate, 'genesis', name)));
    rmSync(join(f.candidate, 'genesis'), { recursive: true }); symlinkSync(dest, join(f.candidate, 'genesis'));
  } else {
    rmSync(path);
    if (type === 'fifo') assert.equal(spawnSync('mkfifo', [path]).status, 0);
    else (type === 'symlink' ? symlinkSync : linkSync)(join(f.candidate, 'genesis/rehearsal.json'), path);
  }
  assert.notEqual(f.issue().status, 0); assert.equal(existsSync(f.output), false);
});

test('committed recovery can authenticate historical G without renewing fresh adoption or forward-repair', t => {
  const f = fixture(t);
  const age = 172800000;
  for (const [obj, key] of [[f.m.build, 'createdAt'], [f.m.qualification, 'qualifiedAt'], [f.m.qualification, 'expiresAt'], [f.q, 'issuedAt'], [f.q, 'measurementStartedAt'], [f.q, 'measurementCompletedAt']]) obj[key] = new Date(Date.parse(obj[key]) - age).toISOString();
  reseal(f);
  f.o.gateState.ledgerSha256 = H('committed ledger');
  f.o.gateState.publication = { generation: 1, id: H('committed publication').slice(7), manifestSha256: f.env.MANIFEST_SHA256 };
  refreshReported(f);
  const result = f.issue({ OPERATION: 'genesis-recover' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(validateGenesisAuthorization(readFileSync(f.output), {}, { now: NOW }).operation, 'genesis-recover');
  rmSync(f.output);
  assert.notEqual(f.issue({ OPERATION: 'genesis-forward-repair' }).status, 0); assert.equal(existsSync(f.output), false);
});

for (const operation of ['genesis-recover', 'genesis-forward-repair']) test(`CLI admits only same-G exact ${operation} publication and ledger commitments`, t => {
  const f = fixture(t);
  f.o.gateState.ledgerSha256 = H('ledger'); f.o.gateState.publication = { generation: 2, id: H('publication').slice(7), manifestSha256: f.env.MANIFEST_SHA256 };
  refreshReported(f);
  const result = f.issue({ OPERATION: operation }); assert.equal(result.status, 0, result.stderr);
  const a = validateGenesisAuthorization(readFileSync(f.output), {}, { now: NOW });
  assert.deepEqual(a.expectedPublication, f.o.gateState.publication); assert.equal(a.expectedLedgerSha256, f.o.gateState.ledgerSha256);
  assert.equal(a.operation, operation);
  rmSync(f.output); f.o.gateState.publication.manifestSha256 = H('later-successor').slice(7); refreshReported(f);
  assert.notEqual(f.issue({ OPERATION: operation }).status, 0); assert.equal(existsSync(f.output), false);
});
