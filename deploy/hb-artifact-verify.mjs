#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const installedModuleUrl = new URL('./release-manifest.mjs', import.meta.url);
const manifestModuleUrl = existsSync(fileURLToPath(installedModuleUrl))
  ? installedModuleUrl
  : new URL('../scripts/ci/release-manifest.mjs', import.meta.url);
const {
  publicConfigSha256, validateReleaseManifest, verifyReleaseManifest, validateQualificationReceipt,
  verifyRuntimePublicConfig,
} = await import(manifestModuleUrl.href);

const IDENTITY = 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';
const EXPECTED_EVIDENCE_FILES = [
  'evidence.json', 'provenance.bundle.json', 'provenance.signature.bundle.json',
  'sbom.bundle.json', 'sbom.signature.bundle.json', 'signature.bundle.json',
];

function fail(message) {
  throw new Error(`hb-artifact-verify: ${message}`);
}

function readRegular(path, maximum = 1024 * 1024) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) fail(`unsafe input file: ${basename(path)}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const after = fstatSync(fd);
    if (!after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino || after.size > maximum) {
      fail(`input changed while opening: ${basename(path)}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function option(argv, name, required = true) {
  const indexes = argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) fail(`duplicate option: ${name}`);
  const index = indexes[0] ?? -1;
  if (index < 0 || !argv[index + 1]) {
    if (required) fail(`${name} is required`);
    return undefined;
  }
  return argv[index + 1];
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields are invalid`);
}

function exactEvidenceDirectories(root) {
  const rootEntries = readdirSync(root, { withFileTypes: true });
  if (rootEntries.length !== 4 || rootEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    fail('evidence must contain exactly four artifact directories');
  }
  return rootEntries.map((entry) => join(root, entry.name));
}

function exactAdmittedInventory(root) {
  const expected = [
    'candidate-manifest.json', 'docker-compose.yml', 'evidence', 'live-staging.json',
    'oci-images.compose.yml', 'production.json', 'qualification-receipt.json', 'target-public-config.json',
  ].sort();
  const entries = readdirSync(root, { withFileTypes: true });
  if (JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expected) ||
      entries.some((entry) => entry.isSymbolicLink() ||
        (entry.name === 'evidence' ? !entry.isDirectory() : !entry.isFile()))) {
    fail('admitted deployment inventory is not closed');
  }
}

function subjectMatches(statement, record) {
  return Array.isArray(statement.subject) && statement.subject.length === 1 &&
    statement.subject[0]?.name === record.repository &&
    statement.subject[0]?.digest?.sha256 === record.digest.slice('sha256:'.length);
}

export function validateEvidenceStatement(statement, record, kind) {
  exactKeys(statement, ['_type', 'subject', 'predicateType', 'predicate'], `${kind} statement`);
  if (statement._type !== 'https://in-toto.io/Statement/v1' || !subjectMatches(statement, record)) {
    fail(`${kind} subject does not bind the image digest`);
  }
  if (kind === 'SBOM') {
    if (statement.predicateType !== 'https://spdx.dev/Document' ||
        statement.predicate?.spdxVersion !== 'SPDX-2.3' ||
        statement.predicate?.SPDXID !== 'SPDXRef-DOCUMENT' ||
        !Array.isArray(statement.predicate?.packages) || statement.predicate.packages.length === 0) {
      fail('SBOM is not a structurally valid SPDX document');
    }
    return;
  }
  if (statement.predicateType !== 'https://slsa.dev/provenance/v1') fail('provenance predicate type is invalid');
  const external = statement.predicate?.buildDefinition?.externalParameters;
  const run = statement.predicate?.runDetails;
  if (external?.source?.repository !== 'AlterMundi/harmonic-beacon-webapp' ||
      external.source.ref !== 'refs/heads/main' || external.source.gitSha !== record.sourceSha ||
      external.source.gitTree !== record.sourceTree || external.context !== '.' ||
      external.dockerfile !== record.dockerfile || external.platform !== 'linux/amd64' ||
      run?.builder?.id !== IDENTITY || run?.metadata?.workflowRunId !== record.workflowRunId ||
      run.metadata.workflowRunAttempt !== record.workflowRunAttempt ||
      !run.metadata.buildkitProvenance || typeof run.metadata.buildkitProvenance !== 'object') {
    fail('provenance does not bind source, workflow, build inputs, and platform');
  }
}

function verifyCosignBlob(path, bundle) {
  execFileSync('cosign', [
    'verify-blob', '--bundle', bundle, '--certificate-oidc-issuer', ISSUER,
    '--certificate-identity', IDENTITY, path,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function registryEvidence(root, manifest) {
  const records = {};
  for (const folder of exactEvidenceDirectories(root)) {
    const entries = readdirSync(folder, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
        JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(EXPECTED_EVIDENCE_FILES)) {
      fail('artifact evidence inventory is not closed');
    }
    const recordBytes = readRegular(join(folder, 'evidence.json'));
    const record = JSON.parse(recordBytes);
    exactKeys(record, [
      'artifactId', 'repository', 'digest', 'dockerfile', 'sourceSha', 'sourceTree',
      'workflowRunId', 'workflowRunAttempt', 'sbomDigest', 'sbomSignatureBundleDigest',
      'provenanceDigest', 'provenanceSignatureBundleDigest', 'signatureBundleDigest',
    ], 'evidence record');
    const expected = manifest.artifacts.find((entry) => entry.artifactId === record.artifactId);
    if (!expected || records[record.artifactId]) fail('invalid or duplicate registry evidence');
    if (sha256(recordBytes) !== expected.evidenceRecordDigest) fail('evidence record digest mismatch');
    if (basename(folder) !== `oci-evidence-${record.artifactId}`) fail('unexpected evidence directory');
    const files = {
      sbomDigest: 'sbom.bundle.json',
      sbomSignatureBundleDigest: 'sbom.signature.bundle.json',
      provenanceDigest: 'provenance.bundle.json',
      provenanceSignatureBundleDigest: 'provenance.signature.bundle.json',
      signatureBundleDigest: 'signature.bundle.json',
    };
    for (const [field, filename] of Object.entries(files)) {
      if (record[field] !== sha256(readRegular(join(folder, filename), 16 * 1024 * 1024))) {
        fail(`${record.artifactId} ${field} file mismatch`);
      }
    }
    if (record.repository !== expected.repository || record.digest !== expected.digest ||
        record.dockerfile !== expected.dockerfile || record.sourceSha !== manifest.source.gitSha ||
        record.sourceTree !== manifest.source.gitTree || record.workflowRunId !== manifest.build.workflowRunId ||
        record.workflowRunAttempt !== manifest.build.workflowRunAttempt) {
      fail(`${record.artifactId} evidence provenance fields mismatch`);
    }
    const imageRef = `${record.repository}@${record.digest}`;
    execFileSync('cosign', [
      'verify', '--bundle', join(folder, 'signature.bundle.json'),
      '--certificate-oidc-issuer', ISSUER, '--certificate-identity', IDENTITY, imageRef,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    verifyCosignBlob(join(folder, 'sbom.bundle.json'), join(folder, 'sbom.signature.bundle.json'));
    verifyCosignBlob(join(folder, 'provenance.bundle.json'), join(folder, 'provenance.signature.bundle.json'));
    validateEvidenceStatement(JSON.parse(readRegular(join(folder, 'sbom.bundle.json'), 16 * 1024 * 1024)), record, 'SBOM');
    validateEvidenceStatement(JSON.parse(readRegular(join(folder, 'provenance.bundle.json'), 16 * 1024 * 1024)), record, 'provenance');
    records[record.artifactId] = {
      repository: record.repository,
      imageDigest: record.digest,
      sbomDigest: record.sbomDigest,
      sbomSignatureBundleDigest: record.sbomSignatureBundleDigest,
      provenanceDigest: record.provenanceDigest,
      provenanceSignatureBundleDigest: record.provenanceSignatureBundleDigest,
      signatureBundleDigest: record.signatureBundleDigest,
    };
  }
  return records;
}

function verifyInputDigest(path, expected, label) {
  if (publicConfigSha256(readRegular(path, 4 * 1024 * 1024)) !== expected) fail(`${label} byte digest mismatch`);
}

export function main(argv = process.argv.slice(2)) {
  const manifestPath = resolve(option(argv, '--manifest'));
  const evidenceRoot = resolve(option(argv, '--evidence'));
  const expectedManifestSha256 = option(argv, '--manifest-sha256');
  const currentManifestPath = resolve(option(argv, '--current-manifest'));
  const output = resolve(option(argv, '--output'));
  exactAdmittedInventory(dirname(manifestPath));
  if (evidenceRoot !== join(dirname(manifestPath), 'evidence')) fail('unexpected admitted evidence root');
  const manifestBytes = readRegular(manifestPath);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== expectedManifestSha256) fail('manifest byte hash mismatch');
  const manifest = JSON.parse(manifestBytes);
  validateReleaseManifest(manifest);

  const currentBytes = readRegular(currentManifestPath);
  const currentBaseManifestSha256 = createHash('sha256').update(currentBytes).digest('hex');
  const currentManifest = JSON.parse(currentBytes);
  validateReleaseManifest(currentManifest);
  if (currentBaseManifestSha256 !== manifest.promotion.baseManifestSha256) fail('root-owned current manifest does not match candidate base');

  const target = option(argv, '--target');
  const targetProfile = target === 'shadow' ? 'live-staging' : target;
  const configPath = resolve(option(argv, '--config-profile'));
  verifyInputDigest(resolve(option(argv, '--compose')), manifest.deploymentInputs.composeSha256, 'Compose');
  verifyInputDigest(resolve(option(argv, '--overlay')), manifest.deploymentInputs.overlaySha256, 'OCI overlay');
  verifyInputDigest(configPath, manifest.configProfiles[targetProfile]?.sha256, 'runtime public config');
  for (const profile of ['production', 'live-staging']) {
    verifyInputDigest(join(dirname(manifestPath), `${profile}.json`), manifest.configProfiles[profile].sha256, `${profile} public config`);
  }
  if (target === 'production') {
    verifyRuntimePublicConfig(JSON.parse(readRegular(configPath)), readRegular(resolve(option(argv, '--runtime-env')), 2 * 1024 * 1024));
  }

  const qualificationBytes = readRegular(join(dirname(manifestPath), 'qualification-receipt.json'));
  if (sha256(qualificationBytes) !== manifest.qualification.receiptSha256) fail('qualification receipt hash mismatch');
  const qualification = JSON.parse(qualificationBytes);
  validateQualificationReceipt(qualification, manifest);

  const workflowRunId = option(argv, '--workflow-run-id');
  const workflowRunAttempt = Number(option(argv, '--workflow-run-attempt'));
  const result = verifyReleaseManifest(manifest, {
    sourceRepository: 'AlterMundi/harmonic-beacon-webapp',
    sourceSha: option(argv, '--source-sha'),
    sourceTree: option(argv, '--source-tree'),
    workflowRunId,
    workflowRunAttempt,
    target,
    targetConfigSha256: option(argv, '--config-sha256'),
    currentBaseManifestSha256,
    manifestSha256: expectedManifestSha256,
    registryEvidence: registryEvidence(evidenceRoot, manifest),
    now: new Date(),
  });
  const externalRefs = Object.fromEntries(manifest.externalImages.map((entry) => [
    entry.serviceId, `${entry.repository}@${entry.digest}`,
  ]));
  writeFileSync(output, `${JSON.stringify({
    ...result, externalRefs, workflowRunId, workflowRunAttempt,
    sourceSha: manifest.source.gitSha, sourceTree: manifest.source.gitTree,
    targetConfigSha256: manifest.configProfiles[targetProfile].sha256,
    baseManifestSha256: manifest.promotion.baseManifestSha256,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'hb-artifact-verify: failed');
    process.exitCode = 1;
  }
}
