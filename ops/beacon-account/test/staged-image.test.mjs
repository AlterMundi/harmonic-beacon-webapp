import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '../delivery');
const base = JSON.parse(fs.readFileSync(path.join(root, 'receipt.synthetic.json')));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-staged-image-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = structuredClone(base);
  Object.assign(r, { evidence_scope: 'runtime', operation: 'deploy', outcome: 'deployed', interruption: null });
  r.artifact.source_sha = r.source_sha;
  r.revisions.current.kind = 'candidate';
  r.actions.delivery.operation = 'deploy';
  r.rollback = { result: 'not-required', revision: null };
  const file = path.join(dir, 'staging-202-3.json');
  const write = () => fs.writeFileSync(file, JSON.stringify(r), { mode: 0o600 });
  const run = () => spawnSync(process.execPath, [path.join(root, 'select-staged-image.mjs'), dir,
    base.source_sha, base.artifact.image_id, base.config_contract_sha256], { encoding: 'utf8' });
  return { dir, r, file, write, run };
}
test('selects only the exact successful staged runtime artifact', t => {
  const f = fixture(t); f.write(); const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});
for (const mode of ['missing', 'image', 'source', 'config', 'synthetic', 'failed-health', 'permissions', 'symlink']) {
  test(`rejects staged artifact evidence: ${mode}`, t => {
    const f = fixture(t);
    if (mode === 'image') f.r.artifact.image_id = 'sha256:' + 'f'.repeat(64);
    if (mode === 'source') f.r.source_sha = 'f'.repeat(40);
    if (mode === 'config') f.r.config_contract_sha256 = 'f'.repeat(64);
    if (mode === 'synthetic') f.r.evidence_scope = 'synthetic-contract-fixture';
    if (mode === 'failed-health') f.r.checks.health = 'failed';
    if (mode !== 'missing') f.write();
    if (mode === 'permissions') fs.chmodSync(f.file, 0o644);
    if (mode === 'symlink') { fs.renameSync(f.file, f.file + '.other'); fs.symlinkSync(f.file + '.other', f.file); }
    assert.notEqual(f.run().status, 0);
  });
}

for (const mode of ['qualified', 'changed-tag', 'missing-receipt', 'retag-after-receipt']) {
  test(`production preflight consumes staging without a build: ${mode}`, t => {
    const f = fixture(t);
    const helper = fs.readFileSync(path.join(root, 'hb-account-delivery-root'), 'utf8');
    const preflight = helper.slice(helper.indexOf('\npreflight() {'), helper.indexOf('\ndeploy() {'));
    const script = `
set -eu
target=production
sha=${base.source_sha}
config_sha256=${base.config_contract_sha256}
SOURCE_ROOT=/reviewed
RECEIPT_DIR=/receipts
state_file() { echo "$TEST_DIR/not-yet-created"; }
load_account_library() { :; }
account_require_internal_mail_network() { :; }
account_capture_previous_runtime() { echo previous; }
account_capture_previous_worker() { echo 1; }
account_verify_running() { test "$*" = "staging $sha $sha 1"; echo stage >> "$TEST_DIR/order"; }
docker() { echo ${base.artifact.image_id}; }
account_require_prepared_image() { test "$TEST_MODE" != changed-tag; test ! -f "$TEST_DIR/retagged"; }
node() { test "$*" = "/reviewed/ops/beacon-account/delivery/select-staged-image.mjs /receipts $sha ${base.artifact.image_id} $config_sha256"; test "$TEST_MODE" != missing-receipt; echo receipt >> "$TEST_DIR/order"; }
account_build_candidate() { echo forbidden-build; exit 90; }
account_candidate_image_id() { echo ${base.artifact.image_id}; }
account_check_production_migrations() { echo migrations >> "$TEST_DIR/order"; }
account_backup_production() { echo backup >> "$TEST_DIR/order"; echo "$TEST_DIR/backup"; }
require_private_file() { :; }
sha256sum() { echo ${'e'.repeat(64)}; }
isolated_restore() { echo restore >> "$TEST_DIR/order"; if [ "$TEST_MODE" = retag-after-receipt ]; then touch "$TEST_DIR/retagged"; fi; echo isolated-ephemeral-postgres; }
create_state() { echo state >> "$TEST_DIR/order"; }
fail() { exit 91; }
${preflight}
preflight
`;
    const r = spawnSync('/bin/bash', ['-c', script], {
      env: { ...process.env, TEST_MODE: mode, TEST_DIR: f.dir }, encoding: 'utf8',
    });
    if (mode === 'qualified') {
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(fs.readFileSync(path.join(f.dir, 'order'), 'utf8').trim().split('\n'),
        ['stage', 'receipt', 'migrations', 'backup', 'restore', 'state']);
    } else assert.notEqual(r.status, 0);
  });
}
