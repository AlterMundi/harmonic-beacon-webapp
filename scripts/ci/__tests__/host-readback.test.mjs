import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { stateFixture } from './b3-fixture.mjs';

const source = readFileSync('deploy/hb-deploy-root', 'utf8');
const workflow = readFileSync('.github/workflows/live-host-readback.yml', 'utf8');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const prefix = source.slice(0, source.indexOf('\nstate_unpack() {'));
const workflowFilter = workflow.match(/jq -e '\n([\s\S]*?)\n\s*' host-readback\.json/u)?.[1];
assert.ok(workflowFilter, 'workflow report validator is missing');

function assertWorkflowAccepted(report) {
  const checked = spawnSync('jq', ['-e', workflowFilter], { input: JSON.stringify(report), encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
}

function tree(root) {
  const visit = path => readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => entry.isDirectory()
      ? [entry.name, visit(join(path, entry.name))]
      : [entry.name, readFileSync(join(path, entry.name), 'utf8')]);
  return visit(root);
}

function readback({ lane, state, active, implementationValid = true, unstablePath } = {}) {
  const root = mkdtempSync(join(process.cwd(), '.hb-host-readback-'));
  try {
    const releaseRoot = join(root, 'releases');
    mkdirSync(releaseRoot);
    const trusted = join(root, 'implementation.sha256');
    writeFileSync(trusted, `${'a'.repeat(64)} /usr/local/sbin/hb-deploy\n`);
    if (lane !== undefined) writeFileSync(join(root, 'lane'), `${lane}\n`);
    if (state !== undefined) writeFileSync(join(releaseRoot, 'current-state.json'),
      typeof state === 'string' ? state : JSON.stringify(state));
    if (active !== undefined) writeFileSync(join(releaseRoot, 'active-transaction'), `${active}\n`);
    const before = tree(root);
    let script = prefix;
    for (const [name, value] of Object.entries({
      TRUSTED_IMPLEMENTATION: trusted,
      ARTIFACT_STATE: releaseRoot,
      CURRENT_STATE: join(releaseRoot, 'current-state.json'),
      ACTIVE_TRANSACTION: join(releaseRoot, 'active-transaction'),
      RELEASE_LANE_STATE: join(root, 'lane'),
      RELEASE_MANIFEST: resolve('scripts/ci/release-manifest.mjs'),
    })) script = script.replace(new RegExp(`^readonly ${name}=.*$`, 'm'), `readonly ${name}=${quote(value)}`);
    script += `
require_secure_root_file() { [ -f "$1" ] && [ ! -L "$1" ]; }
verify_installed_implementation() { ${implementationValid ? 'return 0' : 'return 1'}; }
hostname() { printf 'mona\\n'; }
${unstablePath ? `eval "$(declare -f readback_file_identity | sed '1s/readback_file_identity/readback_file_identity_original/')"
readback_file_identity() {
  if [ "$1" = ${quote(unstablePath === 'lane' ? join(root, 'lane') : join(releaseRoot, 'current-state.json'))} ]; then
    printf 'verified:synthetic:%s:%s\\n' "$BASHPID" "$(date +%s%N)"
  else
    readback_file_identity_original "$@"
  fi
}` : ''}
host_readback
`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : null, unchanged: assert.deepEqual(tree(root), before) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('host readback emits only bounded identifiers for a validated v4 state without writing', () => {
  const result = readback({ lane: 'legacy-shadow', state: stateFixture(), active: '9007199254740993123' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.schemaVersion, 'harmonic-beacon.host-readback.v1');
  assert.equal(result.report.scope, 'configuration-only');
  assert.equal(result.report.result, 'verified');
  assert.equal(result.report.implementation.status, 'verified');
  assert.match(result.report.implementation.manifestSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.report.implementation.helperSha256, `sha256:${'a'.repeat(64)}`);
  assert.deepEqual(result.report.lane, { status: 'verified', state: 'legacy-shadow' });
  assert.equal(result.report.currentState.status, 'verified');
  assert.equal(result.report.currentState.evidence.schemaVersion, 'harmonic-beacon.current-state.v4');
  assert.equal(result.report.currentState.evidence.serviceReleases.length, 4);
  for (const release of result.report.currentState.evidence.serviceReleases) {
    assert.deepEqual(Object.keys(release).sort(), ['imageDigest', 'service', 'sourceSha']);
    assert.match(release.sourceSha, /^[0-9a-f]{40}$/u);
    assert.match(release.imageDigest, /^sha256:[0-9a-f]{64}$/u);
  }
  assert.deepEqual(result.report.activeTransaction, { status: 'verified', id: '9007199254740993123' });
  assert.doesNotMatch(result.stdout, /Base64|publicOrigin|livekit|\.env|token|secret/iu);
  assertWorkflowAccepted(result.report);
});

test('host readback reports an absent legacy OCI state as unavailable', () => {
  const result = readback({ lane: 'legacy-shadow' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.result, 'unavailable');
  assert.deepEqual(result.report.currentState, { status: 'unavailable', evidence: null });
  assert.deepEqual(result.report.activeTransaction, { status: 'none', id: null });
  assertWorkflowAccepted(result.report);
});

for (const [name, options, field] of [
  ['unknown lane', { lane: 'bypass', state: stateFixture() }, 'lane'],
  ['invalid state', { lane: 'oci-production', state: '{}' }, 'currentState'],
  ['invalid active transaction', { lane: 'oci-production', state: stateFixture(), active: '../other' }, 'activeTransaction'],
]) test(`host readback marks ${name} invalid without exposing file content`, () => {
  const result = readback(options);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.result, 'invalid');
  assert.equal(result.report[field].status, 'invalid');
  assert.ok(!result.stdout.includes('bypass'));
  assert.ok(!result.stdout.includes('../other'));
  assertWorkflowAccepted(result.report);
});

test('an unverified implementation cannot validate or summarize current state', () => {
  const result = readback({ lane: 'legacy-shadow', state: stateFixture(), implementationValid: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.result, 'invalid');
  assert.deepEqual(result.report.implementation, { status: 'invalid', manifestSha256: null, helperSha256: null });
  assert.deepEqual(result.report.currentState, { status: 'unavailable', evidence: null });
});

for (const unstablePath of ['lane', 'state']) test(`host readback clears ${unstablePath} evidence when its identity moves`, () => {
  const result = readback({ lane: 'legacy-shadow', state: stateFixture(), unstablePath });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.result, 'unavailable');
  if (unstablePath === 'lane') assert.deepEqual(result.report.lane, { status: 'unavailable', state: 'unknown' });
  else assert.deepEqual(result.report.currentState, { status: 'unavailable', evidence: null });
});

test('host readback dispatch exits before transaction directories and lock and accepts no arguments', () => {
  const dispatch = source.slice(source.indexOf('\nrequire_root\n'));
  const readback = dispatch.indexOf('if [ "$command" = host-readback ]');
  assert.ok(readback >= 0);
  assert.ok(readback < dispatch.indexOf('install -d -o root -g root'));
  assert.ok(readback < dispatch.indexOf('flock -x 9'));
  assert.match(dispatch.slice(readback, dispatch.indexOf('\ncase "$command" in')), /\[ "\$#" -eq 0 \] \|\| usage/u);
  const body = source.slice(source.indexOf('readback_file_identity() {'), source.indexOf('\nstate_unpack() {'));
  assert.doesNotMatch(body, /\b(?:install|mkdir|mktemp|mv|rm|flock|docker|curl)\b/u);
});

test('protected workflow has no checkout or caller-controlled command surface', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/mu);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/u);
  assert.match(workflow, /test "\$GITHUB_REF_PROTECTED" = true/u);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$main_sha"/u);
  assert.match(workflow, /runs-on: \[self-hosted, mona\]/u);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main' && github\.ref_protected/u);
  assert.match(workflow, /timeout-minutes: 5/u);
  assert.equal((workflow.match(/sudo \/usr\/local\/sbin\/hb-deploy host-readback/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /actions\/checkout|inputs:|\$\{\{\s*inputs\.|ssh|docker|artifact-(?:prepare|impact|migrate|replace|status|rollback)/u);
});
