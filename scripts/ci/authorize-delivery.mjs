#!/usr/bin/env node
// Hosted-only issuer. No environment or subprocess output is included in evidence.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, publicConfigSha256, validateReleaseManifest, validateQualificationReceipt, validateDeliveryAuthorization, validateTransitionEvidence } from './release-manifest.mjs';
const identity = 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main';
function verifiedManifest(root) {
  // Authentication precedes parsing even on hosted infrastructure.
  for (const name of ['release-manifest', 'qualification-receipt']) {
    execFileSync('cosign', ['verify-blob', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
      '--certificate-identity', identity, '--bundle', join(root, `${name}.signature.bundle.json`), join(root, `${name}.json`)], { stdio: 'pipe' });
  }
  const bytes = readFileSync(join(root, 'release-manifest.json'));
  const manifest = JSON.parse(bytes);
  if (!bytes.equals(Buffer.from(canonicalize(manifest)))) throw Error('noncanonical manifest');
  validateReleaseManifest(manifest);
  const qualificationBytes = readFileSync(join(root, 'qualification-receipt.json'));
  const qualification = JSON.parse(qualificationBytes);
  if (!qualificationBytes.equals(Buffer.from(canonicalize(qualification))) || publicConfigSha256(qualificationBytes) !== manifest.qualification.receiptSha256) throw Error('qualification digest/canonical mismatch');
  validateQualificationReceipt(qualification, manifest);
  return { manifest, bytes, sha256: publicConfigSha256(bytes).slice(7) };
}
export function main(env = process.env) {
  const candidate = verifiedManifest('candidate');
  const base = verifiedManifest('base-candidate');
  const m = candidate.manifest;
  if (base.manifest.build.workflowRunId !== env.BASE_CANDIDATE_RUN_ID ||
      base.manifest.build.workflowRunAttempt !== Number(env.BASE_CANDIDATE_RUN_ATTEMPT) ||
      base.manifest.source.gitSha !== env.BASE_SOURCE_SHA || base.manifest.source.gitTree !== env.BASE_SOURCE_TREE ||
      base.sha256 !== env.BASE_MANIFEST_SHA256 || base.sha256 !== m.promotion.baseManifestSha256 ||
      candidate.sha256 !== env.MANIFEST_SHA256 || m.source.gitSha !== env.SOURCE_SHA || m.source.gitTree !== env.SOURCE_TREE ||
      m.build.workflowRunId !== env.CANDIDATE_RUN_ID || m.build.workflowRunAttempt !== Number(env.CANDIDATE_RUN_ATTEMPT)) throw Error('candidate/base provenance mismatch');
  let transitionAuthorizationSha256 = null;
  if (env.TARGET === 'production' && env.OPERATION === 'promote') {
    const root = 'candidate/transition';
    // All four signatures precede any transition JSON parsing.
    for (const name of ['authorization', 'shadow', 'rollback', 'forward-repair']) {
      execFileSync('cosign', ['verify-blob', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--certificate-identity', identity.replace('oci-candidate.yml', 'oci-promote.yml'),
        '--bundle', join(root, `${name}.signature.bundle.json`), join(root, `${name}.json`)], { stdio: 'pipe' });
    }
    const authorizationBytes = readFileSync(join(root, 'authorization.json'));
    validateTransitionEvidence({ manifest: m, manifestBytes: candidate.bytes, authorizationBytes,
      qualificationBytes: readFileSync(join(root, 'qualification.json')),
      stages: Object.fromEntries(['shadow', 'rollback', 'forward-repair'].map(stage => [stage, {
        receiptBytes: readFileSync(join(root, `${stage}.json`)), executionBytes: readFileSync(join(root, `${stage}.execution.json`)),
      }])) });
    transitionAuthorizationSha256 = publicConfigSha256(authorizationBytes);
  }
  const now = Date.now();
  if (env.OPERATION === 'promote' && (Date.parse(m.qualification.qualifiedAt) > now || Date.parse(m.qualification.expiresAt) <= now)) throw Error('stale qualification');
  const configSha256 = m.configProfiles[env.TARGET === 'shadow' ? 'live-staging' : 'production'].sha256;
  const a = {
    schemaVersion: 'harmonic-beacon.delivery-authorization.v2', sourceSha: m.source.gitSha, sourceTree: m.source.gitTree,
    candidateManifestSha256: candidate.sha256, baseManifestSha256: base.sha256,
    candidateRunId: m.build.workflowRunId, candidateRunAttempt: m.build.workflowRunAttempt,
    deliveryRunId: env.GITHUB_RUN_ID, deliveryRunAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    workflowPath: '.github/workflows/oci-promote.yml', workflowRef: 'refs/heads/main',
    laneState: env.RELEASE_LANE_STATE, environment: env.TARGET, target: env.TARGET, operation: env.OPERATION,
    configSha256, transitionAuthorizationSha256,
    impactStateSha256: env.OPERATION === 'promote' ? env.IMPACT_STATE_SHA256 : null,
    impactPlanSha256: env.OPERATION === 'promote' ? env.IMPACT_PLAN_SHA256 : null,
    verbs: env.OPERATION === 'rollback' ? ['rollback'] : env.TARGET === 'shadow' ? ['prepare', 'preflight', 'status'] : ['prepare', 'preflight', 'migrate', 'replace', 'status', 'rollback'],
    authorizedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900000).toISOString(),
  };
  const bytes = canonicalize(a);
  validateDeliveryAuthorization(Buffer.from(bytes), { configSha256: env.CONFIG_SHA256 }, { now });
  writeFileSync('candidate/delivery-authorization.json', bytes, { flag: 'wx', mode: 0o600 });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { console.error('Protected delivery authorization failed; no authorization issued'); process.exitCode = 1; }
}
