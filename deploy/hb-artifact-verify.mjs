#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { verifyReleaseManifest } from './release-manifest.mjs';

function fail(message) {
  throw new Error(`hb-artifact-verify: ${message}`);
}

function readRegular(path, maximum = 1024 * 1024) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) fail('unsafe input file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const after = fstatSync(fd);
    if (!after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino || after.size > maximum) {
      fail('input changed while opening');
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) fail(`${name} is required`);
  return argv[index + 1];
}

function filesUnder(path) {
  return readdirSync(path, { recursive: true }).map((entry) => join(path, entry.toString()))
    .filter((entry) => statSync(entry).isFile());
}

function registryEvidence(root) {
  const records = {};
  for (const path of filesUnder(root).filter((entry) => entry.endsWith('/evidence.json'))) {
    const record = JSON.parse(readRegular(path));
    const folder = dirname(path);
    const checks = [
      ['sbomDigest', 'sbom.bundle.json'],
      ['provenanceDigest', 'provenance.bundle.json'],
      ['signatureBundleDigest', 'signature.bundle.json'],
    ];
    for (const [field, filename] of checks) {
      if (record[field] !== sha256(readRegular(join(folder, filename), 16 * 1024 * 1024))) {
        fail(`${record.artifactId ?? 'unknown'} ${field} file mismatch`);
      }
    }
    if (records[record.artifactId]) fail('duplicate registry evidence');
    records[record.artifactId] = {
      repository: record.repository,
      imageDigest: record.digest,
      sbomDigest: record.sbomDigest,
      provenanceDigest: record.provenanceDigest,
      signatureBundleDigest: record.signatureBundleDigest,
    };
  }
  return records;
}

export function main(argv = process.argv.slice(2)) {
  const manifestPath = resolve(option(argv, '--manifest'));
  const evidenceRoot = resolve(option(argv, '--evidence'));
  const expectedManifestSha256 = option(argv, '--manifest-sha256');
  const currentBasePath = resolve(option(argv, '--current-base-file'));
  const output = resolve(option(argv, '--output'));
  const manifestBytes = readRegular(manifestPath);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== expectedManifestSha256) fail('manifest byte hash mismatch');
  const currentBaseManifestSha256 = readRegular(currentBasePath, 128).toString('utf8').trim();
  const manifest = JSON.parse(manifestBytes);
  const qualificationBytes = readRegular(join(dirname(manifestPath), 'qualification-receipt.json'));
  if (sha256(qualificationBytes) !== manifest.qualification?.receiptSha256) fail('qualification receipt hash mismatch');
  const qualification = JSON.parse(qualificationBytes);
  if (qualification.result !== 'success' ||
      qualification.candidateIdentitySha256 !== manifest.qualification.candidateIdentitySha256) {
    fail('qualification receipt is not bound to this candidate');
  }
  for (const entry of manifest.artifacts) {
    if (qualification.imageRefs?.[entry.artifactId] !== `${entry.repository}@${entry.digest}`) {
      fail(`qualification receipt image mismatch for ${entry.artifactId}`);
    }
  }
  const result = verifyReleaseManifest(manifest, {
    sourceRepository: 'AlterMundi/harmonic-beacon-webapp',
    sourceSha: option(argv, '--source-sha'),
    sourceTree: option(argv, '--source-tree'),
    target: option(argv, '--target'),
    targetConfigSha256: option(argv, '--config-sha256'),
    currentBaseManifestSha256,
    manifestSha256: expectedManifestSha256,
    registryEvidence: registryEvidence(evidenceRoot),
    now: new Date(),
  });
  const externalRefs = Object.fromEntries(manifest.externalImages.map((entry) => [
    entry.serviceId, `${entry.repository}@${entry.digest}`,
  ]));
  writeFileSync(output, `${JSON.stringify({
    ...result,
    rollbackManifestSha256: manifest.rollback.manifestSha256,
    externalRefs,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'hb-artifact-verify: failed');
  process.exitCode = 1;
}
