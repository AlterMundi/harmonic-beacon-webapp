import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
const RUN_ID = '4242';
const BASE_SHA = '1'.repeat(64);
const CANDIDATE_MANIFEST = '{}\n';
const CANDIDATE_SHA = createHash('sha256').update(CANDIDATE_MANIFEST).digest('hex');

function writePrivate(path, value) {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function makeCommitFixture(root) {
  const state = join(root, 'releases');
  const lane = join(root, 'release-lane-state');
  const transaction = join(state, 'transactions', RUN_ID);
  const candidate = join(transaction, 'candidate');
  mkdirSync(candidate, { recursive: true, mode: 0o700 });
  writePrivate(join(transaction, 'receipt.json'), `${JSON.stringify({
    target: 'production', phase: 'replaced', manifestSha256: CANDIDATE_SHA,
    baseManifestSha256: BASE_SHA,
  })}\n`);
  writePrivate(join(state, 'current-state.json'), `${JSON.stringify({
    schemaVersion: 'harmonic-beacon.current-state.v2',
    laneState: 'oci-production', manifestSha256: BASE_SHA,
  })}\n`);
  writePrivate(join(state, 'active-transaction'), `${RUN_ID}\n`);
  writePrivate(lane, 'oci-production\n');
  writePrivate(join(candidate, 'candidate-manifest.json'), CANDIDATE_MANIFEST);
  writePrivate(join(candidate, 'docker-compose.yml'), 'services: {}\n');
  writePrivate(join(candidate, 'oci-images.compose.yml'), 'services: {}\n');
  writePrivate(join(candidate, 'target-public-config.json'), '{}\n');
  return { state, transaction };
}

function buildHarness(root) {
  const state = join(root, 'releases');
  const lane = join(root, 'release-lane-state');
  const marker = '\nrequire_root\n';
  const end = helper.lastIndexOf(marker);
  assert.notEqual(end, -1, 'helper dispatch marker is missing');
  let source = helper.slice(0, end);
  source = source.replace(
    "readonly ARTIFACT_STATE='/var/lib/harmonic-beacon/releases'",
    `readonly ARTIFACT_STATE='${state}'`,
  );
  source = source.replace(
    "readonly RELEASE_LANE_STATE='/etc/harmonic-beacon/release-lane-state'",
    `readonly RELEASE_LANE_STATE='${lane}'`,
  );
  source = source.replace(
    /require_secure_root_file\(\) \{[\s\S]*?\n\}/u,
    `require_secure_root_file() {\n  [ -f "$1" ] && [ ! -L "$1" ] || die "test file is missing or unsafe: $1"\n  [ "$(stat -c '%a' "$1")" = "$2" ] || die "test file mode is invalid: $1"\n}`,
  );
  source += `\nchown() { :; }\n`;
  source += `resume_commit() {\n`;
  source += `  if transaction_finish_committed '${RUN_ID}'; then return 0; fi\n`;
  source += `  atomic_install_current_state '${join(root, 'releases', 'transactions', RUN_ID)}'\n`;
  source += `  transaction_finish_committed '${RUN_ID}'\n`;
  source += `}\nresume_commit\n`;
  const harness = join(root, 'harness.bash');
  writeFileSync(harness, source, { mode: 0o700 });
  return harness;
}

function runHarness(harness, failpoint) {
  return spawnSync('bash', [harness], {
    encoding: 'utf8',
    env: { ...process.env, HB_DEPLOY_TEST_FAILPOINT: failpoint },
  });
}

test('commit transition resumes idempotently after every durable state boundary', () => {
  const failpoints = [
    'current-state-file-fsync',
    'current-state-rename',
    'current-state-directory-fsync',
    'phase-marker-file-fsync',
    'phase-marker-rename',
    'phase-marker-directory-fsync',
    'active-marker-remove',
    'active-marker-directory-fsync',
  ];

  for (const failpoint of failpoints) {
    const root = mkdtempSync(join(tmpdir(), `hb-state-${failpoint}-`));
    try {
      const { state, transaction } = makeCommitFixture(root);
      const harness = buildHarness(root);
      const interrupted = runHarness(harness, failpoint);
      assert.notEqual(interrupted.status, 0, `${failpoint} did not interrupt the transition`);
      assert.doesNotThrow(() => JSON.parse(readFileSync(join(state, 'current-state.json'), 'utf8')));
      assert.doesNotThrow(() => JSON.parse(readFileSync(join(transaction, 'receipt.json'), 'utf8')));

      const resumed = runHarness(harness, '');
      assert.equal(resumed.status, 0, `${failpoint} did not resume: ${resumed.stderr}`);
      assert.equal(JSON.parse(readFileSync(join(state, 'current-state.json'), 'utf8')).manifestSha256, CANDIDATE_SHA);
      assert.equal(JSON.parse(readFileSync(join(transaction, 'receipt.json'), 'utf8')).phase, 'committed');
      assert.throws(() => readFileSync(join(state, 'active-transaction')), /ENOENT/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
