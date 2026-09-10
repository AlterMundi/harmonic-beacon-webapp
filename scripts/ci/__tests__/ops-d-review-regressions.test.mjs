import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(from, -1, `missing section ${start}`);
  assert.notEqual(to, -1, `missing section terminator ${end}`);
  return source.slice(from, to);
}

test('finding 1: privileged commands use only a prepared root-owned transaction and verify installed implementation digests', () => {
  const helper = read('deploy/hb-deploy-root');
  assert.match(helper, /TRUSTED_IMPLEMENTATION='\/usr\/local\/libexec\/harmonic-beacon\/ops-d-implementation\.sha256'/u);
  assert.match(helper, /sha256sum[^\n]+--check/u);
  for (const seen of ['helper_seen', 'verifier_seen', 'module_seen']) assert.match(helper, new RegExp(seen));
  assert.match(helper, /transaction_(?:require|load)/u);
  assert.match(helper, /TRANSACTION_ROOT=.*ARTIFACT_STATE.*transactions/u);
  assert.match(helper, /artifact_transaction\(\)/u);
  const later = section(helper, 'artifact_migrate() {', '\nusage() {');
  assert.doesNotMatch(later, /\$workspace\/docker-compose\.yml|\$workspace\/\$OCI_OVERLAY/u);
  assert.match(helper, /\[ ! -L "\$input_root\/evidence" \]/u);
  assert.match(helper, /install -d[^\n]+candidate\/evidence/u);
  assert.match(helper, /unset NODE_OPTIONS NODE_PATH/u);
  assert.match(helper, /candidate-manifest\.json/u);
  assert.doesNotMatch(section(helper, 'artifact_prepare() {', '\nartifact_preflight() {'), /install[^\n]+\$manifest/u);
});

test('finding 2: rollback is derived from one atomic current state and preserves migration safety', () => {
  const helper = read('deploy/hb-deploy-root');
  const rollback = section(helper, 'artifact_rollback() {', '\nusage() {');
  assert.match(helper, /current-state\.json/u);
  assert.match(helper, /flock/u);
  assert.match(helper, /atomic_(?:write|install)_current_state/u);
  assert.match(helper, /atomic_write_active_transaction/u);
  assert.match(section(helper, 'artifact_status() {', '\nartifact_rollback() {'), /committed/u);
  assert.match(rollback, /rolled-back/u);
  assert.match(rollback, /prior-manifest\.json/u);
  assert.match(helper, /verify_prior_state_inputs/u);
  assert.match(helper, /stage-grant-rollback-preflight/u);
  assert.match(rollback, /durable grant contract/u);
  assert.doesNotMatch(rollback, /rollbackRefs/u);
  assert.doesNotMatch(helper, /current-manifest\.sha256["']?\s*$/mu);
});

test('finding 3: producer operator validator and helper share the raw-byte public config digest', () => {
  const producer = read('scripts/ci/create-candidate.mjs');
  const manifest = read('scripts/ci/release-manifest.mjs');
  const promotion = read('.github/workflows/oci-promote.yml');
  const helper = read('deploy/hb-deploy-root');
  const validator = section(manifest, 'export function verifyRuntimePublicConfig', '\n}\n\nfunction parseArgs');
  assert.doesNotMatch(validator, /canonicalize|canonicalSha256/u);
  assert.match(producer, /publicConfigSha256/u);
  assert.match(manifest, /export function publicConfigSha256/u);
  assert.match(promotion, /public-config-digest/u);
  assert.match(helper, /target-public-config\.json/u);
});

test('finding 4: qualification pulls exact refs starts dependencies migrates analytics and verifies behavior before receipt', () => {
  const script = read('scripts/ci/qualify-oci.mjs');
  const compose = read('deploy/qualification.compose.yml');
  const receiptWrite = script.indexOf('writeFileSync(resolve(options.receipt)');
  assert.match(script, /validateCandidateManifest\(manifest\)/u);
  assert.match(script, /docker[^\n]+pull/u);
  assert.match(script, /--profile[^\n]+analytics/u);
  assert.match(script, /postgres[^\n]+livekit/u);
  assert.match(script, /analytics[^\n]+migrate|migrate[^\n]+analytics/u);
  assert.match(script, /127\.0\.0\.1:7880/u);
  assert.match(script, /configProfileSha256/u);
  assert.match(script, /verifyRunningImages/u);
  assert.match(script, /verifyBehavior/u);
  assert.ok(receiptWrite > script.indexOf('verifyBehavior'));
  assert.match(compose, /analytics:[\s\S]+healthcheck:/u);
  assert.doesNotMatch(script, /docker\s+(?:compose\s+)?build\b/u);
});

test('finding 5: promotion pins workflow path current main SHA and run attempts end to end', () => {
  const workflow = read('.github/workflows/oci-promote.yml');
  assert.match(workflow, /\.path[^\n]+oci-candidate\.yml/u);
  assert.match(workflow, /TRUSTED_MAIN_SHA/u);
  assert.match(workflow, /source_sha:/u);
  assert.match(workflow, /workflowRunId/u);
  assert.match(workflow, /workflowRunAttempt/u);
  assert.match(workflow, /qualification\.runId/u);
  assert.match(workflow, /qualification\.runAttempt/u);
});

test('finding 6: status checks running health actual image IDs public provenance and boundaries before current state', () => {
  const helper = read('deploy/hb-deploy-root');
  const status = section(helper, 'artifact_status() {', '\nartifact_rollback() {');
  assert.match(status + helper, /\.State\.Running/u);
  assert.match(status + helper, /docker image inspect/u);
  for (const service of ['beacon-app', 'beacon-commerce-reconciler', 'beacon-tapestry', 'beacon-playlist-bot', 'beacon-postgres', 'beacon-livekit', 'analytics']) {
    assert.match(status, new RegExp(service));
  }
  assert.match(status, /api\/health/u);
  assert.match(status + helper, /artifactDigest/u);
  assert.match(status + helper, /configProfileSha256/u);
  assert.match(status, /require_exact_private_network|boundary/u);
  assert.ok(status.indexOf('atomic_install_current_state') > status.indexOf('boundary'));
});

test('finding 7: verified public profile is consumed by runtime and promo semantics agree', () => {
  const helper = read('deploy/hb-deploy-root');
  const compose = read('docker-compose.yml');
  const profile = JSON.parse(read('deploy/runtime-public-config/production.json'));
  const env = read('deploy/production.env.example');
  const health = read('src/app/api/health/route.ts');
  assert.match(helper, /verify-runtime-public-config/u);
  assert.match(section(helper, 'artifact_prepare() {', '\nartifact_preflight() {'), /require_secure_root_file "\$PRODUCTION_ENV" 600/u);
  assert.match(section(helper, 'artifact_prepare() {', '\nartifact_preflight() {'), /require_secure_root_file "\$REGISTRY_ENV" 600/u);
  assert.match(compose, /BEACON_PUBLIC_ORIGIN/u);
  assert.match(compose, /BEACON_CONFIG_PROFILE_SHA256/u);
  assert.match(health, /runtimePublicConfig/u);
  assert.equal(profile.featureFlags.promoInvitations, false);
  assert.match(env, /PROMO_INVITATIONS_ENABLED=false/u);
  assert.match(env, /PUBLIC_ORIGIN=https:\/\/live\.harmonicbeacon\.com/u);
});

test('finding 8: verifier cryptographically and structurally verifies every manifest-bound evidence byte', () => {
  const workflow = read('.github/workflows/oci-candidate.yml');
  const verifier = read('deploy/hb-artifact-verify.mjs');
  const manifest = read('scripts/ci/release-manifest.mjs');
  assert.match(workflow, /cosign sign-blob/u);
  assert.match(verifier, /execFileSync\('cosign'/u);
  assert.match(verifier, /'verify', '--bundle'/u);
  assert.match(verifier, /'verify-blob', '--bundle'/u);
  for (const field of ['subject', 'predicateType', 'gitSha', 'gitTree', 'workflowRunId', 'workflowRunAttempt', 'platform', 'dockerfile']) {
    assert.match(verifier + manifest, new RegExp(field));
  }
  assert.match(manifest, /sbomSignatureBundleDigest/u);
  assert.match(manifest, /provenanceSignatureBundleDigest/u);
});

test('finding 8: verifier module can be imported for structural adversarial tests without executing its CLI', async () => {
  const module = await import('../../../deploy/hb-artifact-verify.mjs');
  assert.equal(typeof module.validateEvidenceStatement, 'function');
  const record = {
    repository: 'ghcr.io/altermundi/harmonic-beacon-app',
    digest: `sha256:${'a'.repeat(64)}`,
    dockerfile: 'Dockerfile', sourceSha: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    workflowRunId: '42', workflowRunAttempt: 1,
  };
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: record.repository, digest: { sha256: 'a'.repeat(64) } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: { externalParameters: {
        source: { repository: 'AlterMundi/harmonic-beacon-webapp', ref: 'refs/heads/main', gitSha: record.sourceSha, gitTree: record.sourceTree },
        context: '.', dockerfile: record.dockerfile, platform: 'linux/amd64',
      } },
      runDetails: { builder: { id: 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main' }, metadata: { workflowRunId: '42', workflowRunAttempt: 1, buildkitProvenance: {} } },
    },
  };
  assert.doesNotThrow(() => module.validateEvidenceStatement(statement, record, 'provenance'));
  statement.predicate.buildDefinition.externalParameters.source.gitTree = 'd'.repeat(40);
  assert.throws(() => module.validateEvidenceStatement(statement, record, 'provenance'), /source, workflow, build inputs, and platform/u);
});

test('finding 9: one release lane state keeps Mona unconditional through shadow and prevents boolean drift', () => {
  const legacy = read('.github/workflows/deploy.yml');
  const promotion = read('.github/workflows/oci-promote.yml');
  const combined = legacy + promotion;
  assert.doesNotMatch(combined, /HB_LEGACY_MONA_FALLBACK_ENABLED/u);
  assert.doesNotMatch(combined, /HB_OCI_PROMOTION_ENABLED/u);
  assert.match(legacy, /HB_RELEASE_LANE_STATE/u);
  assert.match(promotion, /HB_RELEASE_LANE_STATE/u);
  assert.match(promotion, /legacy-shadow/u);
  assert.match(promotion, /group: harmonic-beacon-production-release/u);
  assert.match(legacy, /group: harmonic-beacon-production-release/u);
  assert.match(promotion, /oci-production/u);
  assert.match(read('deploy/hb-deploy-root'), /require_oci_transition_evidence/u);
});
