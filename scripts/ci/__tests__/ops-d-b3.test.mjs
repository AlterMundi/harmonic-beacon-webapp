import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { stateFixture, hash } from './b3-fixture.mjs';
import { candidateIdentitySha256, nextPublication } from '../release-manifest.mjs';

const helper = readFileSync('deploy/hb-deploy-root', 'utf8').split('\nrequire_root\n')[0];
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function unpack(state) {
  const root = mkdtempSync(join(process.cwd(), '.hb-b3-'));
  try {
    writeFileSync(join(root, 'state.json'), JSON.stringify(state));
    const script = helper.replace(/^readonly RELEASE_MANIFEST=.*$/m,
      `readonly RELEASE_MANIFEST=${quote(resolve('scripts/ci/release-manifest.mjs'))}`) + `
require_secure_root_file() { :; }
require_secure_root_ancestors() { :; }
chown() { :; }
install() { mkdir -p "\${@: -1}"; }
state_unpack ${quote(join(root, 'state.json'))} ${quote(join(root, 'out'))}
`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    return { ...result, manifest: existsSync(join(root, 'out/prior-manifest.json')) ? readFileSync(join(root, 'out/prior-manifest.json')) : null };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('B3 valid v4 unpacks exact manifest bytes', () => {
  const state = stateFixture();
  const result = unpack(state);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.manifest, Buffer.from(state.manifestBase64, 'base64'));
});

for (const [name, mutate] of [
  ['v3', s => { s.schemaVersion = 'harmonic-beacon.current-state.v3'; }],
  ['v2', s => { s.schemaVersion = 'harmonic-beacon.current-state.v2'; }],
  ['legacy lane', s => { s.laneState = 'legacy-shadow'; }],
  ['unknown field', s => { s.sourceSha = 'a'.repeat(40); }],
  ...Object.keys(stateFixture()).map(key => [`missing ${key}`, s => { delete s[key]; }]),
  ['malformed digest', s => { s.manifestSha256 = 'ABC'; }],
  ['manifest digest contradiction', s => { s.manifestSha256 = '0'.repeat(64); }],
  ...['manifestBase64', 'composeBase64', 'overlayBase64', 'publicConfigBase64'].flatMap(key => [
    [`malformed ${key}`, s => { s[key] += '\n'; }],
    [`mismatched ${key}`, s => { s[key] = Buffer.from('{}\n').toString('base64'); }],
  ]),
  ['noncanonical base64 pad bits', s => { s.composeBase64 = 'Zh=='; }],
  ['nested manifest unknown', s => rewriteManifest(s, m => { m.source.extra = true; })],
  ['nested manifest missing', s => rewriteManifest(s, m => { delete m.artifacts[0].signature.issuer; })],
  ['unqualified manifest', s => rewriteManifest(s, m => { m.qualification.result = 'failure'; })],
  ['nested config unknown', s => rewriteConfig(s, c => { c.featureFlags.extra = true; })],
  ['nested config missing', s => rewriteConfig(s, c => { delete c.featureFlags.tapestryPublic; })],
]) {
  test(`B3 rejects ${name}`, () => {
    const state = stateFixture();
    mutate(state);
    const result = unpack(state);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(result.manifest, null, 'invalid state must not write unpacked bytes');
  });
}

function rewriteManifest(state, mutate) {
  const manifest = JSON.parse(Buffer.from(state.manifestBase64, 'base64'));
  mutate(manifest);
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  state.manifestBase64 = bytes.toString('base64');
  state.manifestSha256 = hash(bytes);
  state.publication.manifestSha256 = state.manifestSha256;
}
function rewriteConfig(state, mutate) {
  const config = JSON.parse(Buffer.from(state.publicConfigBase64, 'base64'));
  mutate(config);
  const bytes = Buffer.from(JSON.stringify(config));
  state.publicConfigBase64 = bytes.toString('base64');
  rewriteManifest(state, m => { m.configProfiles.production.sha256 = `sha256:${hash(bytes)}`; });
}

export function transactionHarness(body, { phase = 'prepared', stale = false, runtimeFails = false, prepare = false, old = false, active = true, currentCandidate = false, target = 'production', drift } = {}) {
  const root = mkdtempSync(join(process.cwd(), '.hb-b3-tx-'));
  try {
    const state = join(root, 'state');
    const tx = join(state, 'transactions/123');
    const prior = stateFixture();
    const candidate = stateFixture('b');
    if (drift === 'dependency') rewriteManifest(candidate, m => { m.externalImages[0].digest = 'sha256:' + '9'.repeat(64); });
    else if (drift) {
      candidate[drift] = Buffer.from(Buffer.from(candidate[drift], 'base64').toString() + '# drift\n').toString('base64');
      rewriteManifest(candidate, m => { m.deploymentInputs[drift === 'composeBase64' ? 'composeSha256' : 'overlaySha256'] = `sha256:${hash(Buffer.from(candidate[drift], 'base64'))}`; });
    }
    candidate.publication.manifestSha256 = candidate.manifestSha256;
    if (target === 'shadow') {
      rewriteManifest(candidate, manifest => {
        manifest.configProfiles['live-staging'].sha256 = `sha256:${hash(Buffer.from(candidate.publicConfigBase64, 'base64'))}`;
      });
    }
    const receipt = { target, phase, basePublication: prior.publication, candidatePublication: candidate.publication, baseManifestSha256: prior.manifestSha256,
      manifestSha256: candidate.manifestSha256, workflowRunId: '123', workflowRunAttempt: 1,
      sourceSha: 'b'.repeat(40), sourceTree: 'b'.repeat(40), imageRefs: { app: 'ghcr.io/example/app@sha256:' + '0'.repeat(64) },
      targetConfigSha256: `sha256:${hash(Buffer.from(candidate.publicConfigBase64, 'base64'))}` };
    mkdirSync(join(state, 'transactions'), { recursive: true });
    const put = (path, bytes) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, bytes, { mode: 0o600 }); };
    const writeInputs = (path, fixture, manifestName) => {
      for (const [key, name] of Object.entries({ manifestBase64: manifestName, composeBase64: 'docker-compose.yml',
        overlayBase64: 'oci-images.compose.yml', publicConfigBase64: 'target-public-config.json' })) {
        put(join(path, name), Buffer.from(fixture[key], 'base64'));
      }
    };
    writeInputs(join(root, 'candidate'), candidate, 'candidate-manifest.json');
    put(join(root, 'receipt.json'), JSON.stringify(receipt));
    if (!prepare) {
      writeInputs(join(tx, 'candidate'), candidate, 'candidate-manifest.json');
      writeInputs(join(tx, 'prior'), prior, 'prior-manifest.json');
      put(join(tx, 'receipt.json'), JSON.stringify(receipt));
      if (active) put(join(state, 'active-transaction'), '123\n');
    }
    const current = stale ? stateFixture('c') : (currentCandidate ? candidate : prior);
    if (old) current.schemaVersion = 'harmonic-beacon.current-state.v2';
    put(join(state, 'current-state.json'), JSON.stringify(current));
    put(join(root, 'lane'), `${target === 'shadow' ? 'legacy-shadow' : 'oci-production'}\n`);
    put(join(root, 'registry.env'), 'HB_REGISTRY_USERNAME=test\nHB_REGISTRY_TOKEN=test\n');
    let script = helper;
    for (const [key, path] of Object.entries({ ARTIFACT_STATE: state, RELEASE_LANE_STATE: join(root, 'lane'),
      RELEASE_MANIFEST: resolve('scripts/ci/release-manifest.mjs'), CANDIDATE_PARENT: join(root, 'inputs'),
      REGISTRY_ENV: join(root, 'registry.env'), TRUSTED_COMPOSE: join(root, 'candidate/docker-compose.yml'),
      TRUSTED_OVERLAY: join(root, 'candidate/oci-images.compose.yml'), ARTIFACT_VERIFY: 'test_verifier' })) {
      script = script.replace(new RegExp(`^readonly ${key}=.*$`, 'm'), `readonly ${key}=${quote(path)}`);
    }
    script += `
require_secure_root_file() { :; }
require_secure_root_ancestors() { :; }
chown() { :; }
install() {
  local args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
  done
  command install "\${args[@]}"
}
admit_signature() { printf '{}' > "$2"; }
cosign() { :; }
# Admission/signatures/pulls are covered separately; this harness tests transaction ordering.
admit_file() {
  case "$2" in
    */candidate-manifest.json) cp ${quote(join(root, 'candidate/candidate-manifest.json'))} "$2" ;;
    */docker-compose.yml) cp "$TRUSTED_COMPOSE" "$2" ;;
    */oci-images.compose.yml) cp "$TRUSTED_OVERLAY" "$2" ;;
    */production.json|*/live-staging.json) cp ${quote(join(root, 'candidate/target-public-config.json'))} "$2" ;;
    *) printf '{}' > "$2" ;;
  esac
}
test_verifier() { cp ${quote(join(root, 'receipt.json'))} "$temp/verified.json"; }
require_oci_transition_evidence() { :; }
DELIVERY_RUN_ID=900
DELIVERY_RUN_ATTEMPT=1
require_delivery_invocation() { :; }
node() {
  if [ "$2" = validate-delivery ]; then
    printf '{}' > "$temp/delivery.json"
  elif [ "$2" = check-delivery ]; then :
  else command node "$@"; fi
}
docker() {
  if [ "$1" = login ]; then cat >/dev/null; fi
  printf 'docker %s\\n' "$*" >> ${quote(join(root, 'events'))}
  case "$*" in *State.Health.Status*) printf 'healthy\\n' ;; esac
}
curl() { return 0; }
health() { printf 'healthy\\n'; }
verify_release_runtime_state() {
  test -f "$(artifact_transaction "$1")/prior/prior-manifest.json"
  case "$(transaction_phase "$1")" in
    prepared | shadowed | migration-attempted | migrated | replaced | committed | rolled-back) ;;
    *) return 1 ;;
  esac
  printf 'verify prior\\n' >> ${quote(join(root, 'events'))}
  ${runtimeFails ? "die 'runtime reconciliation failed'" : ':'}
}
artifact_compose() {
  if grep -Fxq oci-production ${quote(join(root, 'lane'))}; then
    [ -f "$ACTIVE_TRANSACTION" ] || die 'test observed side effect before durable active transaction'
  else
    [ ! -e "$ACTIVE_TRANSACTION" ] || die 'test observed shadow operation during active production transaction'
  fi
  printf 'compose %s\\n' "$*" >> ${quote(join(root, 'events'))}
}
artifact_compose_from() { printf 'compose-from %s\\n' "$*" >> ${quote(join(root, 'events'))}; }
verify_runtime_profile() { :; }
${body.replaceAll('@ROOT@', root).replaceAll('@HASH@', candidate.manifestSha256).replaceAll('@CONFIG@', receipt.targetConfigSha256)}
`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 10000 });
    return { ...result, events: existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8') : '',
      transactions: readdirSync(join(state, 'transactions')), active: existsSync(join(state, 'active-transaction')),
      current: JSON.parse(readFileSync(join(state, 'current-state.json'))),
      phase: existsSync(join(tx, 'receipt.json')) ? JSON.parse(readFileSync(join(tx, 'receipt.json'))).phase : null };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const prepareCommand = `artifact_prepare '@ROOT@/inputs/123/candidate' ${'b'.repeat(40)} ${'b'.repeat(40)} 123 @HASH@ production @CONFIG@ 1`;
const shadowPrepareCommand = `artifact_prepare '@ROOT@/inputs/123/candidate' ${'b'.repeat(40)} ${'b'.repeat(40)} 123 @HASH@ shadow @CONFIG@ 1`;
test('B3 prepare runtime failure leaves no transaction or active marker', () => {
  const result = transactionHarness(prepareCommand, { prepare: true, runtimeFails: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime reconciliation failed/);
  assert.match(result.events, /verify prior/);
  assert.doesNotMatch(result.events, /compose/);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.active, false);
});
test('B3 reconciled prepare activates the exact prepared transaction', () => {
  const result = transactionHarness(prepareCommand, { prepare: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.events, /verify prior/);
  assert.doesNotMatch(result.events, /compose/);
  assert.deepEqual(result.transactions, ['123']);
  assert.equal(result.active, true);
  assert.equal(result.phase, 'prepared');
});
test('B3 shadow prepare, preflight, and status complete without deadlocking the lane', () => {
  const result = transactionHarness(`${shadowPrepareCommand}\nartifact_preflight 123 shadow\nartifact_status 123 shadow`, {
    prepare: true, target: 'shadow',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.active, false);
  assert.equal(result.phase, null);
});
test('B3 shadow completion frees the same qualified run for production prepare', () => {
  const body = `${shadowPrepareCommand}
artifact_preflight 123 shadow
artifact_status 123 shadow
jq '.target="production"' '@ROOT@/receipt.json' > '@ROOT@/receipt.new'
mv '@ROOT@/receipt.new' '@ROOT@/receipt.json'
DELIVERY_RUN_ID=901
printf 'oci-production\\n' > '@ROOT@/lane'
${prepareCommand}`;
  const result = transactionHarness(body, { prepare: true, target: 'shadow' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.transactions, ['123']);
  assert.equal(result.active, true);
  assert.equal(result.phase, 'prepared');
});
test('B3 shadow status retry resumes from a durable shadowed phase', () => {
  const result = transactionHarness(`${shadowPrepareCommand}\nartifact_preflight 123 shadow\nartifact_status 123 shadow`, {
    phase: 'shadowed', active: false, target: 'shadow',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.active, false);
});
test('B3 shadow preflight rejects a stale exact-base before Compose', () => {
  const result = transactionHarness('artifact_preflight 123 shadow', {
    phase: 'prepared', active: false, target: 'shadow', stale: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /high-water/);
  assert.doesNotMatch(result.events, /compose/);
});
for (const [verb, phase] of [['artifact_preflight 123 production', 'prepared'], ['artifact_migrate 123', 'prepared'],
  ['artifact_replace 123', 'migrated'], ['artifact_status 123 production', 'replaced'], ['artifact_rollback 123', 'migrated']]) {
  for (const invalid of ['stale', 'old']) test(`B3 ${verb} rejects ${invalid} high-water before Compose`, () => {
    const result = transactionHarness(verb, { phase, [invalid]: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /high-water|current state/);
    assert.doesNotMatch(result.events, /compose/);
    assert.equal(result.phase, phase);
  });
}
test('B3 migration verifies prior live state before phase and Compose', () => {
  const failed = transactionHarness('artifact_migrate 123', { runtimeFails: true });
  assert.notEqual(failed.status, 0);
  assert.equal(failed.phase, 'prepared');
  assert.equal(failed.events, 'verify prior\n');
  const success = transactionHarness('artifact_migrate 123');
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.events, /^verify prior\ncompose /);
  assert.equal(success.phase, 'migrated');
});

for (const source of ['candidate', 'prior']) {
  test(`B3 full atomic writer publishes valid ${source} v4 bytes`, () => {
    const result = transactionHarness(`${source === 'prior' ? 'bind_rollback_publication 123' : ''}\natomic_install_release_state "$(artifact_transaction 123)" ${source}`);
    assert.equal(result.status, 0, result.stderr);
    const expected = stateFixture(source === 'candidate' ? 'b' : 'a');
    assert.equal(result.current.publication.generation, 2);
    assert.notEqual(result.current.publication.id, stateFixture().publication.id);
    assert.deepEqual({ ...result.current, publication: expected.publication }, expected);
  });
  test(`B3 full atomic writer rejects contradictory ${source} bytes without changing high-water`, () => {
    const result = transactionHarness(`printf 'corrupted' > "$(artifact_transaction 123)/${source}/oci-images.compose.yml"
atomic_install_release_state "$(artifact_transaction 123)" ${source}`);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.current, stateFixture());
  });
}
test('B3 prepare retry cannot reactivate before reconciling runtime', () => {
  const result = transactionHarness(`rm "$ACTIVE_TRANSACTION"\n${prepareCommand}`, { runtimeFails: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime reconciliation failed/);
  assert.equal(result.active, false);
  assert.doesNotMatch(result.events, /compose/);
});

test('B3 committed rollback publishes durable intent before the first side effect', () => {
  const result = transactionHarness('artifact_rollback 123', {
    phase: 'committed', active: false, currentCandidate: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.current.manifestSha256, stateFixture().manifestSha256);
  assert.equal(result.phase, 'rolled-back');
  assert.equal(result.active, false);
});

test('B3 committed rollback rejects unbound prior high-water crash state', () => {
  const result = transactionHarness('artifact_rollback 123', {
    phase: 'committed', active: true, currentCandidate: false,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.phase, 'committed');
  assert.doesNotMatch(result.events, /docker|compose/);
});

for (const field of ['composeBase64', 'overlayBase64', 'dependency']) test(`B3 rejects ${field} drift before Docker`, () => {
  const result = transactionHarness(prepareCommand, { prepare: true, drift: field });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /configuration drift/);
  assert.doesNotMatch(result.events, /docker|compose/);
});
test('B3 publication identity rejects same-content ABA rollback', () => {
  const result = transactionHarness(`jq '.publication.generation=4 | .publication.id="${'d'.repeat(64)}"' "$CURRENT_STATE" > "$CURRENT_STATE.new"
mv "$CURRENT_STATE.new" "$CURRENT_STATE"
artifact_rollback 123`, { phase: 'committed', active: false, currentCandidate: true });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.events, /docker|compose/);
  assert.equal(result.current.publication.generation, 4);
});

test('B3 real commits A→B→C and rollback C→B deny obsolete T rollback', () => {
  const result = transactionHarness(`
artifact_status 123 production
[ "$(jq .publication.generation "$CURRENT_STATE")" = 2 ]
cp -a "$(artifact_transaction 123)" "$TRANSACTION_ROOT/456"
cp "$(artifact_transaction 123)/candidate/"* "$TRANSACTION_ROOT/456/prior/"
mv "$TRANSACTION_ROOT/456/prior/candidate-manifest.json" "$TRANSACTION_ROOT/456/prior/prior-manifest.json"
node --input-type=module -e '
import {readFileSync,writeFileSync} from "node:fs";
import {candidateIdentitySha256} from "./scripts/ci/release-manifest.mjs";
import {createHash} from "node:crypto";
const p=process.argv[1]; const m=JSON.parse(readFileSync(p));
m.source.gitSha="c".repeat(40); m.qualification.candidateIdentitySha256=candidateIdentitySha256(m);
writeFileSync(p, JSON.stringify(m));' "$TRANSACTION_ROOT/456/candidate/candidate-manifest.json"
jq --arg base "$(jq -r .manifestSha256 "$CURRENT_STATE")" --arg candidate "$(sha256sum "$TRANSACTION_ROOT/456/candidate/candidate-manifest.json" | cut -d' ' -f1)" '.baseManifestSha256=$base | .manifestSha256=$candidate | .phase="replaced"' "$TRANSACTION_ROOT/456/receipt.json" > "$TRANSACTION_ROOT/456/receipt.new"
node "$RELEASE_MANIFEST" bind-publications --state "$CURRENT_STATE" --receipt "$TRANSACTION_ROOT/456/receipt.new" --output "$TRANSACTION_ROOT/456/receipt.json"
atomic_write_active_transaction 456
artifact_status 456 production
[ "$(jq .publication.generation "$CURRENT_STATE")" = 3 ]
artifact_rollback 456
[ "$(jq .publication.generation "$CURRENT_STATE")" = 4 ]
cp "$CURRENT_STATE" '@ROOT@/expected-state'
artifact_rollback 456
cmp "$CURRENT_STATE" '@ROOT@/expected-state'
if (artifact_rollback 123); then exit 91; fi
cmp "$CURRENT_STATE" '@ROOT@/expected-state'
`, { phase: 'replaced' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.current.manifestSha256, stateFixture('b').manifestSha256);
  assert.equal(result.current.publication.generation, 4);
  assert.equal(result.active, false);
});
test('B3 rollback state-publication failpoint resumes once and exact retries are idempotent', () => {
  const result = transactionHarness(`
test_failpoint() { if [ "$1" = current-state-directory-fsync ]; then exit 77; fi; }
set +e
(artifact_rollback 123)
code=$?
set -e
[ "$code" = 77 ]
[ "$(transaction_phase 123)" = committed ]
[ "$(jq .publication.generation "$CURRENT_STATE")" = 3 ]
cp "$CURRENT_STATE" '@ROOT@/expected-state'
test_failpoint() { :; }
: > '@ROOT@/events'
artifact_rollback 123
artifact_rollback 123
cmp "$CURRENT_STATE" '@ROOT@/expected-state'
`, { phase: 'committed', active: false, currentCandidate: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.phase, 'rolled-back');
  assert.equal(result.current.publication.generation, 3);
  assert.equal(result.active, false);
  assert.doesNotMatch(result.events, /docker|compose/);
});
for (const value of [0, -1, 1.5, '1', true, null, 9007199254740992]) test(`B3 rejects invalid generation ${value}`, () => {
  const state = stateFixture(); state.publication.generation = value;
  assert.notEqual(unpack(state).status, 0);
});
for (const mutate of [p => { p.id = 'g'.repeat(64); }, p => { p.extra = 1; }, p => { delete p.id; }, p => { p.manifestSha256 = '0'.repeat(64); }]) test('B3 closed publication identity rejects malformed fields', () => {
  const state = stateFixture(); mutate(state.publication);
  assert.notEqual(unpack(state).status, 0);
});

test('B3 uncommitted rollback advances base generation and retries exactly', () => {
  const result = transactionHarness(`artifact_rollback 123
cp "$CURRENT_STATE" '@ROOT@/expected-state'
artifact_rollback 123
cmp "$CURRENT_STATE" '@ROOT@/expected-state'`, { phase: 'migrated' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.current.publication.generation, 2);
  assert.notEqual(result.current.publication.id, stateFixture().publication.id);
  assert.equal(result.phase, 'rolled-back');
});
test('B3 exact commit retry retains the publication', () => {
  const result = transactionHarness(`artifact_status 123 production
cp "$CURRENT_STATE" '@ROOT@/expected-state'
artifact_status 123 production
cmp "$CURRENT_STATE" '@ROOT@/expected-state'`, { phase: 'replaced' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.current.publication.generation, 2);
  assert.equal(result.phase, 'committed');
});
test('B3 generation exhaustion fails closed', () => {
  assert.throws(() => nextPublication({ ...stateFixture().publication, generation: Number.MAX_SAFE_INTEGER }, stateFixture().manifestSha256), /generation/);
});
