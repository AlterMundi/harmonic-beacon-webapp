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
  assert.match(helper, /admit_file/u);
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
  assert.match(rollback, /prior\/service-releases\.json/u);
  assert.match(helper, /verify_prior_state_inputs/u);
  assert.match(helper, /stage-grant-rollback-preflight/u);
  assert.match(rollback, /durable grant contract/u);
  assert.doesNotMatch(rollback, /rollbackRefs/u);
  assert.doesNotMatch(helper, /current-manifest\.sha256["']?\s*$/mu);
});

test('repair: rollback fails closed on public config drift and republishes only a fully verified prior state', () => {
  const helper = read('deploy/hb-deploy-root');
  const prepare = section(helper, 'artifact_prepare() {', '\nartifact_preflight() {');
  const rollback = section(helper, 'artifact_rollback() {', '\nusage() {');
  assert.match(prepare, /require_rollback_safe_public_config/u);
  assert.match(helper, /public runtime config change requires a separately reviewed transactional overlay/u);
  assert.match(rollback, /transaction_require_rollback/u);
  assert.match(rollback, /verify_release_runtime_state[^\n]+prior/u);
  const verification = section(helper, 'verify_release_runtime_state() {', '\nartifact_status() {');
  for (const service of ['beacon-app', 'beacon-commerce-reconciler', 'beacon-tapestry', 'beacon-playlist-bot', 'beacon-postgres', 'beacon-livekit']) {
    assert.match(verification, new RegExp(service));
  }
  assert.match(verification, /verify_public_provenance_from/u);
  assert.match(verification, /boundary/u);
  assert.match(rollback, /atomic_install_release_state[^\n]+prior/u);
  assert.ok(rollback.indexOf('atomic_install_release_state') > rollback.indexOf('verify_release_runtime_state'));
  assert.ok(rollback.indexOf('rolled-back') > rollback.indexOf('atomic_install_release_state'));
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
  assert.match(script, /verifyAcceptanceMatrix/u);
  for (const check of ['browser', 'syntheticSession', 'commerce', 'schema', 'isolation', 'restore']) {
    assert.match(script, new RegExp(check));
  }
  assert.match(script, /e2e\/tests\/oci-qualification\.spec\.ts/u);
  assert.match(script, /db\/test-fixture\.sql/u);
  assert.match(script, /pg_dump/u);
  assert.ok(receiptWrite > script.indexOf('verifyAcceptanceMatrix'));
  assert.match(compose, /analytics:[\s\S]+healthcheck:/u);
  assert.match(compose, /commerce-reconciler:[\s\S]+healthcheck:/u);
  assert.doesNotMatch(script, /docker\s+(?:compose\s+)?build\b/u);
});

test('repair: transition authorization requires measured rollback and forward-repair evidence', () => {
  const helper = read('deploy/hb-deploy-root');
  const evidence = section(helper, 'require_oci_transition_evidence() {', '\natomic_install_release_state() {');
  assert.match(evidence, /cosign verify-blob/u);
  assert.match(evidence, /--certificate-oidc-issuer 'https:\/\/token.actions.githubusercontent.com'/u);
  assert.match(evidence, /oci-promote.yml@refs\/heads\/main/u);
  assert.match(evidence, /node "\$RELEASE_MANIFEST" validate-transition/u);
  assert.doesNotMatch(evidence, /Verified|jq -e/u);
});

test('repair: root lane and one live high-water gate legacy and OCI mutation boundaries', () => {
  const helper = read('deploy/hb-deploy-root');
  const legacy = read('.github/workflows/deploy.yml');
  assert.match(helper, /readonly RELEASE_LANE_STATE=/u);
  assert.match(helper, /require_release_lane\(\)/u);
  assert.match(helper, /laneState/u);
  for (const name of ['preserve', 'build', 'migrate', 'quiesce', 'replace', 'rollback', 'legacy_admit']) {
    assert.doesNotMatch(helper, new RegExp(`^${name}\\(\\)`, 'm'));
  }
  const transaction = section(helper, 'transaction_require() {', '\ntransaction_require_rollback() {');
  assert.match(transaction, /require_release_lane oci-production/u);
  const ociAtomic = section(helper, 'atomic_install_release_state() {', '\natomic_install_current_state() {');
  assert.match(ociAtomic, /require_release_lane oci-production/u);
  assert.ok(ociAtomic.indexOf('require_release_lane oci-production') < ociAtomic.indexOf('mv -f'));
  assert.match(legacy, /safety-hold/u);
  assert.match(legacy, /exit 1/u);
  assert.doesNotMatch(legacy, /sudo|self-hosted|actions\/checkout/u);
});

test('repair: every checkout and setup-node action is immutable with explicit minimal workflow permissions', () => {
  for (const file of [
    '.github/workflows/audio-boundary.yml', '.github/workflows/ci.yml', '.github/workflows/deploy.yml',
    '.github/workflows/e2e.yml', '.github/workflows/livekit-capacity.yml', '.github/workflows/oci-candidate.yml',
    '.github/workflows/oci-promote.yml',
  ]) {
    const workflow = read(file);
    assert.match(workflow, /^\s{0,4}permissions:\n/mu);
    assert.match(workflow, /^\s{2,6}contents: read$/mu);
    if (!file.endsWith('oci-candidate.yml') && !file.endsWith('oci-promote.yml')) assert.doesNotMatch(workflow, /^\s{2,6}[a-z-]+: write$/mu);
    for (const match of workflow.matchAll(/actions\/(?:checkout|setup-node)@([^\s]+)/gu)) {
      assert.match(match[1], /^[0-9a-f]{40}$/u, `${file}: ${match[0]}`);
    }
  }
});

test('repair: prepare cleanup is EXIT-safe across registry login and pull failure', () => {
  const helper = read('deploy/hb-deploy-root');
  const prepare = section(helper, 'artifact_prepare() {', '\nartifact_preflight() {');
  assert.match(prepare, /trap "unset DOCKER_CONFIG HB_REGISTRY_TOKEN HB_REGISTRY_USERNAME; rm -rf -- \$\(printf '%q' "\$temp"\)" EXIT/u);
  assert.doesNotMatch(prepare, /trap [^\n]+ RETURN/u);
  assert.ok(prepare.indexOf('trap "') < prepare.indexOf('docker login'));
  assert.ok(prepare.indexOf('trap "') < prepare.indexOf('docker pull'));
  assert.match(prepare, /trap - EXIT/u);
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
  const runtime = section(helper, 'verify_release_runtime_state() {', '\nartifact_status() {');
  assert.match(runtime + helper, /\.State\.Running/u);
  assert.match(runtime + helper, /docker image inspect/u);
  for (const service of ['beacon-app', 'beacon-commerce-reconciler', 'beacon-tapestry', 'beacon-playlist-bot', 'beacon-postgres', 'beacon-livekit', 'analytics']) {
    assert.match(runtime, new RegExp(service));
  }
  assert.match(runtime, /api\/health/u);
  assert.match(runtime + helper, /artifactDigest/u);
  assert.match(runtime + helper, /configProfileSha256/u);
  assert.match(runtime, /require_exact_private_network|boundary/u);
  assert.ok(status.indexOf('atomic_install_current_state') > status.indexOf('verify_release_runtime_state'));
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
  const verifierModule = await import('../../../deploy/hb-artifact-verify.mjs');
  assert.equal(typeof verifierModule.validateEvidenceStatement, 'function');
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
  assert.doesNotThrow(() => verifierModule.validateEvidenceStatement(statement, record, 'provenance'));
  statement.predicate.buildDefinition.externalParameters.source.gitTree = 'd'.repeat(40);
  assert.throws(() => verifierModule.validateEvidenceStatement(statement, record, 'provenance'), /source, workflow, build inputs, and platform/u);
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
