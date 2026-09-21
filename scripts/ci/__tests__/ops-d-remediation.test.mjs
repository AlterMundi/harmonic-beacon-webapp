import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import fs, { existsSync, renameSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

import { admitRegularFile, canonicalize, impactStateFromCurrent } from '../release-manifest.mjs';
import { stateFixture } from './b3-fixture.mjs';

const read = (path) => readFileSync(path, 'utf8');
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('privileged admission copies one digest-bound regular file and rejects aliases', () => {
  const root = mkdtempSync(join(process.cwd(), '.hb-admit-'));
  try {
    const source = join(root, 'source.json');
    const output = join(root, 'output.json');
    const bytes = Buffer.from('{"safe":true}\n');
    writeFileSync(source, bytes, { mode: 0o600 });
    assert.equal(admitRegularFile(source, output, { expectedSha256: digest(bytes), maximumBytes: 1024 }), digest(bytes));
    assert.deepEqual(readFileSync(output), bytes);

    const symlink = join(root, 'symlink.json');
    symlinkSync(source, symlink);
    assert.throws(
      () => admitRegularFile(symlink, join(root, 'from-symlink.json'), { expectedSha256: digest(bytes), maximumBytes: 1024 }),
      /unsafe admission source/u,
    );

    assert.throws(
      () => admitRegularFile(source, join(root, 'wrong-digest.json'), { expectedSha256: `sha256:${'f'.repeat(64)}`, maximumBytes: 1024 }),
      /digest mismatch/u,
    );
    assert.equal(existsSync(join(root, 'wrong-digest.json')), false);

    const hardlink = join(root, 'hardlink.json');
    linkSync(source, hardlink);
    assert.throws(
      () => admitRegularFile(hardlink, join(root, 'from-hardlink.json'), { expectedSha256: digest(bytes), maximumBytes: 1024 }),
      /unsafe admission source/u,
    );


  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('root helper never executes Git or runner-workspace active content', () => {
  const helper = read('deploy/hb-deploy-root');
  const promotion = read('.github/workflows/oci-promote.yml');
  const candidate = read('.github/workflows/oci-candidate.yml');

  assert.doesNotMatch(helper, /\bgit\b/u);
  assert.doesNotMatch(helper, /validate_(?:workspace|checkout)/u);
  assert.doesNotMatch(helper, /docker compose --file "\$workspace/u);
  assert.doesNotMatch(helper, /install[^\n]+"\$input_root/u);
  assert.match(helper, /admit_file/u);
  assert.match(candidate, /docker-compose\.yml/u);
  assert.match(candidate, /deploy\/oci-images\.compose\.yml/u);
  assert.match(candidate, /deploy\/runtime-public-config/u);
  assert.doesNotMatch(promotion, /artifact-prepare "\$GITHUB_WORKSPACE"/u);
  assert.doesNotMatch(promotion, /^\s*(?:run:\s*)?sudo[^\n]*\$\{\{/mu);
});

test('FIFO admission fails within a bounded subprocess timeout', () => {
  const root = mkdtempSync(join(process.cwd(), '.hb-fifo-'));
  try {
    const source = join(root, 'fifo');
    execFileSync('mkfifo', [source]);
    const result = spawnSync(process.execPath, ['scripts/ci/release-manifest.mjs', 'admit-file',
      '--source', source, '--output', join(root, 'output'),
      '--expected-sha256', digest('x'), '--maximum-bytes', '1024'], { timeout: 2000, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe admission source/u);
    assert.equal(existsSync(join(root, 'output')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('held descriptor rejects replacement at open and mutation during its single bounded read', () => {
  const root = mkdtempSync(join(process.cwd(), '.hb-race-'));
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  try {
    const source = join(root, 'source');
    const output = join(root, 'output');
    writeFileSync(source, 'safe');
    fs.openSync = (path, ...args) => {
      if (path === source) {
        renameSync(source, join(root, 'old'));
        writeFileSync(source, 'evil');
      }
      return originalOpen(path, ...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => admitRegularFile(source, output, { expectedSha256: digest('safe'), maximumBytes: 4 }), /changed while opening/u);
    assert.equal(existsSync(output), false);
    fs.openSync = originalOpen;
    syncBuiltinESMExports();
    writeFileSync(source, 'safe');
    let reads = 0;
    fs.readSync = (...args) => {
      reads++;
      assert.equal(args[3], 5);
      const count = originalRead(...args);
      writeFileSync(source, 'longer mutation');
      return count;
    };
    syncBuiltinESMExports();
    assert.throws(() => admitRegularFile(source, output, { expectedSha256: digest('safe'), maximumBytes: 4 }), /changed while reading/u);
    assert.equal(reads, 1);
    assert.equal(existsSync(output), false);
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test('admission preserves existing destinations and isolates accepted bytes from later source changes', () => {
  const root = mkdtempSync(join(process.cwd(), '.hb-copy-'));
  try {
    const source = join(root, 'source');
    const output = join(root, 'output');
    writeFileSync(source, 'safe');
    admitRegularFile(source, output, { expectedSha256: digest('safe'), maximumBytes: 4 });
    assert.equal(statSync(output).mode & 0o777, 0o600);
    writeFileSync(source, 'evil');
    assert.equal(read(output), 'safe');
    assert.throws(() => admitRegularFile(source, output, { expectedSha256: digest('evil'), maximumBytes: 4 }), /EEXIST/u);
    assert.equal(read(output), 'safe');
    assert.throws(() => admitRegularFile(source, join(root, 'oversize'), { expectedSha256: digest('evil'), maximumBytes: 3 }), /unsafe admission source/u);
    assert.equal(existsSync(join(root, 'oversize')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepare admits only fixed files before verification and never consults repository execution settings', () => {
  const root = mkdtempSync(join(process.cwd(), '.hb-prepare-'));
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    const input = join(root, 'inputs/123/candidate');
    const state = join(root, 'state');
    const installed = join(root, 'installed');
    for (const path of [input, `${state}/transactions`, installed, `${root}/.git`]) mkdirSync(path, { recursive: true });
    writeFileSync(`${root}/.git/config`, '[core]\n fsmonitor = ./malicious-monitor\n');
    writeFileSync(`${root}/malicious-monitor`, `#!/bin/sh\ntouch ${quote(`${root}/executed`)}\n`, { mode: 0o700 });
    writeFileSync(`${installed}/release-manifest.mjs`, read('scripts/ci/release-manifest.mjs'));
    const add = (path, bytes) => {
      mkdirSync(join(input, path, '..'), { recursive: true });
      writeFileSync(join(input, path), bytes);
      return digest(bytes);
    };
    const compose = 'services: {}\n';
    const composeDigest = add('docker-compose.yml', compose);
    const overlayDigest = add('deploy/oci-images.compose.yml', compose);
    writeFileSync(`${installed}/docker-compose.yml`, compose);
    writeFileSync(`${installed}/oci-images.compose.yml`, compose);
    const files = ['evidence.json', 'sbom.bundle.json', 'sbom.signature.bundle.json',
      'provenance.bundle.json', 'provenance.signature.bundle.json', 'signature.bundle.json'];
    const artifacts = ['app', 'tapestry', 'playlist-bot', 'analytics'].map((artifactId) => {
      const hashes = files.map((file) => add(`evidence/oci-evidence-${artifactId}/${file}`, '{}\n'));
      return { artifactId, evidenceRecordDigest: hashes[0], sbom: { digest: hashes[1], signatureBundleDigest: hashes[2] },
        provenance: { digest: hashes[3], signatureBundleDigest: hashes[4] }, signature: { bundleDigest: hashes[5] } };
    });
    const profileDigest = add('deploy/runtime-public-config/production.json', '{}\n');
    add('deploy/runtime-public-config/live-staging.json', '{}\n');
    const currentState = stateFixture();
    const impactStateBytes = canonicalize(impactStateFromCurrent(currentState));
    const impactPlanBytes = '{}\n';
    const impactStateDigest = add('impact-state.json', impactStateBytes);
    const impactPlanDigest = add('impact-plan.json', impactPlanBytes);
    add('release-manifest.signature.bundle.json', '{}\n');
    add('qualification-receipt.signature.bundle.json', '{}\n');
    const receiptDigest = add('qualification-receipt.json', '{}\n');
    const manifestDigest = add('release-manifest.json', JSON.stringify({ artifacts, externalImages: [],
      qualification: { receiptSha256: receiptDigest }, deploymentInputs: { composeSha256: composeDigest, overlaySha256: overlayDigest },
      configProfiles: { production: { sha256: profileDigest }, 'live-staging': { sha256: profileDigest } } }));
    symlinkSync('/nonexistent', `${input}/ignored-link`);
    add('evidence/oci-evidence-app/ignored-script', 'exit 99');
    writeFileSync(`${state}/current-state.json`, JSON.stringify(currentState));
    let helper = read('deploy/hb-deploy-root').split('\nrequire_root\n')[0];
    const paths = { CANDIDATE_PARENT: `${root}/inputs`, ARTIFACT_STATE: state,
      RELEASE_MANIFEST: `${installed}/release-manifest.mjs`, IMPACT_RECOVERY: 'verify_impact', TRUSTED_COMPOSE: `${installed}/docker-compose.yml`,
      TRUSTED_OVERLAY: `${installed}/oci-images.compose.yml`, ARTIFACT_VERIFY: 'inspect_admitted' };
    for (const [name, path] of Object.entries(paths)) {
      helper = helper.replace(new RegExp(`^readonly ${name}=.*$`, 'm'), `readonly ${name}=${quote(path)}`);
    }
    helper += `
# Unprivileged admission harness: cryptographic verification is tested separately.
DELIVERY_RUN_ID=900
DELIVERY_RUN_ATTEMPT=1
admit_delivery_authorization() {
  mkdir -p "$2"
  printf '%s' ${quote(JSON.stringify({ impactStateSha256: impactStateDigest, impactPlanSha256: impactPlanDigest }))} > "$2/delivery-authorization.json"
  printf '{}' > "$2/delivery-authorization.signature.bundle.json"
}
node() { if [ "$1" = verify_impact ]; then :; elif [ "$2" = validate-delivery ]; then printf '{}' > "$temp/delivery.json"; else command node "$@"; fi; }
verify_impact() { :; }
cosign() { :; }
require_secure_root_file() { :; }
require_release_lane() { :; }
state_unpack() {
  cp "$temp/candidate/docker-compose.yml" "$2/docker-compose.yml"
  cp "$temp/candidate/oci-images.compose.yml" "$2/oci-images.compose.yml"
  cp "$temp/candidate/candidate-manifest.json" "$2/prior-manifest.json"
}
verify_prior_state_inputs() { :; }
install() {
  local args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
  done
  command install "\${args[@]}"
}
git() { touch ${quote(`${root}/executed`)}; return 99; }
docker() { touch ${quote(`${root}/executed`)}; return 99; }
inspect_admitted() {
  local admitted="$temp/candidate"
  test "$(find "$admitted/evidence" -type f | wc -l)" = 24
  test "$(find "$admitted" -type f | wc -l)" = 33
  test ! -e "$admitted/evidence/oci-evidence-app/ignored-script"
  printf 'replaced' > ${quote(`${input}/docker-compose.yml`)}
  cmp --silent "$admitted/docker-compose.yml" "$TRUSTED_COMPOSE"
  touch ${quote(`${root}/verified`)}
  exit 87
}
artifact_prepare "$1" ${'a'.repeat(40)} ${'b'.repeat(40)} 123 ${manifestDigest.slice(7)} shadow ${profileDigest} 1
`;
    writeFileSync(`${root}/harness.bash`, helper);
    const result = spawnSync('bash', [`${root}/harness.bash`, input], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 87, result.stderr);
    assert.equal(existsSync(`${root}/verified`), true);
    assert.equal(existsSync(`${root}/executed`), false);
    assert.deepEqual(readdirSync(`${state}/transactions`), []);
    const wrong = spawnSync('bash', [`${root}/harness.bash`, root], { cwd: root, encoding: 'utf8', timeout: 2000 });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /unexpected candidate artifact root/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
