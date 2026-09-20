#!/usr/bin/env node
// Hosted-only issuer. The protected workflow must resolve successful exact runs/checks
// and obtain production approval BEFORE invoking this CLI. Its output is unsigned;
// the existing hosted delivery identity signs it. No host attestation is inferred.
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, publicConfigSha256 as digest, validateReleaseManifest, validateQualificationReceipt, verifyGenesisReleaseManifest } from './release-manifest.mjs';
import { readRegular, registryEvidence, verifyFinalCandidateBlobs } from '../../deploy/hb-artifact-verify.mjs';
import { validateLegacyObservation, validateGenesisRehearsal, validateGenesisAuthorization } from './genesis-contract.mjs';

const REPO = 'AlterMundi/harmonic-beacon-webapp';
const WORKFLOW = '.github/workflows/oci-promote.yml';
const REF = 'refs/heads/main';
const IDENTITY = `https://github.com/${REPO}/${WORKFLOW}@${REF}`;
const GIT = /^[0-9a-f]{40}$/u;
const fail = () => { throw Error('genesis admission rejected'); };
const equal = (a, b) => { if (canonicalize(a) !== canonicalize(b)) fail(); };
function json(bytes) {
  const value = JSON.parse(bytes);
  if (!Buffer.from(canonicalize(value)).equals(bytes)) fail();
  return value;
}

// Copy a fixed, bounded inventory before authentication. Verification and parsing
// then consume the same private snapshots, never mutable download paths. This is
// a hosted staging boundary, NOT privileged descriptor admission on Mona.
function snapshot(root) {
  const copy = (source, target = source, maximum = 1048576) => {
    const parts = source.split('/');
    for (let n = 0; n < parts.length; n++) {
      const directory = join('candidate', ...parts.slice(0, n));
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    }
    const bytes = readRegular(join('candidate', source), maximum);
    mkdirSync(dirname(join(root, target)), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, target), bytes, { flag: 'wx', mode: 0o600 });
    return bytes;
  };
  const manifestBytes = copy('release-manifest.json', 'candidate-manifest.json');
  const qualificationBytes = copy('qualification-receipt.json');
  for (const name of ['release-manifest', 'qualification-receipt']) copy(`${name}.signature.bundle.json`, `${name}.signature.bundle.json`, 16777216);
  const observationBytes = copy('genesis/observation.json');
  const rehearsalBytes = copy('genesis/rehearsal.json');
  copy('genesis/rehearsal.signature.bundle.json', 'genesis/rehearsal.signature.bundle.json', 16777216);
  const folders = ['app', 'tapestry', 'playlist-bot', 'analytics'].map(a => `oci-evidence-${a}`);
  equal(readdirSync('candidate/evidence').sort(), [...folders].sort());
  const evidenceFiles = ['evidence.json', 'signature.bundle.json', 'sbom.bundle.json', 'sbom.signature.bundle.json', 'provenance.bundle.json', 'provenance.signature.bundle.json'];
  for (const folder of folders) {
    equal(readdirSync(join('candidate/evidence', folder)).sort(), [...evidenceFiles].sort());
    for (const name of evidenceFiles) copy(`evidence/${folder}/${name}`, `evidence/${folder}/${name}`, 16777216);
  }
  const inputs = Object.fromEntries(['docker-compose.yml', 'deploy/oci-images.compose.yml', 'deploy/runtime-public-config/production.json', 'deploy/runtime-public-config/live-staging.json'].map(name => [name, copy(name)]));
  return { manifestBytes, qualificationBytes, observationBytes, rehearsalBytes, inputs };
}

export function main(env = process.env) {
  const started = Date.now();
  for (const key of ['CANDIDATE_RUN_ATTEMPT', 'GITHUB_RUN_ATTEMPT']) {
    if (typeof env[key] !== 'string' || !/^[1-9][0-9]{0,9}$/u.test(env[key])) fail();
  }
  if (env.GITHUB_REPOSITORY !== REPO || env.GITHUB_REF !== REF || env.GITHUB_WORKFLOW_REF !== `${REPO}/${WORKFLOW}@${REF}` || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.TARGET !== 'production' || env.ENVIRONMENT !== 'production') fail();
  if (!GIT.test(env.GITHUB_SHA) || !GIT.test(env.AUTHORIZER_SOURCE_SHA) || !GIT.test(env.AUTHORIZER_SOURCE_TREE) || env.GITHUB_SHA !== env.AUTHORIZER_SOURCE_SHA) fail();
  const scratch = mkdtempSync(join(tmpdir(), 'hb-genesis-admission-'));
  try {
    const input = snapshot(scratch);
    // Authenticate final blobs and rehearsal BEFORE parsing any of their JSON.
    verifyFinalCandidateBlobs(scratch);
    execFileSync('cosign', ['verify-blob', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', '--certificate-identity', IDENTITY,
      '--bundle', join(scratch, 'genesis/rehearsal.signature.bundle.json'), join(scratch, 'genesis/rehearsal.json')], { stdio: 'pipe' });
    const m = validateReleaseManifest(json(input.manifestBytes));
    equal(digest(input.qualificationBytes), m.qualification.receiptSha256);
    validateQualificationReceipt(json(input.qualificationBytes), m);
    const evidence = registryEvidence(join(scratch, 'evidence'), m);
    // Registry/certificate verification can queue or take time. Admission freshness
    // is evaluated afterwards, and clock regression never renews an observation.
    const now = Date.now();
    if (!Number.isSafeInteger(started) || now < started) fail();
    verifyGenesisReleaseManifest(m, { sourceRepository: REPO, sourceSha: env.SOURCE_SHA, sourceTree: env.SOURCE_TREE,
      workflowRunId: env.CANDIDATE_RUN_ID, workflowRunAttempt: Number(env.CANDIDATE_RUN_ATTEMPT), target: 'production',
      targetConfigSha256: env.CONFIG_SHA256, manifestSha256: env.MANIFEST_SHA256, operation: env.OPERATION, now,
      registryEvidence: evidence });
    for (const [name, hash] of [['docker-compose.yml', m.deploymentInputs.composeSha256], ['deploy/oci-images.compose.yml', m.deploymentInputs.overlaySha256],
      ...Object.entries(m.configProfiles).map(([p, v]) => [`deploy/runtime-public-config/${p}.json`, v.sha256])]) equal(digest(input.inputs[name]), hash);
    if (env.OPERATION === 'genesis') {
      equal(env.GITHUB_SHA, m.source.gitSha);
      equal(env.AUTHORIZER_SOURCE_TREE, m.source.gitTree);
    }
    const o = validateLegacyObservation(input.observationBytes, { now });
    equal(digest(input.observationBytes), env.LEGACY_OBSERVATION_SHA256);
    equal(digest(input.rehearsalBytes), env.HOSTED_REHEARSAL_SHA256);
    equal(o.gateState.genesisId, env.GENESIS_ID); equal(o.gateState.permitSha256, env.PERMIT_SHA256);
    equal(o.profileSha256, env.PROFILE_SHA256); equal(o.implementationSha256, env.IMPLEMENTATION_SHA256);
    // Same reported dependency content, never an upgrade disguised as adoption.
    for (const d of m.externalImages) equal(o.services[d.serviceId].dependencyResolution.indexRef, `${d.repository}@${d.digest}`);
    const binding = { sourceSha: m.source.gitSha, sourceTree: m.source.gitTree,
      authorizerSourceSha: env.AUTHORIZER_SOURCE_SHA, authorizerSourceTree: env.AUTHORIZER_SOURCE_TREE,
      manifestSha256: env.MANIFEST_SHA256,
      candidateRunId: m.build.workflowRunId, candidateRunAttempt: m.build.workflowRunAttempt,
      deliveryRunId: env.GITHUB_RUN_ID, deliveryRunAttempt: Number(env.GITHUB_RUN_ATTEMPT),
      implementationSha256: o.implementationSha256, profileSha256: o.profileSha256 };
    validateGenesisRehearsal(input.rehearsalBytes, { ...binding, harnessSha256: env.HARNESS_SHA256 }, { now });
    const a = { schemaVersion: 'harmonic-beacon.genesis-authorization.v1', host: 'mona', genesisId: o.gateState.genesisId,
      operation: env.OPERATION, target: 'production', workflowPath: WORKFLOW, workflowRef: REF, environment: 'production', ...binding,
      configSha256: m.configProfiles.production.sha256, legacyObservationSha256: digest(input.observationBytes), legacyRuntimeSha256: o.configCommitment,
      hostedRehearsalSha256: digest(input.rehearsalBytes), expectedPublication: o.gateState.publication, expectedLedgerSha256: o.gateState.ledgerSha256, permitSha256: o.gateState.permitSha256,
      verbs: env.OPERATION === 'genesis-recover' ? ['prepare', 'recover', 'status'] : ['prepare', 'apply', 'status', 'recover'],
      authorizedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900000).toISOString() };
    const bytes = canonicalize(a);
    validateGenesisAuthorization(bytes, {}, { now });
    writeFileSync('candidate/genesis-authorization.json', bytes, { flag: 'wx', mode: 0o600 });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 2) fail(); main(); }
  catch { console.error('Protected genesis authorization failed; no authorization issued'); process.exitCode = 1; }
}
